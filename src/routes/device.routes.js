const express = require("express");

const {
  registerDevice,
  getCommand,
  reportStatus,
  syncData,
  syncLogs,
  consumeOtp,
} = require("../controllers/device.controller");

const router = express.Router();

router.post("/register", registerDevice);
router.get("/cmd", getCommand);
router.post("/status", reportStatus);
router.get("/sync", syncData);
router.post("/logs/sync", syncLogs);
router.post("/otp/consume", consumeOtp);

module.exports = router;
