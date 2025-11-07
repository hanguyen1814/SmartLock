const mongoose = require("mongoose");

const userLockSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    lock: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lock",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

userLockSchema.index({ user: 1, lock: 1 }, { unique: true });

const UserLock = mongoose.model("UserLock", userLockSchema);

module.exports = UserLock;
