const mongoose = require("mongoose");

const otpSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  lock: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Lock",
    required: false,
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  otp: {
    type: String,
    required: true,
  },
  expiresAt: {
    type: Date,
    required: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  consumedAt: {
    type: Date,
  },
  maxUses: {
    type: Number,
    default: 1,
    min: 1,
  },
  usedCount: {
    type: Number,
    default: 0,
    min: 0,
  },
});

// Index for auto-deleting expired OTPs (only works if expiresAt is set)
// Note: MongoDB TTL index only works with dates, so OTPs without expiresAt won't be auto-deleted
otpSchema.index(
  { expiresAt: 1 },
  {
    expireAfterSeconds: 0,
    partialFilterExpression: { expiresAt: { $exists: true, $ne: null } },
  }
);
otpSchema.index({ user: 1, lock: 1, otp: 1 }, { unique: true });
otpSchema.index({ lock: 1, expiresAt: 1 });
otpSchema.index({ createdBy: 1, expiresAt: 1 });

const UserOTP = mongoose.model("UserOTP", otpSchema);

module.exports = UserOTP;
