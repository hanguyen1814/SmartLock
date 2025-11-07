const express = require("express");

const authRoutes = require("./auth.routes");
const userRoutes = require("./user.routes");
const lockRoutes = require("./lock.routes");
const logRoutes = require("./log.routes");
const settingRoutes = require("./setting.routes");
const otpRoutes = require("./otp.routes");
const deviceRoutes = require("./device.routes");
const twoFactorRoutes = require("./twoFactor.routes");
const { authenticateToken, requireAdmin } = require("../middleware/auth");
const { exportLogs } = require("../controllers/log.controller");

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/locks", lockRoutes);
router.use("/logs", logRoutes);
router.use("/settings", settingRoutes);
router.use("/otps", otpRoutes);
router.use("/2fa", twoFactorRoutes);
router.use(deviceRoutes);

// Giữ endpoint cũ /api/export/logs cho tương thích ngược
router.get("/export/logs", authenticateToken, requireAdmin, exportLogs);

module.exports = router;
