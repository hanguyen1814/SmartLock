const express = require("express");

const { authenticateToken, requireAdmin } = require("../middleware/auth");
const {
  listLocks,
  createLock,
  updateLock,
  deleteLock,
  openLock,
  closeLock,
  assignUsers,
} = require("../controllers/lock.controller");

const router = express.Router();

router.use(authenticateToken);

router.get("/", listLocks);
router.post("/", requireAdmin, createLock);
router.put("/:id", requireAdmin, updateLock);
router.delete("/:id", requireAdmin, deleteLock);
router.post("/:id/open", requireAdmin, openLock);
router.post("/:id/close", requireAdmin, closeLock);
router.post("/:id/assign", requireAdmin, assignUsers);

module.exports = router;

