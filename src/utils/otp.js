const User = require("../models/User");
const UserOTP = require("../models/OTP");

const generateOtpCode = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

const createOtpForUser = async (
  userId,
  expirySeconds,
  lockId = null,
  createdBy = null,
  maxUses = 1
) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error("User not found");
  }

  // If createdBy not provided, use userId (user creating OTP for themselves)
  if (!createdBy) {
    createdBy = userId;
  }

  // If expirySeconds is null, 0, or undefined, OTP never expires
  // Set expiresAt to a very far future date (100 years from now) or null
  let expiresAt = null;
  if (
    expirySeconds !== null &&
    expirySeconds !== undefined &&
    expirySeconds > 0
  ) {
    expiresAt = new Date(Date.now() + expirySeconds * 1000);
  } else {
    // For unlimited TTL, set to a very far future date (100 years)
    // Using null might cause issues with queries, so we use a far future date
    expiresAt = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000); // 100 years
  }

  const otp = generateOtpCode();

  // Only delete expired OTPs, allow multiple active OTPs for the same user+lock
  const now = new Date();
  const deleteQuery = {
    user: userId,
    expiresAt: { $lt: now },
  };
  if (lockId) {
    deleteQuery.lock = lockId;
  }
  await UserOTP.deleteMany(deleteQuery);

  // Optional: Limit max active OTPs per user+lock (e.g., max 10)
  // Active OTPs are those with expiresAt >= now (includes unlimited OTPs set to 100 years in future)
  const maxOtps = 10;
  const activeOtpsQuery = {
    user: userId,
    expiresAt: { $gte: now },
  };
  if (lockId) {
    activeOtpsQuery.lock = lockId;
  } else {
    activeOtpsQuery.$or = [{ lock: { $exists: false } }, { lock: null }];
  }
  const activeOtps = await UserOTP.find(activeOtpsQuery).sort({
    createdAt: -1,
  });

  // If exceeds limit, delete oldest ones
  if (activeOtps.length >= maxOtps) {
    const toDelete = activeOtps.slice(maxOtps - 1);
    await UserOTP.deleteMany({
      _id: { $in: toDelete.map((o) => o._id) },
    });
  }

  // Validate maxUses
  const normalizedMaxUses = Math.max(1, Math.floor(maxUses || 1));

  const record = await UserOTP.create({
    user: userId,
    lock: lockId || undefined,
    createdBy,
    otp,
    expiresAt,
    maxUses: normalizedMaxUses,
    usedCount: 0,
  });

  return { otp: record.otp, expiresAt, maxUses: record.maxUses };
};

const verifyOtp = async ({ email, otp }) => {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    return { valid: false };
  }

  const record = await UserOTP.findOne({ user: user._id, otp });
  if (!record) {
    return { valid: false };
  }

  // Check expiration - if expiresAt is set and in the past, OTP is expired
  // If expiresAt is very far in future (100 years), it's considered unlimited
  if (record.expiresAt) {
    const now = Date.now();
    const expiresAtTime = record.expiresAt.getTime();
    // Consider dates more than 50 years in future as "unlimited" (safety margin)
    const fiftyYearsFromNow = Date.now() + 50 * 365 * 24 * 60 * 60 * 1000;
    if (expiresAtTime < now && expiresAtTime < fiftyYearsFromNow) {
      await record.deleteOne();
      return { valid: false };
    }
  }

  await record.deleteOne();
  return { valid: true, user };
};

module.exports = {
  generateOtpCode,
  createOtpForUser,
  verifyOtp,
};
