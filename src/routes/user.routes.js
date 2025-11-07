const express = require("express");

const { authenticateToken, requireAdmin } = require("../middleware/auth");
const {
  listUsers,
  createUser,
  getUser,
  updateUser,
  deleteUser,
  resetAccessCode,
  changePin,
  requestOtp,
} = require("../controllers/user.controller");

const router = express.Router();

router.use(authenticateToken);

router.get("/", requireAdmin, listUsers);
router.post("/", requireAdmin, createUser);
router.get("/:id", getUser);
router.put("/:id", updateUser);
router.delete("/:id", requireAdmin, deleteUser);
router.post("/:id/reset-access-code", requireAdmin, resetAccessCode);
router.post("/:id/change-pin", changePin);
router.post("/:id/otp", requestOtp);

module.exports = router;
