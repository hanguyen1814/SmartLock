const mongoose = require("mongoose");

const logSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    lock: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lock",
    },
    action: {
      type: String,
      required: true,
      trim: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

const ActivityLog = mongoose.model("ActivityLog", logSchema);

module.exports = ActivityLog;
