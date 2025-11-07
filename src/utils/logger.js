const ActivityLog = require("../models/Log");

const recordLog = async ({ user, lock, action, metadata = {}, createdAt }) => {
  try {
    await ActivityLog.create({
      user,
      lock,
      action,
      metadata,
      ...(createdAt ? { createdAt } : {}),
    });
  } catch (error) {
    console.error("Không thể ghi log", error);
  }
};

module.exports = {
  recordLog,
};
