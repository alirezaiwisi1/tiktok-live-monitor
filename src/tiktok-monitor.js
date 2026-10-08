/**
 * tiktok-monitor.js — per-account LIVE monitoring (ESM).
 *
 * tiktok-live-connector v2.5.0 verified behavior (probed against the installed dist):
 *   - `connect()` can RESOLVE even when the user is NOT live (TikTok accepts the
 *     websocket for some offline accounts and roomInfo comes back with
 *     status_code 4003110). So "connected" alone is NOT reliable evidence of LIVE.
 *   - `connection.fetchIsLive()` is the dedicated, reliable check (HTTP composite).
 *
 * Correct architecture:
 *   1. Poll `fetchIsLive()` on a fixed interval — this is the ONLY thing that
 *      sets isLive = true.
 *   2. While LIVE, hold a websocket connection for events (streamEnd / control
 *      message) so we detect the END of the stream quickly; any disconnect
 *      clears isLive immediately.
 *   3. All state is in-memory per-account and reset at startup — no stale LIVE
 *      can survive a restart.
 */

import { TikTokLiveConnection, WebcastEvent, ControlAction } from "tiktok-live-connector";
import { notifyLive, log } from "./notifier.js";

const RECONNECT_DELAY_MS = parseInt(process.env.RECONNECT_DELAY_MS || "30000", 10);
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || "60000", 10);

/** username -> { state, connection, pollTimer, connecting, wsConnected } */
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

/** Immediately mark offline and reset notification arming. */
function goOffline(username, reason) {
  const mon = monitors.get(username);
  if (!mon) return;
  const wasLive = mon.state.isLive;
  mon.state.isLive = false;
  mon.state.connected = false;
  mon.wsConnected = false;
  if (wasLive) {
    mon.state.lastOfflineAt = new Date().toISOString();
    log("info", `@${username} went OFFLINE (${reason})`);
  }
}

/** Tear down the websocket for an account (kept after stop, single owner). */
function dropConnection(username, mon) {
  if (mon.connection) {
    try { mon.connection.disconnect(); } catch { /* ignore */ }
    mon.connection = null;
  }
  mon.wsConnected = false;
}

/** Schedule one poll cycle (single timer per account). */
function schedulePoll(username, reason, delay = POLL_INTERVAL_MS) {
  const mon = monitors.get(username);
  if (!mon) return;
  if (mon.pollTimer) clearTimeout(mon.pollTimer);
  mon.pollTimer = setTimeout(() => {
    mon.pollTimer = null;
    pollAccount(username).catch((err) =>
      log("error", `Poll for @${username} crashed: ${err.message}`)
    );
  }, delay);
  if (reason) log("debug", `@${username} next poll in ${delay}ms (${reason})`);
}

/**
 * One poll cycle for one account:
 *  - fetchIsLive() is the source of truth.
 *  - false  -> goOffline (no matter what previous state was), schedule next poll.
 *  - true   -> if not currently tracking a live session, attach the websocket
 *              for end-of-stream detection and mark LIVE (notify once).
 */
async function pollAccount(username) {
  const mon = monitors.get(username);
  if (!mon) return;

  let live;
  try {
    if (!mon.probe) mon.probe = new TikTokLiveConnection(username, {});
    live = await mon.probe.fetchIsLive();
  } catch (err) {
    // Could not determine (network/sign errors). Fail SAFE: keep current
    // state only if we have a live websocket; otherwise treat as offline.
    log("warn", `@${username} fetchIsLive failed: ${err?.message ?? err}`);
    if (!mon.wsConnected) goOffline(username, "isLive check failed");
    schedulePoll(username, "check failed");
    return;
  }

  if (!live) {
    if (mon.state.isLive || mon.wsConnected) {
      dropConnection(username, mon);
      goOffline(username, "fetchIsLive=false");
    }
    schedulePoll(username, "offline");
    return;
  }

  // --- Account IS live ---
  if (mon.wsConnected) {
    // Already tracking this live session; nothing to do.
    schedulePoll(username, "still live");
    return;
  }

  // Fresh LIVE session: drop any leftover connection, mark live, notify once.
  dropConnection(username, mon);
  goOffline(username, "reset before live"); // clears stale flags w/o side effects
  mon.state.isLive = true;
  mon.state.connected = true;
  mon.state.lastLiveAt = new Date().toISOString();
  log("info", `@${username} is LIVE (confirmed by fetchIsLive)`);

  // Attach websocket to catch stream end quickly.
  try {
    const connection = new TikTokLiveConnection(username, {});
    mon.connection = connection;

    connection.on("connected", () => {
      mon.wsConnected = true;
      mon.state.connected = true;
      log("info", `@${username} live websocket attached`);
    });
    connection.on("disconnected", () => {
      if (mon.state.isLive) {
        goOffline(username, "websocket disconnected");
        schedulePoll(username, "ws lost", 5000); // re-check quickly
      }
    });
    connection.on("streamEnd", () => {
      dropConnection(username, mon);
      goOffline(username, "streamEnd event");
      schedulePoll(username, "stream ended");
    });
    connection.on(WebcastEvent.CONTROL_MESSAGE, (msg) => {
      if (msg?.action === ControlAction.CONTROL_ACTION_STREAM_ENDED) {
        dropConnection(username, mon);
        goOffline(username, "control: stream ended");
        schedulePoll(username, "control stream ended");
      }
    });
    connection.on("error", (err) => {
      log("warn", `@${username} ws error: ${err?.message ?? err}`);
    });

    await connection.connect();
    mon.wsConnected = true;
    mon.state.connected = true;
    log("info", `@${username} live websocket attached`);
  } catch (err) {
    // Websocket attach failed — the HTTP check already said LIVE, keep state
    // but rely on polling to notice the end.
    log("warn", `@${username} live ws attach failed (still marked LIVE via HTTP check): ${err?.message ?? err}`);
  }

  // OFFLINE -> LIVE transition: notify once per session.
  if (!mon.state.lastNotificationAt) {
    mon.state.lastNotificationAt = new Date().toISOString();
    notifyLive(username);
  }
  schedulePoll(username, "live, verifying", POLL_INTERVAL_MS);
}

/** Start monitoring one account (idempotent). */
export async function startMonitor(username) {
  if (monitors.has(username)) return; // already running
  monitors.set(username, {
    state: newState(username),
    probe: null,
    connection: null,
    pollTimer: null,
    wsConnected: false,
  });
  log("info", `Monitoring @${username} (poll every ${POLL_INTERVAL_MS}ms)`);
  // stagger initial polls slightly to spread load
  schedulePoll(username, "initial", Math.floor(Math.random() * 5000));
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
/** Dynamically add accounts (no-ops for ones already monitored). Returns the newly started list. */
export function addAccounts(usernameList) {
  const added = [];
  for (const username of usernameList) {
    if (!username || monitors.has(username)) continue;
    try {
      startMonitor(username).catch((err) =>
        log("error", `Monitor for @${username} crashed: ${err.message}`)
      );
      added.push(username);
    } catch (err) {
      log("error", `Monitor for @${username} failed to start: ${err.message}`);
    }
  }
  return added;
}

export function stopAll() {
  for (const [username, mon] of monitors) {
    if (mon.pollTimer) {
      clearTimeout(mon.pollTimer);
      mon.pollTimer = null;
    }
    dropConnection(username, mon);
    mon.state.isLive = false;
    mon.state.connected = false;
    log("info", `Stopped @${username}`);
  }
}

export function getStates() {
  return [...monitors.values()].map((m) => ({ ...m.state }));
}
