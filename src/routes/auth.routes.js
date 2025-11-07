const express = require("express");

const { authenticateToken } = require("../middleware/auth");
const {
  login,
  logout,
  getProfile,
  getDashboard,
  verifyTwoFactorAndCompleteLogin,
} = require("../controllers/auth.controller");

const router = express.Router();

router.post("/login", login);
router.post("/login/verify-2fa", verifyTwoFactorAndCompleteLogin);
router.post("/logout", authenticateToken, logout);
router.get("/me", authenticateToken, getProfile);
router.get("/dashboard", authenticateToken, getDashboard);

module.exports = router;
