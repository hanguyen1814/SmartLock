const mongoose = require("mongoose");
const crypto = require("crypto");

const lockCommandSchema = new mongoose.Schema({
  command: {
    type: String,
    enum: ["open", "close"],
    required: true,
  },
  status: {
    type: String,
    enum: ["pending", "sent", "completed", "failed"],
    default: "pending",
  },
  issuedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  executedAt: {
    type: Date,
  },
});

const lockSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      unique: true,
      default: () => crypto.randomBytes(16).toString("hex"),
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    location: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ["open", "closed", "unknown", "opening", "closing"],
      default: "unknown",
    },
    lastSeen: {
      type: Date,
    },
    commandQueue: {
      type: [lockCommandSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

lockSchema.methods.enqueueCommand = function enqueueCommand(
  command,
  issuedBy,
  metadata = {}
) {
  this.commandQueue.push({ command, issuedBy, metadata });
  return this.save();
};

lockSchema.methods.getNextCommand = function getNextCommand() {
  return this.commandQueue.find((cmd) => cmd.status === "pending") || null;
};

lockSchema.methods.markCommand = function markCommand(
  commandId,
  status,
  metadata = {}
) {
  const command = this.commandQueue.id(commandId);
  if (!command) {
    return this;
  }
  command.status = status;
  if (metadata.executedAt) {
    command.executedAt = metadata.executedAt;
  }
  if (metadata.error) {
    command.metadata = { ...(command.metadata || {}), error: metadata.error };
  }
  return this.save();
};

const Lock = mongoose.model("Lock", lockSchema);

module.exports = Lock;
