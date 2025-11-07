const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const cron = require("node-cron");
require("dotenv").config({ quiet: true });

const routes = require("./routes");
const UserOTP = require("./models/OTP");

console.log(process.env.CLIENT_ORIGIN);

const parseOrigins = () =>
  (process.env.CLIENT_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const CLIENT_ORIGINS = parseOrigins();

const app = express();

app.set("trust proxy", 1);

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (
        !origin ||
        CLIENT_ORIGINS.length === 0 ||
        CLIENT_ORIGINS.includes(origin)
      ) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

const staticDir = path.join(__dirname, "..", "public");
app.use(express.static(staticDir));

app.use("/api", routes);

app.use((req, res) => {
  res.status(404).json({ error: "Không tìm thấy tài nguyên" });
});

app.use((err, _req, res, _next) => {
  console.error("Unhandled error", err);
  res.status(500).json({ error: "Đã xảy ra lỗi máy chủ" });
});

if (!global.__SMARTLOCK_OTP_CRON__) {
  cron.schedule("* * * * *", async () => {
    try {
      await UserOTP.deleteMany({ expiresAt: { $lte: new Date() } });
    } catch (error) {
      console.error("Cron cleanup otp error", error);
    }
  });
  global.__SMARTLOCK_OTP_CRON__ = true;
}

module.exports = app;
