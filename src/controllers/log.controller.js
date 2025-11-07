const mongoose = require("mongoose");
const ActivityLog = require("../models/Log");

const listLogs = async (req, res) => {
  try {
    const page = parseInt(req.query.page || "1", 10);
    const limit = parseInt(req.query.limit || "20", 10);
    const skip = (page - 1) * limit;
    const { lockId, action, userId } = req.query;

    // Build query
    const query = {};
    if (lockId) {
      if (!mongoose.Types.ObjectId.isValid(lockId)) {
        return res.status(400).json({ error: "ID thiết bị không hợp lệ" });
      }
      query.lock = lockId;
    }
    if (userId) {
      if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ error: "ID người dùng không hợp lệ" });
      }
      query.user = userId;
    }
    if (action) {
      query.action = action;
    }

    const [logs, total] = await Promise.all([
      ActivityLog.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("user", "email name")
        .populate("lock", "name location status")
        .lean(),
      ActivityLog.countDocuments(query),
    ]);

    // Format logs with lock status information
    const formattedLogs = logs.map((log) => {
      const formatted = {
        id: log._id,
        action: log.action,
        createdAt: log.createdAt,
        user: log.user
          ? {
              id: log.user._id,
              email: log.user.email,
              name: log.user.name,
            }
          : null,
        lock: log.lock
          ? {
              id: log.lock._id,
              name: log.lock.name,
              location: log.lock.location,
              status: log.lock.status,
            }
          : null,
        metadata: log.metadata || {},
      };

      // Format lock status changes
      if (log.action === "lock.status" && log.metadata) {
        formatted.statusChange = {
          current: log.metadata.status,
          previous: log.metadata.previousStatus,
          commandId: log.metadata.commandId,
          success: log.metadata.success,
          pin: log.metadata.pin || null, // Include pin if available
        };
      }

      // Format lock open/close actions with PIN
      if (
        (log.action === "lock.open.withPin" ||
          log.action === "lock.open" ||
          log.action === "lock.close") &&
        log.metadata
      ) {
        formatted.doorAction = {
          action: log.action === "lock.close" ? "close" : "open",
          status: log.metadata.status || log.lock?.status,
          pin: log.metadata.pin || null,
          previousStatus: log.metadata.previousStatus || null,
          commandId: log.metadata.commandId || null,
          success:
            log.metadata.success !== undefined ? log.metadata.success : true,
        };
      }

      // Add pin information for device events (door opened with pin)
      if (log.metadata && (log.metadata.pin || log.metadata.usedPin)) {
        formatted.usedPin = log.metadata.pin || log.metadata.usedPin || null;
      }

      // Format lock commands
      if (
        (log.action === "lock.command.open" ||
          log.action === "lock.command.close") &&
        log.lock
      ) {
        formatted.command = {
          type: log.action.includes("open") ? "open" : "close",
          lockStatus: log.lock.status,
          pin: log.metadata?.pin || null, // Include pin if available
        };
      }

      // Format device events (ESP logs)
      if (log.action && log.action.startsWith("device.") && log.metadata) {
        if (log.metadata.pin || log.metadata.usedPin) {
          formatted.deviceEvent = {
            pin: log.metadata.pin || log.metadata.usedPin || null,
            action: log.metadata.action || log.action,
          };
        }
      }

      return formatted;
    });

    res.json({
      logs: formattedLogs,
      page,
      total,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("List logs error", error);
    res.status(500).json({ error: "Không thể tải logs" });
  }
};

const exportLogs = async (_req, res) => {
  try {
    const logs = await ActivityLog.find()
      .sort({ createdAt: -1 })
      .populate("user", "email name")
      .populate("lock", "name");

    const header =
      "id,timestamp,userEmail,userName,lockName,action,pin,metadata\n";
    const rows = logs
      .map((log) => {
        const metadata = JSON.stringify(log.metadata || {});
        // Extract pin from metadata
        const pin = log.metadata?.pin || log.metadata?.usedPin || "";
        return [
          log._id,
          log.createdAt.toISOString(),
          log.user ? log.user.email : "",
          log.user ? log.user.name : "",
          log.lock ? log.lock.name : "",
          log.action,
          pin,
          metadata.replace(/"/g, '""'),
        ]
          .map(
            (value) => `"${(value ?? "").toString().replace(/\n|\r/g, " ")}"`
          )
          .join(",");
      })
      .join("\n");

    const csv = `${header}${rows}`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=logs.csv");
    res.send(csv);
  } catch (error) {
    console.error("Export logs error", error);
    res.status(500).json({ error: "Không thể xuất logs" });
  }
};

module.exports = {
  listLogs,
  exportLogs,
};
