const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    if (mongoose.connection.readyState >= 1) {
      return mongoose.connection;
    }

    mongoose.set("strictQuery", true);

    const mongoURI = process.env.MONGODB_URI;

    await mongoose.connect(mongoURI, {
      dbName: process.env.MONGODB_DB || undefined,
      serverSelectionTimeoutMS: 5000,
    });

    console.log("✅ Đã kết nối MongoDB");
    return mongoose.connection;
  } catch (error) {
    console.error("❌ Lỗi kết nối MongoDB:", error);
    throw error;
  }
};

mongoose.connection.on("disconnected", () => {
  console.warn("⚠️  MongoDB ngắt kết nối");
});

mongoose.connection.on("reconnected", () => {
  console.log("🔁 MongoDB kết nối lại");
});

module.exports = connectDB;
