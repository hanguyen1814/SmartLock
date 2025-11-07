const mongoose = require("mongoose");

const settingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

settingSchema.statics.getValue = async function getValue(
  key,
  defaultValue = null
) {
  const record = await this.findOne({ key });
  return record ? record.value : defaultValue;
};

settingSchema.statics.setValue = async function setValue(key, value) {
  return this.findOneAndUpdate(
    { key },
    { value },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

settingSchema.statics.getOtpExpiryOptions = function getOtpExpiryOptions() {
  return [30, 60, 300];
};

const Setting = mongoose.model("Setting", settingSchema);

module.exports = Setting;
