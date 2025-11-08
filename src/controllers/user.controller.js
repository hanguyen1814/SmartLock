const mongoose = require("mongoose");
const User = require("../models/User");
const UserLock = require("../models/UserLock");
const Setting = require("../models/Setting");
const { recordLog } = require("../utils/logger");
const { createOtpForUser } = require("../utils/otp");

const listUsers = async (_req, res) => {
  console.log(`[API] GET /users - ${new Date().toISOString()}`);
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json({ users });
  } catch (error) {
    console.error("List users error", error);
    res.status(500).json({ error: "Không thể tải danh sách người dùng" });
  }
};

const createUser = async (req, res) => {
  console.log(`[API] POST /users - ${new Date().toISOString()}`);
  try {
    const {
      name,
      email,
      password,
      pin,
      role = "user",
      otpEnabled = false,
      otpExpiry,
      lockIds = [],
    } = req.body;
    console.log(`[API] Create user - email: ${email || "N/A"}, role: ${role}`);

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Thiếu tên, email hoặc mật khẩu" });
    }

    const defaultOtpExpiry = Number(
      await Setting.getValue("otp_default_expiry", 300)
    );

    let normalizedPin = typeof pin === "string" ? pin.trim() : "";
    if (normalizedPin && !User.isValidPin(normalizedPin)) {
      return res.status(400).json({ error: "PIN phải gồm 4-8 chữ số" });
    }
    if (!normalizedPin) {
      normalizedPin = User.generatePin();
    }

    const user = new User({
      name,
      email,
      password,
      pin: normalizedPin,
      role,
      otpEnabled,
      otpExpiry: otpExpiry || defaultOtpExpiry,
    });

    await user.save();
    console.log(`[User] Created user: ${user.name} (${user._id})`);

    // Assign user to locks if provided
    if (Array.isArray(lockIds) && lockIds.length > 0) {
      const Lock = require("../models/Lock");
      const UserLock = require("../models/UserLock");

      // Validate lock IDs
      const validLockIds = lockIds.filter((id) =>
        mongoose.Types.ObjectId.isValid(id)
      );
      const existingLocks = await Lock.find({
        _id: { $in: validLockIds },
      }).select("_id");

      const validLocks = existingLocks.map((lock) => lock._id);
      if (validLocks.length > 0) {
        const assignments = validLocks.map((lockId) => ({
          user: user._id,
          lock: lockId,
        }));

        await UserLock.insertMany(assignments, { ordered: false }).catch(
          () => {}
        );
        console.log(
          `[User] Assigned user ${user.name} to ${validLocks.length} lock(s)`
        );
      }
    }

    await recordLog({
      user: req.user._id,
      action: "user.create",
      metadata: { userId: user._id, lockIds: lockIds || [] },
    });

    res.status(201).json({ user });
  } catch (error) {
    console.error("[User] Create user error", error);
    if (error.code === 11000) {
      return res
        .status(400)
        .json({ error: "Email hoặc mã truy cập đã tồn tại" });
    }
    res.status(500).json({ error: "Không thể tạo người dùng" });
  }
};

const getUser = async (req, res) => {
  try {
    const targetId = req.params.id;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(400).json({ error: "ID người dùng không hợp lệ" });
    }

    if (req.user.role !== "admin" && req.user._id.toString() !== targetId) {
      return res.status(403).json({ error: "Không có quyền" });
    }

    const user = await User.findById(targetId);
    if (!user) {
      return res.status(404).json({ error: "Không tìm thấy người dùng" });
    }

    res.json({ user });
  } catch (error) {
    console.error("Get user error", error);
    res.status(500).json({ error: "Không thể tải người dùng" });
  }
};

const updateUser = async (req, res) => {
  console.log(`[API] PUT /users/:id - ${new Date().toISOString()}`);
  console.log(
    `[API] Update user - id: ${req.params.id}, requester: ${
      req.user?.email || "N/A"
    }`
  );
  try {
    const targetId = req.params.id;
    const { lockIds } = req.body;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(400).json({ error: "ID người dùng không hợp lệ" });
    }

    const isSelf = req.user._id.toString() === targetId;
    if (!isSelf && req.user.role !== "admin") {
      return res.status(403).json({ error: "Không có quyền" });
    }

    const updates = (({
      name,
      password,
      pin,
      otpEnabled,
      otpExpiry,
      role,
    }) => ({
      name,
      password,
      pin,
      otpEnabled,
      otpExpiry,
      role,
    }))(req.body);

    if (req.user.role !== "admin") {
      delete updates.role;
    }

    if (typeof updates.pin !== "undefined" && updates.pin !== null) {
      const nextPin = String(updates.pin).trim();
      if (!User.isValidPin(nextPin)) {
        return res.status(400).json({ error: "PIN phải gồm 4-8 chữ số" });
      }
      updates.pin = nextPin;
    }

    const user = await User.findById(targetId);
    if (!user) {
      return res.status(404).json({ error: "Không tìm thấy người dùng" });
    }

    Object.keys(updates).forEach((key) => {
      if (typeof updates[key] !== "undefined" && updates[key] !== null) {
        user[key] = updates[key];
      }
    });

    await user.save();

    // Cập nhật quyền truy cập khóa nếu lockIds được cung cấp (chỉ admin mới có quyền)
    if (lockIds !== undefined && req.user.role === "admin") {
      const Lock = require("../models/Lock");
      const UserLock = require("../models/UserLock");

      // Validate lock IDs
      const validLockIds = Array.isArray(lockIds)
        ? lockIds.filter((id) => mongoose.Types.ObjectId.isValid(id))
        : [];

      // Kiểm tra các lock có tồn tại không
      const existingLocks = await Lock.find({
        _id: { $in: validLockIds },
      }).select("_id");

      const validLocks = existingLocks.map((lock) => lock._id);

      // Xóa tất cả assignments cũ của user này
      await UserLock.deleteMany({ user: user._id });

      // Tạo assignments mới nếu có locks hợp lệ
      if (validLocks.length > 0) {
        const assignments = validLocks.map((lockId) => ({
          user: user._id,
          lock: lockId,
        }));

        await UserLock.insertMany(assignments, { ordered: false }).catch(
          () => {}
        );
        console.log(
          `[User] Updated lock access for user ${user.name}: ${validLocks.length} lock(s)`
        );
      } else if (Array.isArray(lockIds) && lockIds.length === 0) {
        // Nếu lockIds là mảng rỗng, đã xóa hết assignments ở trên
        console.log(`[User] Removed all lock access for user ${user.name}`);
      }
    }

    await recordLog({
      user: req.user._id,
      action: "user.update",
      metadata: {
        targetUser: user._id,
        lockIds: lockIds !== undefined ? lockIds : undefined,
      },
    });

    res.json({ user });
  } catch (error) {
    console.error("Update user error", error);
    res.status(500).json({ error: "Không thể cập nhật người dùng" });
  }
};

const deleteUser = async (req, res) => {
  try {
    const targetId = req.params.id;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(400).json({ error: "ID người dùng không hợp lệ" });
    }

    const user = await User.findById(targetId);
    if (!user) {
      return res.status(404).json({ error: "Không tìm thấy người dùng" });
    }

    await user.deleteOne();
    await UserLock.deleteMany({ user: user._id });

    await recordLog({
      user: req.user._id,
      action: "user.delete",
      metadata: { targetUser: user._id },
    });

    res.json({ success: true });
  } catch (error) {
    console.error("Delete user error", error);
    res.status(500).json({ error: "Không thể xoá người dùng" });
  }
};

const resetAccessCode = async (req, res) => {
  try {
    const targetId = req.params.id;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(400).json({ error: "ID người dùng không hợp lệ" });
    }

    const user = await User.findById(targetId);
    if (!user) {
      return res.status(404).json({ error: "Không tìm thấy người dùng" });
    }

    user.accessCode = User.generateAccessCode();
    await user.save();

    await recordLog({
      user: req.user._id,
      action: "user.resetAccessCode",
      metadata: { targetUser: user._id },
    });

    res.json({ user });
  } catch (error) {
    console.error("Reset access code error", error);
    res.status(500).json({ error: "Không thể đặt lại access code" });
  }
};

const changePin = async (req, res) => {
  try {
    const targetId = req.params.id;
    const { oldPin, newPin } = req.body;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(400).json({ error: "ID người dùng không hợp lệ" });
    }

    // Users can only change their own PIN
    const isSelf = req.user._id.toString() === targetId;
    if (!isSelf && req.user.role !== "admin") {
      return res.status(403).json({ error: "Không có quyền" });
    }

    if (!newPin) {
      return res.status(400).json({ error: "PIN mới là bắt buộc" });
    }

    const normalizedNewPin = String(newPin).trim();
    if (!User.isValidPin(normalizedNewPin)) {
      return res.status(400).json({ error: "PIN mới phải gồm 4-8 chữ số" });
    }

    const user = await User.findById(targetId);
    if (!user) {
      return res.status(404).json({ error: "Không tìm thấy người dùng" });
    }

    // Verify old PIN (only required for non-admin users changing their own PIN)
    if (isSelf && req.user.role !== "admin") {
      if (!oldPin) {
        return res.status(400).json({ error: "PIN cũ là bắt buộc" });
      }
      if (user.pin !== String(oldPin).trim()) {
        return res.status(401).json({ error: "PIN cũ không đúng" });
      }
    }

    user.pin = normalizedNewPin;
    await user.save();

    await recordLog({
      user: req.user._id,
      action: "user.changePin",
      metadata: { targetUser: user._id },
    });

    res.json({ user });
  } catch (error) {
    console.error("Change PIN error", error);
    res.status(500).json({ error: "Không thể đổi PIN" });
  }
};

const requestOtp = async (req, res) => {
  try {
    const targetId = req.params.id;
    const { lockId, otpExpiry, maxUses } = req.body;

    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(400).json({ error: "ID người dùng không hợp lệ" });
    }

    // lockId is now required
    if (!lockId) {
      return res.status(400).json({ error: "ID thiết bị là bắt buộc" });
    }

    // Validate lockId
    if (!mongoose.Types.ObjectId.isValid(lockId)) {
      return res.status(400).json({ error: "ID thiết bị không hợp lệ" });
    }

    const isSelf = req.user._id.toString() === targetId;
    if (!isSelf && req.user.role !== "admin") {
      return res.status(403).json({ error: "Không có quyền" });
    }

    const user = await User.findById(targetId);
    if (!user) {
      return res.status(404).json({ error: "Không tìm thấy người dùng" });
    }

    // Verify the lock exists and user has access
    const Lock = require("../models/Lock");
    const lock = await Lock.findById(lockId);
    if (!lock) {
      return res.status(404).json({ error: "Không tìm thấy thiết bị" });
    }

    // Check if user has access to this lock
    const UserLock = require("../models/UserLock");
    const hasAccess = await UserLock.exists({
      user: targetId,
      lock: lockId,
    });
    if (!hasAccess && req.user.role !== "admin") {
      return res
        .status(403)
        .json({ error: "Người dùng không có quyền truy cập thiết bị này" });
    }

    // Allow null or 0 for unlimited TTL
    // If otpExpiry is explicitly null or 0, use it (unlimited)
    // Otherwise use user.otpExpiry or default 300
    let ttl;
    if (otpExpiry === null || otpExpiry === 0) {
      ttl = null; // Unlimited TTL
    } else {
      ttl = otpExpiry || user.otpExpiry || 300;
    }

    // Validate maxUses (default to 1 if not provided)
    const normalizedMaxUses =
      maxUses !== undefined && maxUses !== null
        ? Math.max(1, Math.floor(maxUses))
        : 1;

    // createdBy is the person creating the OTP (req.user), not the target user
    const result = await createOtpForUser(
      user._id,
      ttl,
      lockId,
      req.user._id,
      normalizedMaxUses
    );

    console.log(
      `[OTP] Created for ${user.name} on lock ${lock.name} (${lockId})`
    );

    await recordLog({
      user: req.user._id,
      action: "otp.create",
      metadata: {
        targetUser: user._id,
        lockId: lockId,
        expiry: ttl,
        maxUses: normalizedMaxUses,
      },
    });

    res.json({
      otp: result.otp,
      expiresAt: result.expiresAt,
      maxUses: result.maxUses,
    });
  } catch (error) {
    console.error("[OTP] Create OTP error", error);
    res.status(500).json({ error: "Không thể tạo OTP" });
  }
};

module.exports = {
  listUsers,
  createUser,
  getUser,
  updateUser,
  deleteUser,
  resetAccessCode,
  changePin,
  requestOtp,
};
