const jwt = require("jsonwebtoken");
const Session = require("../models/Session");
const User = require("../models/User");

const JWT_SECRET =
  process.env.JWT_SECRET || "your-secret-key-change-in-production";
const SESSION_INACTIVITY_SECONDS = parseInt(
  process.env.SESSION_INACTIVITY_SECONDS || "600",
  10
);

const extractToken = (req) => {
  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  if (req.cookies && req.cookies.token) {
    return req.cookies.token;
  }
  return null;
};

const authenticateToken = async (req, res, next) => {
  try {
    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: "Access token required" });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    const session = await Session.findById(decoded.sid).populate("user");
    if (!session || session.revokedAt) {
      return res.status(401).json({ error: "Session invalid" });
    }

    const now = Date.now();
    const expiresAt = session.expiresAt ? session.expiresAt.getTime() : 0;
    if (expiresAt <= now) {
      await session.deleteOne();
      return res.status(401).json({ error: "Session expired" });
    }

    if (
      session.lastActiveAt &&
      now - session.lastActiveAt.getTime() > SESSION_INACTIVITY_SECONDS * 1000
    ) {
      await session.deleteOne();
      return res.status(401).json({ error: "Session timed out" });
    }

    if (!session.user) {
      await session.deleteOne();
      return res.status(401).json({ error: "User not found" });
    }

    req.user = session.user;
    req.session = session;

    session.lastActiveAt = new Date();
    session.expiresAt = new Date(
      Date.now() + SESSION_INACTIVITY_SECONDS * 1000
    );
    await session.save({ validateBeforeSave: false });

    next();
  } catch (error) {
    console.error("Auth error", error);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};

const requireAdmin = (req, res, next) => {
  if (req.user && req.user.role === "admin") {
    return next();
  }
  return res.status(403).json({ error: "Admin access required" });
};

module.exports = {
  authenticateToken,
  requireAdmin,
  JWT_SECRET,
  SESSION_INACTIVITY_SECONDS,
};
