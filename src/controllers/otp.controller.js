const mongoose = require("mongoose");
const UserOTP = require("../models/OTP");
const User = require("../models/User");
const Lock = require("../models/Lock");
const { recordLog } = require("../utils/logger");
const { verifyOtp } = require("../utils/otp");

const listOtps = async (req, res) => {
  try {
    const { lockId, userId, status = "active" } = req.query;
    const now = new Date();

    // Build query
    const query = {};

    // Permission check: non-admin users can only see OTPs they created
    if (req.user.role !== "admin") {
      query.createdBy = req.user._id;
    }

    // Filter by lock
    if (lockId) {
      if (!mongoose.Types.ObjectId.isValid(lockId)) {
        return res.status(400).json({ error: "ID thiết bị không hợp lệ" });
      }
      query.lock = lockId;
    }

    // Filter by user
    if (userId) {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ error: "ID người dùng không hợp lệ" });
      }
      query.user = userId;
    }

    // Filter by status
    // Active OTPs: expiresAt >= now (includes unlimited OTPs set to 100 years in future)
    // Expired OTPs: expiresAt < now and not unlimited (unlimited OTPs have expiresAt very far in future)
    if (status === "active") {
      query.expiresAt = { $gte: now };
    } else if (status === "expired") {
      // Expired OTPs are those with expiresAt < now
      // Unlimited OTPs (100 years in future) won't match this
      query.expiresAt = { $lt: now };
    }

    // Fetch OTPs with populated user, lock, and createdBy
    let otps = await UserOTP.find(query)
      .populate("user", "name email accessCode")
      .populate("lock", "name location")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 })
      .lean();

    // Filter active OTPs to only show those with remaining uses
    if (status === "active") {
      otps = otps.filter((otp) => (otp.usedCount || 0) < (otp.maxUses || 1));
    }

    // Format response
    const formattedOtps = otps.map((otp) => {
      // Check if OTP is unlimited (expiresAt is very far in future, > 50 years)
      const fiftyYearsFromNow = new Date(
        now.getTime() + 50 * 365 * 24 * 60 * 60 * 1000
      );
      const isUnlimited =
        otp.expiresAt && new Date(otp.expiresAt) > fiftyYearsFromNow;
      const isExpired = otp.expiresAt ? new Date(otp.expiresAt) < now : false;
      const expiresIn = isUnlimited
        ? null // null indicates unlimited
        : Math.max(0, Math.floor((new Date(otp.expiresAt) - now) / 1000));

      const maxUses = otp.maxUses || 1;
      const usedCount = otp.usedCount || 0;
      const remainingUses = maxUses - usedCount;
      const isExhausted = remainingUses <= 0;

      return {
        id: otp._id,
        code: otp.otp,
        user: otp.user
          ? {
              id: otp.user._id,
              name: otp.user.name,
              email: otp.user.email,
              accessCode: otp.user.accessCode,
            }
          : null,
        lock: otp.lock
          ? {
              id: otp.lock._id,
              name: otp.lock.name,
              location: otp.lock.location,
            }
          : null,
        createdBy: otp.createdBy
          ? {
              id: otp.createdBy._id,
              name: otp.createdBy.name,
              email: otp.createdBy.email,
            }
          : null,
        expiresAt: otp.expiresAt,
        expiresIn,
        isExpired,
        isUnlimited: isUnlimited || false,
        maxUses,
        usedCount,
        remainingUses,
        isExhausted,
        createdAt: otp.createdAt,
        consumedAt: otp.consumedAt || null,
      };
    });

    res.json({ otps: formattedOtps, count: formattedOtps.length });
  } catch (error) {
    console.error("List OTPs error", error);
    res.status(500).json({ error: "Không thể tải danh sách OTP" });
  }
};

const verifyOtpCode = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ error: "Thiếu email hoặc OTP" });
    }

    const result = await verifyOtp({ email, otp });

    if (result.valid) {
      await recordLog({
        user: result.user._id,
        action: "otp.verify",
        metadata: { email },
      });
    }

    res.json({ valid: result.valid });
  } catch (error) {
    console.error("Verify OTP error", error);
    res.status(500).json({ error: "Không thể xác thực OTP" });
  }
};

module.exports = {
  listOtps,
  verifyOtpCode,
};
