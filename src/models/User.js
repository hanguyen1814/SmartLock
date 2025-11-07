const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

const generateAccessCode = () =>
  `AC-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
const PIN_REGEX = /^[0-9]{4,8}$/;
const randomDigit = () => {
  if (typeof crypto.randomInt === "function") {
    return crypto.randomInt(0, 10);
  }
  return Math.floor(Math.random() * 10);
};
const generatePin = () => {
  const length = 4 + Math.floor(Math.random() * 5);
  let pin = "";
  while (pin.length < length) {
    pin += randomDigit().toString();
  }
  return pin;
};

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 8,
    },
    pin: {
      type: String,
      required: true,
      match: PIN_REGEX,
      default: generatePin,
    },
    role: {
      type: String,
      enum: ["admin", "user"],
      default: "user",
    },
    accessCode: {
      type: String,
      required: true,
      unique: true,
      default: generateAccessCode,
    },
    otpEnabled: {
      type: Boolean,
      default: false,
    },
    otpExpiry: {
      type: Number,
      default: 300,
      min: 30,
      max: 3600,
    },
    lastLoginAt: {
      type: Date,
    },
    // 2FA fields
    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    twoFactorSecret: {
      type: String,
      select: false, // Không trả về trong query mặc định để bảo mật
    },
    backupCodes: {
      type: [String],
      select: false, // Không trả về trong query mặc định
      default: [],
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (_doc, ret) => {
        delete ret.password;
        delete ret.twoFactorSecret;
        delete ret.backupCodes;
        delete ret.__v;
        return ret;
      },
    },
  }
);

userSchema.pre("save", async function handlePasswordHash(next) {
  if (!this.isModified("password")) {
    return next();
  }
  try {
    const hash = await bcrypt.hash(this.password, 10);
    this.password = hash;
    return next();
  } catch (err) {
    return next(err);
  }
});

userSchema.methods.comparePassword = async function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

// 2FA methods
userSchema.methods.hashBackupCode = async function hashBackupCode(code) {
  return bcrypt.hash(code, 10);
};

userSchema.methods.verifyBackupCode = async function verifyBackupCode(code) {
  if (!this.backupCodes || this.backupCodes.length === 0) {
    return false;
  }

  for (let i = 0; i < this.backupCodes.length; i++) {
    const isMatch = await bcrypt.compare(code, this.backupCodes[i]);
    if (isMatch) {
      // Xóa backup code đã dùng
      this.backupCodes.splice(i, 1);
      await this.save();
      return true;
    }
  }

  return false;
};

userSchema.statics.generateAccessCode = generateAccessCode;
userSchema.statics.generatePin = generatePin;
userSchema.statics.isValidPin = (value) => PIN_REGEX.test(value);

// Generate backup codes
userSchema.statics.generateBackupCodes = function generateBackupCodes(
  count = 8
) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    // Mã 8 ký tự, gồm chữ và số, dễ đọc (loại bỏ 0, O, I, l để tránh nhầm lẫn)
    const chars = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    let code = "";
    for (let j = 0; j < 8; j++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    codes.push(code);
  }
  return codes;
};

const User = mongoose.model("User", userSchema);

module.exports = User;
