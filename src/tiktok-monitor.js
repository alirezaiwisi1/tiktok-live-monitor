/**
 * tiktok-monitor.js — per-account LIVE monitoring (ESM).
 *
 * Uses tiktok-live-connector v2 (TikTokLiveConnection).
 * Verified against the installed package (v2.x dist):
 *   - import: { TikTokLiveConnection, WebcastEvent, ControlAction }
 *   - connect() resolves when the streamer is LIVE, rejects otherwise
 *     (e.g. UserOfflineError).
 *   - events actually emitted: "connected", "disconnected", "error",
 *     WebcastEvent.STREAM_END ("streamEnd"), WebcastEvent.CONTROL_MESSAGE
 *     (ControlAction.CONTROL_ACTION_STREAM_ENDED = 3).
 */

import { TikTokLiveConnection, WebcastEvent, ControlAction } from "tiktok-live-connector";
import { notifyLive, log } from "./notifier.js";

const RECONNECT_DELAY_MS = parseInt(process.env.RECONNECT_DELAY_MS || "30000", 10);

/** username -> { connection, state, reconnectTimer, connecting } */
const monitors = new Map();

function newState(username) {
  return {
    username,
    isLive: false,
    connected: false,
    lastLiveAt: null,
    lastOfflineAt: null,
    lastNotificationAt: null,
  };
}

/** Schedule a reconnect with a single timer per account. */
function scheduleReconnect(username, reason) {
  const m = monitors.get(username);
  if (!m) return;
  if (m.reconnectTimer) clearTimeout(m.reconnectTimer); // avoid duplicate timers
  log("warn", `Reconnecting @${username} in ${RECONNECT_DELAY_MS}ms (${reason})`);
  m.reconnectTimer = setTimeout(() => {
    m.reconnectTimer = null;
    startMonitor(username).catch((err) =>
      log("error", `Reconnect for @${username} failed: ${err.message}`)
    );
  }, RECONNECT_DELAY_MS);
}

function goOffline(username, mon, reason) {
  const wasLive = mon.state.isLive;
  mon.state.isLive = false;
  mon.state.connected = false;
  mon.state.lastOfflineAt = new Date().toISOString();
  mon.state.lastNotificationAt = null; // re-arm notification for next session
  if (wasLive) log("info", `@${username} went OFFLINE (${reason})`);
}

/**
 * Start (or restart) monitoring one account.
 * Guarantees only one active connection per username.
 */
export async function startMonitor(username) {
  if (!monitors.has(username)) {
    monitors.set(username, {
      state: newState(username),
      connection: null,
      reconnectTimer: null,
      connecting: false,
    });
  }
  const mon = monitors.get(username);
  if (mon.connecting || mon.connected) return; // duplicate connection guard

  // Clean up any previous connection before reconnecting.
  if (mon.connection) {
    try { mon.connection.disconnect(); } catch { /* ignore */ }
    mon.connection = null;
  }

  mon.connecting = true;
  const connection = new TikTokLiveConnection(username, {});
  mon.connection = connection;

  connection.on("connected", (state) => {
    mon.connecting = false;
    mon.connected = true;
    mon.state.connected = true;
    mon.state.isLive = true;
    mon.state.lastLiveAt = new Date().toISOString();

    // OFFLINE -> LIVE transition: notify once per session.
    if (!mon.state.lastNotificationAt) {
      mon.state.lastNotificationAt = new Date().toISOString();
      notifyLive(username); // async, errors handled inside notifier
    }
    log("info", `@${username} is LIVE (roomId ${state?.roomId ?? "?"})`);
  });

  connection.on("disconnected", () => {
    mon.connecting = false;
    goOffline(username, mon, "disconnected");
    scheduleReconnect(username, "disconnected");
  });

  connection.on("streamEnd", () => {
    goOffline(username, mon, "stream ended");
    // Stream over: drop the connection and poll again later.
    try { connection.disconnect(); } catch { /* ignore */ }
    mon.connected = false;
    scheduleReconnect(username, "stream ended");
  });

  connection.on("error", (err) => {
    log("error", `@${username} connection error: ${err?.message ?? err}`);
  });

  // Stream officially ended via control message (action = 3).
  connection.on(WebcastEvent.CONTROL_MESSAGE, (msg) => {
    if (msg?.action === ControlAction.CONTROL_ACTION_STREAM_ENDED) {
      goOffline(username, mon, "control: stream ended");
    }
  });

  log("info", `Connecting to @${username}...`);
  try {
    await connection.connect();
    // "connected" handler fires on success; connect() only resolves when live.
  } catch (err) {
    mon.connecting = false;
    mon.connected = false;
    const name = err?.name || err?.constructor?.name || "";
    if (/offline/i.test(name) || /offline/i.test(err?.message || "")) {
      // Not live right now — normal case; poll again after the delay.
      log("info", `@${username} is not LIVE right now`);
    } else {
      log("warn", `Unable to connect to @${username}: ${err?.message ?? err}`);
    }
    scheduleReconnect(username, "not live / connect failed");
  }
}

/** Start monitoring a list of accounts. One failure never stops the others. */
export function startAll(accountList) {
  for (const username of accountList) {
    try {
      startMonitor(username).catch((err) =>
        log("error", `Monitor for @${username} crashed: ${err.message}`)
      );
    } catch (err) {
      log("error", `Monitor for @${username} failed to start: ${err.message}`);
    }
  }
}

/** Graceful shutdown: stop timers and disconnect everything. */
export function stopAll() {
  for (const [username, mon] of monitors) {
    if (mon.reconnectTimer) {
      clearTimeout(mon.reconnectTimer);
      mon.reconnectTimer = null;
    }
    if (mon.connection) {
      try { mon.connection.disconnect(); } catch { /* ignore */ }
    }
    mon.connected = false;
    log("info", `Stopped @${username}`);
  }
}

export function getStates() {
  return [...monitors.values()].map((m) => ({ ...m.state }));
}
