/**
 * notifier.js — Telegram notification provider (ESM).
 *
 * Providers are simple async functions registered on a bus, so future
 * providers (Discord, email, webhooks) can be added without touching
 * the TikTok monitoring code.
 *
 * Telegram failures and missing credentials never crash the service.
 */

const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const LOG_LEVEL = LOG_LEVELS[(process.env.LOG_LEVEL || "info").toLowerCase()] ?? 20;

export function log(level, msg) {
  if ((LOG_LEVELS[level] ?? 20) >= LOG_LEVEL) console.log(`[${level.toUpperCase()}] ${msg}`);
}

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
export const telegramConfigured = Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID);

/** Providers: async (message) => void. Add future providers here. */
const providers = [];

async function sendTelegram(message) {
  if (!telegramConfigured) {
    log("warn", "Telegram credentials are missing — notification skipped");
    return;
  }
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // Never log the token itself.
      log("error", `Telegram notification failed (HTTP ${res.status}) ${body.slice(0, 200)}`);
    } else {
      log("info", "Telegram notification sent");
    }
  } catch (err) {
    log("error", `Telegram notification failed: ${err.message}`);
  }
}

providers.push(sendTelegram);

/** Send a LIVE notification through every registered provider. */
export async function notifyLive(username) {
  const message =
    `🔴 TikTok LIVE\n\n` +
    `@${username} is now LIVE on TikTok.\n\n` +
    `https://www.tiktok.com/@${username}/live`;
  await Promise.allSettled(providers.map((p) => p(message)));
}
