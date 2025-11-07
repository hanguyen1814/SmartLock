const express = require("express");

const { authenticateToken, requireAdmin } = require("../middleware/auth");
const {
  getSettings,
  updateSettings,
} = require("../controllers/setting.controller");

const router = express.Router();

router.use(authenticateToken, requireAdmin);

router.get("/", getSettings);
router.put("/", updateSettings);

module.exports = router;
