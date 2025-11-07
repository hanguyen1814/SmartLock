const express = require("express");

const { authenticateToken, requireAdmin } = require("../middleware/auth");
const { listLogs, exportLogs } = require("../controllers/log.controller");

const router = express.Router();

router.use(authenticateToken, requireAdmin);

router.get("/", listLogs);
router.get("/export", exportLogs);

module.exports = router;
