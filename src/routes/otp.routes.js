const express = require("express");
const { authenticateToken } = require("../middleware/auth");

const { listOtps, verifyOtpCode } = require("../controllers/otp.controller");

const router = express.Router();

router.get("/", authenticateToken, listOtps);
router.post("/verify-otp", verifyOtpCode);

module.exports = router;
