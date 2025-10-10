require("dotenv").config();
const express = require("express");
const { Telegraf } = require("telegraf");
const mqtt = require("mqtt");

const {
  BOT_TOKEN,
  WEBHOOK_URL,
  PORT,
  MQTT_URL,
  MQTT_USER,
  MQTT_PASS,
  ADMIN_CHAT_ID,
} = process.env;

const bot = new Telegraf(BOT_TOKEN);
const app = express();

// MQTT client
const mopts = MQTT_USER ? { username: MQTT_USER, password: MQTT_PASS } : {};
const mq = mqtt.connect(MQTT_URL, mopts);
mq.on("connect", () => console.log("MQTT connected"));
mq.subscribe("lock/tele"); // ESP32 publish status/log về đây
mq.on("message", (topic, msg) => {
  if (topic === "lock/tele") {
    // Gửi log/trạng thái về admin, có thể tùy chỉnh gửi đúng chat_id người gọi
    bot.telegram.sendMessage(ADMIN_CHAT_ID, msg.toString());
  }
});

// Middleware đọc web_app_data (Mini App)
app.use(express.json({ limit: "256kb" }));

// Basic ACL
function isAllowed(ctx) {
  // Bạn có thể mở rộng: đọc danh sách users từ DB
  return String(ctx.chat?.id) === String(ADMIN_CHAT_ID);
}

// /start
bot.start((ctx) =>
  ctx.reply("SmartLock Bot ready. Commands: /status, /unlock, /lock, /panel")
);

// Commands
bot.command("status", (ctx) => {
  if (!isAllowed(ctx)) return ctx.reply("Unauthorized");
  mq.publish("lock/cmd", "STATUS");
  ctx.reply("Requested: STATUS");
});

bot.command("unlock", (ctx) => {
  if (!isAllowed(ctx)) return ctx.reply("Unauthorized");
  mq.publish("lock/cmd", "UNLOCK");
  ctx.reply("Requested: UNLOCK");
});

bot.command("lock", (ctx) => {
  if (!isAllowed(ctx)) return ctx.reply("Unauthorized");
  mq.publish("lock/cmd", "LOCK");
  ctx.reply("Requested: LOCK");
});

// Mini App entry
bot.command("panel", (ctx) => {
  if (!isAllowed(ctx)) return ctx.reply("Unauthorized");
  return ctx.reply("Open control panel", {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Open Panel",
            web_app: { url: "https://esp.hanguyen.net/panel/" },
          },
        ],
      ],
    },
  });
});

// Webhook handler
app.use(bot.webhookCallback("/bot"));

// WebApp (Mini App) sendData handler (nếu bạn post về /bot bằng web_app_data)
bot.on("web_app_data", (ctx) => {
  try {
    const data = JSON.parse(ctx.webAppData.data || "{}");
    if (!isAllowed(ctx)) return ctx.reply("Unauthorized");
    const action = String(data.action || "").toUpperCase();
    if (["LOCK", "UNLOCK", "STATUS"].includes(action)) {
      mq.publish("lock/cmd", action);
      ctx.reply(`Requested: ${action}`);
    } else {
      ctx.reply("Unknown action");
    }
  } catch (e) {
    ctx.reply("Invalid data");
  }
});

// Khởi tạo webhook
(async () => {
  await bot.telegram.setWebhook(WEBHOOK_URL);
  console.log("Webhook set:", WEBHOOK_URL);
})();

app.listen(Number(PORT || 3000), () =>
  console.log("Bot server listening on", PORT || 3003)
);
