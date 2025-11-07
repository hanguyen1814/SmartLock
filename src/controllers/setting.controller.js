const Setting = require("../models/Setting");

const getSettings = async (_req, res) => {
  try {
    const otpExpiry = await Setting.getValue("otp_default_expiry", 300);
    res.json({
      settings: {
        otp_default_expiry: Number(otpExpiry),
        otpOptions: Setting.getOtpExpiryOptions(),
      },
    });
  } catch (error) {
    console.error("Get settings error", error);
    res.status(500).json({ error: "Không thể tải thiết lập" });
  }
};

const updateSettings = async (req, res) => {
  try {
    const { otp_default_expiry: otpExpiry } = req.body;

    if (otpExpiry && !Setting.getOtpExpiryOptions().includes(Number(otpExpiry))) {
      return res.status(400).json({ error: "Giá trị OTP expiry không hợp lệ" });
    }

    if (otpExpiry) {
      await Setting.setValue("otp_default_expiry", Number(otpExpiry));
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Update settings error", error);
    res.status(500).json({ error: "Không thể cập nhật thiết lập" });
  }
};

module.exports = {
  getSettings,
  updateSettings,
};

