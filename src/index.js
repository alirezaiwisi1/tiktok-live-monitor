/**
 * index.js — entry point + JSON API (ESM).
 * Loads env, accounts, notifier; starts one independent monitor per account.
 * Exposes GET /api/status and GET /health for the website.
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import { accounts } from "./accounts.js";
import { startAll, stopAll, getStates, addAccounts } from "./tiktok-monitor.js";
import { telegramConfigured, log } from "./notifier.js";

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

// --- CORS ---
// WEBSITE_ORIGIN = comma-separated list of allowed origins (no trailing slash).
// Example: WEBSITE_ORIGIN=https://my-site.onrender.com,https://my-site.netlify.app
// Unset => CORS open (any origin) so the site works before configuration.
const allowedOrigins = (process.env.WEBSITE_ORIGIN || "")
  .split(",")
  .map((s) => s.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const corsOptions = allowedOrigins.length
  ? {
      origin(origin, cb) {
        // /api/status is public read-only data — never block it in a browser.
        // Deny only means "don't emit CORS headers", which the browser enforces
        // itself; throwing here used to turn every browser request into a 500.
        cb(null, true);
      },
    }
  : {}; // open CORS until WEBSITE_ORIGIN is configured
app.use(cors(corsOptions));
if (allowedOrigins.length) {
  log("info", `CORS: allowing origins: ${allowedOrigins.join(", ")}`);
} else {
  log("warn", "CORS: WEBSITE_ORIGIN not set — allowing all origins");
}

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

// --- Auto-discovery: merge accounts from the website roster so a new TikTok
// account added via the CMS starts being monitored without a redeploy. Never
// removes accounts — removal stays a deliberate code change here.
const ROSTER_URL = process.env.ROSTER_URL || "https://aroplfarsi.pages.dev/assets/js/tiktok-accounts.js";
const ROSTER_REFRESH_MS = parseInt(process.env.ROSTER_REFRESH_MS || "600000", 10);
async function refreshRoster() {
  try {
    const res = await fetch(ROSTER_URL, { headers: { accept: "application/javascript", "user-agent": "aropl-live-monitor/1.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const js = await res.text();
    const names = [...js.matchAll(/username:\s*"([^"]+)"/g)].map((m) => m[1]);
    const fresh = addAccounts(names);
    if (fresh.length) log("info", `Roster refresh: started monitoring ${fresh.join(", ")}`);
  } catch (err) {
    log("warn", `Roster refresh failed: ${err.message}`);
  }
}
refreshRoster();
setInterval(refreshRoster, ROSTER_REFRESH_MS);

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
