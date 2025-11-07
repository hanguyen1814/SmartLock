const mongoose = require("mongoose");
const connectDB = require("../config/database");
const User = require("../models/User");
const dotenv = require("dotenv");
dotenv.config();

async function initAdmin() {
  try {
    await connectDB();

    const existingAdmin = await User.findOne({ role: "admin" });
    if (existingAdmin) {
      console.log("✅ Admin đã tồn tại:", existingAdmin.email);
      await mongoose.disconnect();
      process.exit(0);
    }

    const admin = new User({
      name: "Super Admin",
      email: "admin@smartlock.com",
      password: "Admin@123",
      pin: User.generatePin(),
      role: "admin",
      otpEnabled: false,
      otpExpiry: 300,
    });

    await admin.save();

    console.log("✅ Đã tạo admin mặc định:");
    console.log("   Email: admin@smartlock.local");
    console.log("   Password: Admin@123");
    console.log("   AccessCode:", admin.accessCode);
    console.log("   PIN:", admin.pin);
    console.log("⚠️  Vui lòng đổi mật khẩu sau khi đăng nhập!");

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("❌ Lỗi:", error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

initAdmin();
