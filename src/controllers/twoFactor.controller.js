const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const User = require("../models/User");
const { recordLog } = require("../utils/logger");

// Thiết lập 2FA - tạo secret và QR code
const setupTwoFactor = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).select(
      "+twoFactorSecret +backupCodes"
    );

    if (!user) {
      return res.status(404).json({ error: "Không tìm thấy người dùng" });
    }

    // Nếu đã bật 2FA, cần tắt trước
    if (user.twoFactorEnabled) {
      return res.status(400).json({
        error: "2FA đã được bật. Vui lòng tắt trước khi thiết lập lại",
      });
    }

    // Tạo secret key mới
    const secret = speakeasy.generateSecret({
      name: `SmartLock (${user.email})`,
      issuer: "SmartLock",
      length: 32,
    });

    // Lưu secret tạm thời (chưa enable)
    user.twoFactorSecret = secret.base32;
    await user.save();

    // Tạo QR code
    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

    await recordLog({
      user: userId,
      action: "2fa.setup",
      metadata: {},
    });

    res.json({
      secret: secret.base32,
      qrCode: qrCodeUrl,
      manualEntryKey: secret.base32,
    });
  } catch (error) {
    console.error("Setup 2FA error", error);
    res.status(500).json({ error: "Không thể thiết lập 2FA" });
  }
};

// Xác nhận và kích hoạt 2FA
const verifyAndEnableTwoFactor = async (req, res) => {
  try {
    const userId = req.user._id;
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: "Mã xác thực là bắt buộc" });
    }

    const user = await User.findById(userId).select(
      "+twoFactorSecret +backupCodes"
    );

    if (!user || !user.twoFactorSecret) {
      return res.status(400).json({
        error: "Chưa thiết lập 2FA. Vui lòng thiết lập trước",
      });
    }

    if (user.twoFactorEnabled) {
      return res.status(400).json({ error: "2FA đã được kích hoạt" });
    }

    // Xác thực token
    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: "base32",
      token: token,
      window: 2, // Cho phép sai lệch ±2 time step (60 giây)
    });

    if (!verified) {
      return res.status(400).json({ error: "Mã xác thực không hợp lệ" });
    }

    // Kích hoạt 2FA và tạo backup codes
    user.twoFactorEnabled = true;
    const backupCodes = User.generateBackupCodes(8);
    const hashedBackupCodes = await Promise.all(
      backupCodes.map((code) => user.hashBackupCode(code))
    );
    user.backupCodes = hashedBackupCodes;
    await user.save();

    await recordLog({
      user: userId,
      action: "2fa.enable",
      metadata: {},
    });

    res.json({
      success: true,
      backupCodes, // Chỉ hiển thị một lần, người dùng cần lưu lại
      message:
        "2FA đã được kích hoạt. Vui lòng lưu backup codes ở nơi an toàn.",
    });
  } catch (error) {
    console.error("Verify and enable 2FA error", error);
    res.status(500).json({ error: "Không thể kích hoạt 2FA" });
  }
};

// Xác thực 2FA khi đăng nhập
const verifyTwoFactorLogin = async (req, res) => {
  try {
    const { email, token, backupCode } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email là bắt buộc" });
    }

    if (!token && !backupCode) {
      return res
        .status(400)
        .json({ error: "Mã xác thực hoặc backup code là bắt buộc" });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select(
      "+twoFactorSecret +backupCodes"
    );

    if (!user) {
      return res.status(404).json({ error: "Không tìm thấy người dùng" });
    }

    if (!user.twoFactorEnabled) {
      return res
        .status(400)
        .json({ error: "2FA chưa được bật cho tài khoản này" });
    }

    let verified = false;

    // Xác thực bằng backup code nếu có
    if (backupCode) {
      verified = await user.verifyBackupCode(backupCode);
      if (verified) {
        await recordLog({
          user: user._id,
          action: "2fa.verify.backup_code",
          metadata: { ip: req.ip },
        });
      }
    } else if (token && user.twoFactorSecret) {
      // Xác thực bằng TOTP token
      verified = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: "base32",
        token: token,
        window: 2,
      });

      if (verified) {
        await recordLog({
          user: user._id,
          action: "2fa.verify.totp",
          metadata: { ip: req.ip },
        });
      }
    }

    if (!verified) {
      return res.status(401).json({ error: "Mã xác thực không hợp lệ" });
    }

    res.json({
      verified: true,
      userId: user._id.toString(),
    });
  } catch (error) {
    console.error("Verify 2FA login error", error);
    res.status(500).json({ error: "Không thể xác thực 2FA" });
  }
};

// Lấy backup codes (nếu chưa lưu)
const getBackupCodes = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).select("+backupCodes");

    if (!user) {
      return res.status(404).json({ error: "Không tìm thấy người dùng" });
    }

    if (!user.twoFactorEnabled) {
      return res.status(400).json({ error: "2FA chưa được bật" });
    }

    // Chỉ trả về số lượng backup codes còn lại
    res.json({
      remainingCount: user.backupCodes ? user.backupCodes.length : 0,
      message: "Backup codes chỉ được hiển thị một lần khi kích hoạt 2FA",
    });
  } catch (error) {
    console.error("Get backup codes error", error);
    res.status(500).json({ error: "Không thể lấy backup codes" });
  }
};

// Tạo lại backup codes
const generateBackupCodes = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).select("+backupCodes");

    if (!user) {
      return res.status(404).json({ error: "Không tìm thấy người dùng" });
    }

    if (!user.twoFactorEnabled) {
      return res.status(400).json({ error: "2FA chưa được bật" });
    }

    // Tạo backup codes mới
    const backupCodes = User.generateBackupCodes(8);
    const hashedBackupCodes = await Promise.all(
      backupCodes.map((code) => user.hashBackupCode(code))
    );
    user.backupCodes = hashedBackupCodes;
    await user.save();

    await recordLog({
      user: userId,
      action: "2fa.regenerate_backup_codes",
      metadata: {},
    });

    res.json({
      backupCodes,
      message: "Backup codes mới đã được tạo. Vui lòng lưu ở nơi an toàn.",
    });
  } catch (error) {
    console.error("Generate backup codes error", error);
    res.status(500).json({ error: "Không thể tạo backup codes" });
  }
};

// Tắt 2FA
const disableTwoFactor = async (req, res) => {
  try {
    const userId = req.user._id;
    const { password, backupCode } = req.body;

    if (!password && !backupCode) {
      return res.status(400).json({
        error: "Cần mật khẩu hoặc backup code để tắt 2FA",
      });
    }

    const user = await User.findById(userId).select(
      "+twoFactorSecret +backupCodes"
    );

    if (!user) {
      return res.status(404).json({ error: "Không tìm thấy người dùng" });
    }

    if (!user.twoFactorEnabled) {
      return res.status(400).json({ error: "2FA chưa được bật" });
    }

    // Xác thực bằng mật khẩu hoặc backup code
    let verified = false;

    if (password) {
      verified = await user.comparePassword(password);
    } else if (backupCode) {
      verified = await user.verifyBackupCode(backupCode);
    }

    if (!verified) {
      return res.status(401).json({ error: "Xác thực không thành công" });
    }

    // Tắt 2FA và xóa secret, backup codes
    user.twoFactorEnabled = false;
    user.twoFactorSecret = undefined;
    user.backupCodes = [];
    await user.save();

    await recordLog({
      user: userId,
      action: "2fa.disable",
      metadata: {},
    });

    res.json({
      success: true,
      message: "2FA đã được tắt",
    });
  } catch (error) {
    console.error("Disable 2FA error", error);
    res.status(500).json({ error: "Không thể tắt 2FA" });
  }
};

// Kiểm tra trạng thái 2FA
const getTwoFactorStatus = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).select("+backupCodes");

    if (!user) {
      return res.status(404).json({ error: "Không tìm thấy người dùng" });
    }

    res.json({
      twoFactorEnabled: user.twoFactorEnabled || false,
      backupCodesRemaining: user.backupCodes ? user.backupCodes.length : 0,
    });
  } catch (error) {
    console.error("Get 2FA status error", error);
    res.status(500).json({ error: "Không thể lấy trạng thái 2FA" });
  }
};

module.exports = {
  setupTwoFactor,
  verifyAndEnableTwoFactor,
  verifyTwoFactorLogin,
  getBackupCodes,
  generateBackupCodes,
  disableTwoFactor,
  getTwoFactorStatus,
};
