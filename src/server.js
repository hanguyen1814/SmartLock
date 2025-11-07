const app = require("./app");
const connectDB = require("./config/database");
require("dotenv").config({quiet: true});

const PORT = process.env.PORT || 3000;

connectDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Không thể khởi động server", error);
    process.exit(1);
  });
