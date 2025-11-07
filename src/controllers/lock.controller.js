const mongoose = require("mongoose");
const User = require("../models/User");
const Lock = require("../models/Lock");
const UserLock = require("../models/UserLock");
const { recordLog } = require("../utils/logger");

const listLocks = async (req, res) => {
  try {
    let locks;
    if (req.user.role === "admin") {
      locks = await Lock.find().sort({ createdAt: -1 });
    } else {
      const userLocks = await UserLock.find({ user: req.user._id }).select(
        "lock"
      );
      const lockIds = userLocks.map((ul) => ul.lock);
      locks = await Lock.find({ _id: { $in: lockIds } }).sort({
        createdAt: -1,
      });
    }

    const lockIds = locks.map((lock) => lock._id);
    const assignments = await UserLock.find({ lock: { $in: lockIds } })
      .populate("user", "name email role")
      .lean();

    const assignmentMap = new Map();
    assignments.forEach((assignment) => {
      const key = assignment.lock.toString();
      if (!assignmentMap.has(key)) {
        assignmentMap.set(key, []);
      }
      if (assignment.user) {
        assignmentMap.get(key).push({
          id: assignment.user._id,
          name: assignment.user.name,
          email: assignment.user.email,
          role: assignment.user.role,
        });
      }
    });

    const locksPayload = locks.map((lock) => ({
      ...lock.toJSON(),
      assignedUsers: assignmentMap.get(lock._id.toString()) || [],
    }));

    res.json({ locks: locksPayload });
  } catch (error) {
    console.error("List locks error", error);
    res.status(500).json({ error: "Không thể tải danh sách khoá" });
  }
};

const createLock = async (req, res) => {
  try {
    const { name, location } = req.body;
    if (!name) {
      return res.status(400).json({ error: "Tên khóa là bắt buộc" });
    }

    const lock = await Lock.create({ name, location });
    await recordLog({
      user: req.user._id,
      lock: lock._id,
      action: "lock.create",
    });

    res.status(201).json({ lock });
  } catch (error) {
    console.error("Create lock error", error);
    res.status(500).json({ error: "Không thể tạo khóa" });
  }
};

const updateLock = async (req, res) => {
  try {
    const lock = await Lock.findById(req.params.id);
    if (!lock) {
      return res.status(404).json({ error: "Không tìm thấy khóa" });
    }

    const { name, location, status } = req.body;
    if (typeof name !== "undefined") lock.name = name;
    if (typeof location !== "undefined") lock.location = location;
    if (typeof status !== "undefined") lock.status = status;

    await lock.save();
    await recordLog({
      user: req.user._id,
      lock: lock._id,
      action: "lock.update",
    });

    res.json({ lock });
  } catch (error) {
    console.error("Update lock error", error);
    res.status(500).json({ error: "Không thể cập nhật khóa" });
  }
};

const deleteLock = async (req, res) => {
  try {
    const lock = await Lock.findById(req.params.id);
    if (!lock) {
      return res.status(404).json({ error: "Không tìm thấy khóa" });
    }

    await UserLock.deleteMany({ lock: lock._id });
    await lock.deleteOne();
    await recordLog({
      user: req.user._id,
      lock: lock._id,
      action: "lock.delete",
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Delete lock error", error);
    res.status(500).json({ error: "Không thể xoá khóa" });
  }
};

const enqueueLockCommand = async ({ lockId, command, user }) => {
  if (!lockId || lockId === "undefined" || lockId === "null") {
    throw new Error("ID khóa không hợp lệ");
  }

  // Validate ObjectId format
  if (!mongoose.Types.ObjectId.isValid(lockId)) {
    throw new Error("ID khóa không đúng định dạng");
  }

  const lock = await Lock.findById(lockId);
  if (!lock) {
    throw new Error("Không tìm thấy khóa");
  }
  await lock.enqueueCommand(command, user?._id, { createdBy: user?._id });
  await recordLog({
    user: user?._id,
    lock: lock._id,
    action: `lock.command.${command}`,
  });
  return lock;
};

const openLock = async (req, res) => {
  try {
    if (!req.params.id) {
      return res.status(400).json({ error: "Thiếu ID khóa" });
    }
    const lock = await enqueueLockCommand({
      lockId: req.params.id,
      command: "open",
      user: req.user,
    });
    res.json({ lock });
  } catch (error) {
    console.error("Open lock error", error);
    const statusCode =
      error.message.includes("không hợp lệ") ||
      error.message.includes("không đúng")
        ? 400
        : 500;
    res
      .status(statusCode)
      .json({ error: error.message || "Không thể gửi lệnh mở" });
  }
};

const closeLock = async (req, res) => {
  try {
    if (!req.params.id) {
      return res.status(400).json({ error: "Thiếu ID khóa" });
    }
    const lock = await enqueueLockCommand({
      lockId: req.params.id,
      command: "close",
      user: req.user,
    });
    res.json({ lock });
  } catch (error) {
    console.error("Close lock error", error);
    const statusCode =
      error.message.includes("không hợp lệ") ||
      error.message.includes("không đúng")
        ? 400
        : 500;
    res
      .status(statusCode)
      .json({ error: error.message || "Không thể gửi lệnh đóng" });
  }
};

const assignUsers = async (req, res) => {
  try {
    const { userIds = [] } = req.body;
    const lock = await Lock.findById(req.params.id);
    if (!lock) {
      return res.status(404).json({ error: "Không tìm thấy khóa" });
    }

    const uniqueUserIds = [...new Set(userIds.filter(Boolean))];
    const existingUsers = await User.find({
      _id: { $in: uniqueUserIds },
    }).select("_id");
    const validUserIds = existingUsers.map((u) => u._id);

    await UserLock.deleteMany({ lock: lock._id });
    const docs = validUserIds.map((userId) => ({
      user: userId,
      lock: lock._id,
    }));
    if (docs.length > 0) {
      await UserLock.insertMany(docs, { ordered: false }).catch(() => {});
      console.log(
        `[Lock] Assigned ${validUserIds.length} user(s) to lock ${lock.name}`
      );
    }

    await recordLog({
      user: req.user._id,
      lock: lock._id,
      action: "lock.assign",
      metadata: { userIds: validUserIds },
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Assign lock error", error);
    res.status(500).json({ error: "Không thể gán khóa" });
  }
};

module.exports = {
  listLocks,
  createLock,
  updateLock,
  deleteLock,
  openLock,
  closeLock,
  assignUsers,
};
