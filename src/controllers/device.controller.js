const mongoose = require("mongoose");
const Lock = require("../models/Lock");
const User = require("../models/User");
const UserLock = require("../models/UserLock");
const UserOTP = require("../models/OTP");
const Setting = require("../models/Setting");
const { recordLog } = require("../utils/logger");

const registerDevice = async (req, res) => {
  console.log(`[API] POST /device/register - ${new Date().toISOString()}`);
  try {
    const { name, location } = req.body;
    console.log(`[API] Register device - name: ${name}, location: ${location || 'N/A'}`);
    if (!name) {
      return res.status(400).json({ error: "Tên thiết bị là bắt buộc" });
    }

    const lock = await Lock.create({ name, location });

    await recordLog({
      lock: lock._id,
      action: "device.register",
      metadata: { name, location, token: lock.token },
    });

    res.status(201).json({
      success: true,
      lock: {
        id: lock._id,
        name: lock.name,
        location: lock.location,
        token: lock.token,
        status: lock.status,
        createdAt: lock.createdAt,
      },
    });
  } catch (error) {
    console.error("Register device error", error);
    res.status(500).json({ error: "Không thể đăng ký thiết bị" });
  }
};

const getCommand = async (req, res) => {
  console.log(`[API] GET /device/cmd - ${new Date().toISOString()}`);
  try {
    const { token } = req.query;
    console.log(`[API] Get command - token: ${token ? token.substring(0, 8) + '...' : 'N/A'}`);
    if (!token) {
      return res.status(400).json({ error: "Thiếu token thiết bị" });
    }

    const lock = await Lock.findOne({ token });
    if (!lock) {
      return res.status(404).json({ error: "Không tìm thấy thiết bị" });
    }

    const command = lock.getNextCommand();
    if (!command) {
      return res.json({ command: null });
    }

    command.status = "sent";
    command.executedAt = new Date();
    lock.lastSeen = new Date();
    await lock.save();

    res.json({
      command: command.command,
      commandId: command._id,
    });
  } catch (error) {
    console.error("Get command error", error);
    res.status(500).json({ error: "Không thể lấy lệnh" });
  }
};

const reportStatus = async (req, res) => {
  console.log(`[API] POST /device/status - ${new Date().toISOString()}`);
  try {
    const { token, status, commandId, success = true } = req.body;
    console.log(`[API] Report status - token: ${token ? token.substring(0, 8) + '...' : 'N/A'}, status: ${status}, commandId: ${commandId || 'N/A'}, pin: ${req.body.pin || req.body.usedPin || 'N/A'}`);
    if (!token || status === undefined || status === null) {
      return res.status(400).json({ error: "Thiếu token hoặc trạng thái" });
    }

    const lock = await Lock.findOne({ token });
    if (!lock) {
      return res.status(404).json({ error: "Không tìm thấy thiết bị" });
    }

    // Xử lý trường hợp status là object hoặc string không hợp lệ
    let statusValue = status;

    // Nếu status là object, bỏ qua và sử dụng giá trị mặc định
    if (typeof status === "object" && status !== null) {
      console.warn("Status là object, sử dụng giá trị mặc định 'unknown'");
      statusValue = "unknown";
    }
    // Nếu status là string, kiểm tra xem có phải JSON string không
    else if (typeof status === "string") {
      // Thử parse nếu là JSON string
      if (status.trim().startsWith("{")) {
        try {
          const parsed = JSON.parse(status);
          // Nếu parse được nhưng vẫn là object, sử dụng unknown
          if (typeof parsed === "object") {
            statusValue = "unknown";
          } else {
            statusValue = parsed;
          }
        } catch (e) {
          // Không phải JSON hợp lệ, sử dụng giá trị string trực tiếp
          statusValue = status;
        }
      } else {
        statusValue = status;
      }
    }

    // Normalize status value
    let normalizedStatus = statusValue;
    if (statusValue === "close") {
      normalizedStatus = "closed";
    }

    // Validate enum values
    const validStatuses = ["open", "closed", "unknown", "opening", "closing"];
    if (!validStatuses.includes(normalizedStatus)) {
      console.warn(
        `Status không hợp lệ: ${normalizedStatus}, sử dụng 'unknown'`
      );
      normalizedStatus = "unknown";
    }

    // Check if status changed
    const statusChanged = lock.status !== normalizedStatus;
    const previousStatus = lock.status;

    lock.status = normalizedStatus;
    lock.lastSeen = new Date();

    if (commandId) {
      const command = lock.commandQueue.id(commandId);
      if (command) {
        command.status = success ? "completed" : "failed";
        command.executedAt = new Date();
      }
    }

    await lock.save();

    // Extract pin information from request body if available
    const pin = req.body.pin || req.body.usedPin || null;

    // Tìm user từ PIN nếu có (chỉ tìm trong các user được assign vào lock này)
    let userId = null;
    if (pin) {
      const assignments = await UserLock.find({ lock: lock._id })
        .populate("user", "_id pin")
        .lean();

      const matchedAssignment = assignments.find(
        (assignment) =>
          assignment.user && assignment.user.pin === pin.toString()
      );

      if (matchedAssignment && matchedAssignment.user) {
        userId = matchedAssignment.user._id;
      }
    }

    // Only log if status changed or there's a commandId (command execution result)
    if (statusChanged || commandId) {
      if (statusChanged) {
        console.log(
          `[Device] Status changed: ${lock.name} ${previousStatus} -> ${normalizedStatus}`
        );
      }

      // Xác định action phù hợp dựa trên status và pin
      let action = "lock.status";
      if (normalizedStatus === "open" && pin) {
        action = "lock.open.withPin";
      } else if (normalizedStatus === "open") {
        action = "lock.open";
      } else if (normalizedStatus === "closed") {
        action = "lock.close";
      }

      await recordLog({
        user: userId || undefined,
        lock: lock._id,
        action: action,
        metadata: {
          status: normalizedStatus,
          previousStatus: statusChanged ? previousStatus : undefined,
          success,
          commandId,
          pin: pin || undefined, // Include pin if provided
          timestamp: new Date().toISOString(),
        },
      });
    } else if (pin && normalizedStatus === "open") {
      // Ghi log khi mở cửa bằng PIN (ngay cả khi status không đổi)
      await recordLog({
        user: userId || undefined,
        lock: lock._id,
        action: "lock.open.withPin",
        metadata: {
          status: normalizedStatus,
          pin: pin,
          timestamp: new Date().toISOString(),
        },
      });
    }
  } catch (error) {
    console.error("Status update error", error);
    res.status(500).json({ error: "Không thể cập nhật trạng thái" });
  }
};

const syncData = async (req, res) => {
  const token = req.query.token || req.body?.token;
  console.log(`[API] GET /device/sync - ${new Date().toISOString()}`);
  console.log(`[API] Sync data - token: ${token ? token.substring(0, 8) + '...' : 'N/A'}, format: ${req.query.format || 'full'}`);
  try {
    if (!token) {
      return res.status(400).json({ error: "Thiếu token thiết bị" });
    }

    const lock = await Lock.findOne({ token });
    if (!lock) {
      console.log(`[Sync] Device not found for token: ${token}`);
      return res.status(404).json({ error: "Không tìm thấy thiết bị" });
    }

    console.log(`[Sync] ${lock.name}: syncing data`);

    const assignments = await UserLock.find({ lock: lock._id })
      .populate("user")
      .lean();

    const users = assignments
      .filter((assignment) => assignment.user)
      .map((assignment) => ({
        id: assignment.user._id.toString(),
        name: assignment.user.name,
        email: assignment.user.email,
        accessCode: assignment.user.accessCode,
        pin: assignment.user.pin,
        otpEnabled: assignment.user.otpEnabled,
        otpExpiry: assignment.user.otpExpiry,
        lastLoginAt: assignment.user.lastLoginAt,
        updatedAt: assignment.user.updatedAt,
      }));

    const userIds = users
      .map((user) => user.id)
      .filter((id) => mongoose.Types.ObjectId.isValid(id));
    const now = new Date();

    // Query OTPs: chỉ lấy OTPs của lock này, còn hiệu lực và chưa hết số lần dùng
    const activeOtps = (
      await UserOTP.find({
        lock: lock._id,
        expiresAt: { $gte: now },
      })
        .populate("user", "name")
        .lean()
    ).filter((otp) => otp.usedCount < otp.maxUses); // Lọc OTP còn số lần dùng

    // Get access codes for OTP users
    const otpUserIds = activeOtps
      .map((otp) => {
        if (otp.user && typeof otp.user === "object" && otp.user._id) {
          return otp.user._id.toString();
        }
        return otp.user?.toString() || otp.user;
      })
      .filter((id) => id && mongoose.Types.ObjectId.isValid(id));

    let accessCodeMap = new Map();
    if (otpUserIds.length > 0) {
      const otpUsers = await User.find({ _id: { $in: otpUserIds } })
        .select("_id accessCode")
        .lean();

      otpUsers.forEach((user) => {
        accessCodeMap.set(user._id.toString(), user.accessCode);
      });
    }

    const otps = activeOtps.map((otp) => {
      let userId;
      if (otp.user && typeof otp.user === "object" && otp.user._id) {
        userId = otp.user._id.toString();
      } else {
        userId = otp.user?.toString() || otp.user;
      }
      const remainingUses = (otp.maxUses || 1) - (otp.usedCount || 0);
      return {
        id: otp._id,
        userId: userId,
        lockId: otp.lock?.toString() || otp.lock || null,
        accessCode: accessCodeMap.get(userId) || null,
        code: otp.otp,
        expiresAt: otp.expiresAt,
        maxUses: otp.maxUses || 1,
        usedCount: otp.usedCount || 0,
        remainingUses: remainingUses,
      };
    });

    const otpExpiry = Number(await Setting.getValue("otp_default_expiry", 300));

    // Create a combined format for ESP: merge users with their OTPs
    // Since OTPs are now lock-specific, we can directly match users with their OTPs
    const espUsers = users.map((user) => {
      // Find OTP for this user in the lock's OTPs
      const userOtp = otps.find(
        (otp) => otp.userId && otp.userId.toString() === user.id.toString()
      );

      const userData = {
        id: user.id.toString(),
        name: user.name,
        email: user.email,
        accessCode: user.accessCode,
        pin: user.pin,
        otpEnabled: user.otpEnabled || false,
      };

      // Add OTP if it exists for this user
      if (userOtp && userOtp.code) {
        userData.otp = userOtp.code;
        userData.otpExpiresAt = userOtp.expiresAt;
      }

      return userData;
    });

    // Check if ESP requests simple format (array only)
    const simpleFormat =
      req.query.format === "simple" || req.query.format === "esp";

    if (simpleFormat) {
      // ESP needs all OTPs with TTL, not just merged with users
      const espResponse = {
        users: espUsers,
        otps: otps.map((otp) => ({
          userId: otp.userId,
          code: otp.code,
          expiresAt: otp.expiresAt,
          accessCode: otp.accessCode,
        })),
        serverTime: new Date().toISOString(),
      };
      console.log(
        `[Sync] ${lock.name}: ${espUsers.length} users, ${otps.length} OTPs`
      );
      return res.json(espResponse);
    }

    // Full format with all metadata
    const response = {
      lock: {
        id: lock._id,
        name: lock.name,
        location: lock.location,
        status: lock.status,
        lastSeen: lock.lastSeen,
        updatedAt: lock.updatedAt,
      },
      users: espUsers,
      otps,
      settings: {
        otpExpiry,
      },
      serverTime: new Date().toISOString(),
    };

    res.json(response);
  } catch (error) {
    console.error("Sync data error", error);
    res.status(500).json({ error: "Không thể đồng bộ dữ liệu" });
  }
};

const syncLogs = async (req, res) => {
  console.log(`[API] POST /device/logs/sync - ${new Date().toISOString()}`);
  try {
    const { token, logs } = req.body || {};
    console.log(`[API] Sync logs - token: ${token ? token.substring(0, 8) + '...' : 'N/A'}, logs count: ${Array.isArray(logs) ? logs.length : 0}`);
    if (!token) {
      return res.status(400).json({ error: "Thiếu token thiết bị" });
    }
    if (!Array.isArray(logs) || logs.length === 0) {
      return res.json({ received: 0 });
    }

    const lock = await Lock.findOne({ token });
    if (!lock) {
      return res.status(404).json({ error: "Không tìm thấy thiết bị" });
    }

    const assignments = await UserLock.find({ lock: lock._id })
      .populate("user", "_id accessCode")
      .lean();

    const accessCodeToUserId = new Map();
    assignments.forEach((assignment) => {
      if (assignment.user?.accessCode) {
        accessCodeToUserId.set(assignment.user.accessCode, assignment.user._id);
      }
    });

    const results = await Promise.all(
      logs.map(async (log) => {
        try {
          const rawUser = log.user || log.accessCode || log.userId;
          let userId = null;

          if (log.userId) {
            userId = log.userId;
          } else if (
            typeof rawUser === "string" &&
            accessCodeToUserId.has(rawUser)
          ) {
            userId = accessCodeToUserId.get(rawUser);
          } else if (typeof rawUser === "string") {
            const matchedUser = await User.findOne({
              accessCode: rawUser,
            }).select("_id");
            if (matchedUser) {
              userId = matchedUser._id;
              accessCodeToUserId.set(rawUser, matchedUser._id);
            }
          }

          // Extract pin information from log if available
          // ESP should send pin in log.pin, log.usedPin, or log.metadata.pin
          const pin = log.pin || log.usedPin || log.metadata?.pin || null;

          await recordLog({
            user: userId,
            lock: lock._id,
            action: `device.${log.action || "event"}`,
            metadata: {
              ...log,
              pin: pin || undefined, // Include pin if provided
              source: "device",
              receivedAt: new Date().toISOString(),
            },
            createdAt: log.time ? new Date(log.time) : undefined,
          });
          return true;
        } catch (innerError) {
          console.error("Sync log entry error", innerError);
          return false;
        }
      })
    );

    const processed = results.filter(Boolean).length;

    res.json({ received: processed });
  } catch (error) {
    console.error("Sync logs error", error);
    res.status(500).json({ error: "Không thể đồng bộ logs" });
  }
};

const consumeOtp = async (req, res) => {
  console.log(`[API] POST /device/otp/consume - ${new Date().toISOString()}`);
  try {
    const { token, otp } = req.body;
    console.log(`[API] Consume OTP - token: ${token ? token.substring(0, 8) + '...' : 'N/A'}, otp: ${otp || 'N/A'}`);

    // ESP chỉ gửi token và otp
    if (!token || !otp) {
      return res.status(400).json({ error: "Thiếu token thiết bị hoặc mã OTP" });
    }

    const lock = await Lock.findOne({ token });
    if (!lock) {
      return res.status(404).json({ error: "Không tìm thấy thiết bị" });
    }

    const now = new Date();
    // Tìm OTP hợp lệ với lock + code, chưa hết hạn
    let otpRecord = await UserOTP.findOne({
      lock: lock._id,
      otp: otp.toString(),
      expiresAt: { $gte: now },
    }).populate("user", "name email");

    // Nếu có, kiểm tra số lần đã dùng
    if (otpRecord && otpRecord.usedCount >= otpRecord.maxUses) {
      otpRecord = null;
    }

    if (!otpRecord) {
      // Không tìm thấy OTP hợp lệ, trả về lỗi 404 đơn giản cho ESP.
      return res.status(404).json({
        error: "Không tìm thấy OTP, OTP đã hết hạn hoặc đã hết số lần dùng",
      });
    }

    // Tăng usedCount
    otpRecord.usedCount += 1;
    const remainingUses = otpRecord.maxUses - otpRecord.usedCount;

    // Nếu đã hết số lần dùng thì xóa OTP, còn thì lưu lại
    if (otpRecord.usedCount >= otpRecord.maxUses) {
      await UserOTP.deleteOne({ _id: otpRecord._id });
    } else {
      await otpRecord.save();
    }

    // Ghi log
    await recordLog({
      user: otpRecord.user,
      lock: lock._id,
      action: "otp.consume",
      metadata: {
        otp: otp,
        usedCount: otpRecord.usedCount,
        maxUses: otpRecord.maxUses,
        remainingUses,
        consumedAt: new Date().toISOString(),
        source: "device",
      },
    });

    console.log(
      `[Device] OTP consumed: ${lock.name} - User: ${
        otpRecord.user?._id || "unknown"
      } - OTP: ${otp} - Uses: ${otpRecord.usedCount}/${otpRecord.maxUses}`
    );

    // Phản hồi đơn giản cho ESP chỉ cần status 200 là đủ.
    res.json({
      success: true,
      usedCount: otpRecord.usedCount,
      maxUses: otpRecord.maxUses,
      remainingUses,
    });
  } catch (error) {
    console.error("Consume OTP error", error);
    res.status(500).json({ error: "Không thể xử lý OTP" });
  }
};

module.exports = {
  registerDevice,
  getCommand,
  reportStatus,
  syncData,
  syncLogs,
  consumeOtp,
};
