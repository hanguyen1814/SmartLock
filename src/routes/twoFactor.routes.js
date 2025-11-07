const express = require("express");
const { authenticateToken } = require("../middleware/auth");
const {
  setupTwoFactor,
  verifyAndEnableTwoFactor,
  getBackupCodes,
  generateBackupCodes,
  disableTwoFactor,
  getTwoFactorStatus,
} = require("../controllers/twoFactor.controller");

const router = express.Router();

// Tất cả routes đều cần đăng nhập
router.use(authenticateToken);

// Lấy trạng thái 2FA
router.get("/status", getTwoFactorStatus);

// Thiết lập 2FA (tạo secret và QR code)
router.post("/setup", setupTwoFactor);

// Xác nhận và kích hoạt 2FA
router.post("/verify", verifyAndEnableTwoFactor);

// Lấy thông tin backup codes (chỉ số lượng)
router.get("/backup-codes", getBackupCodes);

// Tạo lại backup codes
router.post("/backup-codes/generate", generateBackupCodes);

// Tắt 2FA
router.post("/disable", disableTwoFactor);

module.exports = router;
