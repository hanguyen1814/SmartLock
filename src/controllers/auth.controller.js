const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const User = require("../models/User");
const Session = require("../models/Session");
const Lock = require("../models/Lock");
const ActivityLog = require("../models/Log");
const { recordLog } = require("../utils/logger");
const {
  JWT_SECRET,
  SESSION_INACTIVITY_SECONDS,
} = require("../middleware/auth");

const issueToken = (session, user) =>
  jwt.sign(
    {
      sub: session.user.toString(),
      sid: session._id.toString(),
      role: user.role,
    },
    JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "1d",
      jwtid: session.tokenId,
    }
  );

const respondWithUser = (res, user, token) => {
  if (token) {
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 24 * 60 * 60 * 1000,
    });
  }

  res.json({
    user: {
      ...user,
      role: user.role,
    },
    sessionTimeoutSeconds: SESSION_INACTIVITY_SECONDS,
  });
};

const login = async (req, res) => {
  console.log(`[API] POST /auth/login - ${new Date().toISOString()}`);
  try {
    const { email, password } = req.body;
    console.log(`[API] Login attempt - email: ${email || 'N/A'}`);
    if (!email || !password) {
      return res.status(400).json({ error: "Email và mật khẩu là bắt buộc" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res
        .status(401)
        .json({ error: "Thông tin đăng nhập không hợp lệ" });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res
        .status(401)
        .json({ error: "Thông tin đăng nhập không hợp lệ" });
    }

    // Kiểm tra nếu user có bật 2FA
    // Lưu ý: twoFactorEnabled mặc định là false nếu chưa được set
    const has2FA = user.twoFactorEnabled === true;

    if (has2FA) {
      // Tạo session tạm thời (pending 2FA verification)
      const tempSession = await Session.create({
        user: user._id,
        tokenId: crypto.randomUUID(),
        userAgent: req.headers["user-agent"],
        ipAddress: req.ip,
        lastActiveAt: new Date(),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 phút để verify 2FA
        revokedAt: new Date(), // Tạm thời revoke, sẽ activate khi verify 2FA
      });

      await recordLog({
        user: user._id,
        action: "auth.login.pending_2fa",
        metadata: { ip: req.ip, sessionId: tempSession._id },
      });

      // Trả về thông báo cần xác thực 2FA
      return res.json({
        requiresTwoFactor: true,
        sessionId: tempSession._id.toString(),
        message: "Vui lòng xác thực 2FA để hoàn tất đăng nhập",
        verifyEndpoint: "/api/auth/login/verify-2fa",
      });
    }

    // Không có 2FA, đăng nhập bình thường
    const session = await Session.create({
      user: user._id,
      tokenId: crypto.randomUUID(),
      userAgent: req.headers["user-agent"],
      ipAddress: req.ip,
      lastActiveAt: new Date(),
      expiresAt: new Date(Date.now() + SESSION_INACTIVITY_SECONDS * 1000),
    });

    const token = issueToken(session, user);

    user.lastLoginAt = new Date();
    await user.save();

    await recordLog({
      user: user._id,
      action: "auth.login",
      metadata: { ip: req.ip },
    });

    respondWithUser(res, user.toJSON(), token);
  } catch (error) {
    console.error("Login error", error);
    res.status(500).json({ error: "Không thể đăng nhập" });
  }
};

const logout = async (req, res) => {
  console.log(`[API] POST /auth/logout - ${new Date().toISOString()}`);
  console.log(`[API] Logout - user: ${req.user?.email || 'N/A'}`);
  try {
    if (req.session) {
      req.session.revokedAt = new Date();
      await req.session.save({ validateBeforeSave: false });
    }
    res.clearCookie("token");
    res.json({ success: true });
  } catch (error) {
    console.error("Logout error", error);
    res.status(500).json({ error: "Không thể đăng xuất" });
  }
};

const getProfile = (req, res) => {
  console.log(`[API] GET /auth/me - ${new Date().toISOString()}`);
  console.log(`[API] Get profile - user: ${req.user?.email || 'N/A'}`);
  res.json({
    user: req.user,
    role: req.user.role,
  });
};

const verifyTwoFactorAndCompleteLogin = async (req, res) => {
  console.log(`[API] POST /auth/login/verify-2fa - ${new Date().toISOString()}`);
  try {
    const { sessionId, token, backupCode } = req.body;
    console.log(`[API] Verify 2FA - sessionId: ${sessionId || 'N/A'}, hasToken: ${!!token}, hasBackupCode: ${!!backupCode}`);

    if (!sessionId) {
      return res.status(400).json({ error: "Session ID là bắt buộc" });
    }

    if (!token && !backupCode) {
      return res
        .status(400)
        .json({ error: "Mã xác thực hoặc backup code là bắt buộc" });
    }

    // Validate sessionId format
    if (!sessionId || typeof sessionId !== "string") {
      return res.status(400).json({ error: "Session ID không hợp lệ" });
    }

    // Tìm session tạm thời
    const tempSession = await Session.findById(sessionId);
    if (!tempSession) {
      return res
        .status(401)
        .json({ error: "Session không tồn tại hoặc đã hết hạn" });
    }

    // Kiểm tra session đã được revoke (tạm thời)
    if (!tempSession.revokedAt) {
      return res
        .status(401)
        .json({ error: "Session không hợp lệ cho xác thực 2FA" });
    }

    // Kiểm tra session chưa hết hạn (10 phút)
    if (tempSession.expiresAt.getTime() < Date.now()) {
      await tempSession.deleteOne();
      return res.status(401).json({ error: "Session đã hết hạn" });
    }

    // Lấy user với 2FA fields
    const user = await User.findById(tempSession.user).select(
      "+twoFactorSecret +backupCodes"
    );

    if (!user) {
      await tempSession.deleteOne();
      return res.status(404).json({ error: "Không tìm thấy người dùng" });
    }

    if (!user.twoFactorEnabled) {
      await tempSession.deleteOne();
      return res
        .status(400)
        .json({ error: "2FA chưa được bật cho tài khoản này" });
    }

    // Xác thực 2FA
    const speakeasy = require("speakeasy");
    let verified = false;

    if (backupCode) {
      verified = await user.verifyBackupCode(backupCode);
    } else if (token && user.twoFactorSecret) {
      verified = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: "base32",
        token: token,
        window: 2,
      });
    }

    if (!verified) {
      await recordLog({
        user: user._id,
        action: "auth.login.2fa_failed",
        metadata: { ip: req.ip },
      });
      return res.status(401).json({ error: "Mã xác thực không hợp lệ" });
    }

    // Xác thực thành công, activate session
    tempSession.revokedAt = undefined;
    tempSession.expiresAt = new Date(
      Date.now() + SESSION_INACTIVITY_SECONDS * 1000
    );
    await tempSession.save();

    const authToken = issueToken(tempSession, user);

    user.lastLoginAt = new Date();
    await user.save();

    await recordLog({
      user: user._id,
      action: "auth.login",
      metadata: { ip: req.ip, twoFactor: true },
    });

    respondWithUser(res, user.toJSON(), authToken);
  } catch (error) {
    console.error("Verify 2FA and complete login error", error);
    res.status(500).json({ error: "Không thể hoàn tất đăng nhập" });
  }
};

const getDashboard = async (req, res) => {
  console.log(`[API] GET /auth/dashboard - ${new Date().toISOString()}`);
  console.log(`[API] Get dashboard - user: ${req.user?.email || 'N/A'}`);
  try {
    const [totalUsers, totalLocks, activeLocks, recentLogs] = await Promise.all(
      [
        User.countDocuments(),
        Lock.countDocuments(),
        Lock.countDocuments({ status: "open" }),
        ActivityLog.find()
          .sort({ createdAt: -1 })
          .limit(10)
          .populate("user", "email name")
          .populate("lock", "name"),
      ]
    );

    res.json({
      metrics: {
        totalUsers,
        totalLocks,
        activeLocks,
      },
      recentLogs,
    });
  } catch (error) {
    console.error("Dashboard error", error);
    res.status(500).json({ error: "Không thể tải dữ liệu dashboard" });
  }
};

module.exports = {
  login,
  logout,
  getProfile,
  getDashboard,
  verifyTwoFactorAndCompleteLogin,
};
