/**
 * index.js — entry point + JSON API (ESM).
 * Loads env, accounts, notifier; starts one independent monitor per account.
 * Exposes GET /api/status and GET /health for the website.
 */

import "dotenv/config";
import express from "express";
import { accounts } from "./accounts.js";
import { startAll, stopAll, getStates } from "./tiktok-monitor.js";
import { telegramConfigured, log } from "./notifier.js";

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

console.log("====================================");
console.log("TikTok LIVE Monitor");
console.log("====================================");
log("info", `Monitoring ${accounts.length} accounts`);

if (!telegramConfigured) {
  log("warn", "Telegram credentials are missing — notifications disabled, monitoring continues");
} else {
  log("info", "Telegram notifications enabled");
}

accounts.forEach((u) => log("info", `Starting @${u}`));
startAll(accounts);
log("info", "All monitors started");

// --- JSON API ---
app.get("/api/status", (req, res) => {
  const states = getStates();
  res.json({
    live: states.filter((s) => s.isLive),
    offline: states.filter((s) => !s.isLive),
    checkedAt: new Date().toISOString(),
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), accounts: accounts.length });
});

const server = app.listen(PORT, () => {
  log("info", `API listening on http://localhost:${PORT} (GET /api/status, GET /health)`);
});

// Never crash on unexpected errors.
process.on("uncaughtException", (err) => {
  log("error", `Uncaught exception (service keeps running): ${err.message}`);
});
process.on("unhandledRejection", (err) => {
  log("error", `Unhandled rejection (service keeps running): ${err?.message ?? err}`);
});

// Graceful shutdown.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("info", `Shutting down (${signal})...`);
  try {
    stopAll();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  } catch (err) {
    log("error", `During shutdown: ${err.message}`);
    process.exit(0);
  }
  log("info", "All monitors stopped.");
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
