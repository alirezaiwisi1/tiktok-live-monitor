# TikTok LIVE Monitor

A lightweight Node.js backend that watches multiple TikTok accounts, detects
when each goes LIVE (using [tiktok-live-connector](https://www.npmjs.com/package/tiktok-live-connector)),
exposes a JSON status API for your website, and optionally sends Telegram
notifications. No frontend, no database.

## Features

- Multiple-account monitoring — every account is monitored independently
- LIVE and OFFLINE detection (connect, disconnect, stream-end events)
- JSON API: `GET /api/status` and `GET /health`
- Optional Telegram notifications on LIVE
- Duplicate notification prevention (one notification per LIVE session)
- Automatic reconnect with configurable delay
- One failing account never stops the others
- Graceful shutdown (SIGINT / SIGTERM)

## Requirements

- Node.js ≥ 20
- npm
- (optional) A Telegram bot token + chat ID

## Installation

```bash
git clone https://github.com/alirezaiwisi1/tiktok-live-monitor.git
cd tiktok-live-monitor
npm install
npm start
```

## Configuration

```bash
cp .env.example .env   # then edit .env — never commit it
```

| Variable | Default | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — | Token from @BotFather (optional; without it monitoring still runs) |
| `TELEGRAM_CHAT_ID` | — | Chat/user ID that receives notifications |
| `RECONNECT_DELAY_MS` | `30000` | Delay between reconnect attempts |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `PORT` | `3000` | API port |

## TikTok accounts

Accounts are centralized in **`src/accounts.js`**:

```js
export const accounts = [
  "aropl.afganistan",
  "nasarhashem",
  // add or remove usernames here (without @)
];
```

No other file needs to change.

## API

### `GET /api/status`

```json
{
  "live":     [{ "username": "nasarhashem", "isLive": true, "lastLiveAt": "...", "lastNotificationAt": "..." }],
  "offline":  [{ "username": "aroplfarsi", "isLive": false, "lastOfflineAt": "..." }],
  "checkedAt": "2026-01-01T00:00:00.000Z"
}
```

Website usage example:

```js
fetch("http://your-server:3000/api/status")
  .then(r => r.json())
  .then(d => {
    d.live.forEach(u => {
      // e.g. embed: https://www.tiktok.com/embed/live/<username>
    });
  });
```

### `GET /health`

```json
{ "ok": true, "uptime": 19.5, "accounts": 7 }
```

## Telegram setup

1. Message **@BotFather** in Telegram → `/newbot` → follow prompts → copy the **bot token**.
2. Send any message to your new bot.
3. Visit `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `"chat":{"id":...}`.
4. Put both values in `.env`.

If Telegram credentials are missing the service logs a warning and keeps
monitoring; notification failures never stop monitoring.

## Troubleshooting

- **Connection failures / rate limits** — the service retries automatically
  after `RECONNECT_DELAY_MS`; increase it if TikTok rejects frequent retries.
- **Account unavailable** — invalid usernames are logged as `[WARN]`; other
  accounts are unaffected.
- **Telegram notification failure** — verify token/chat ID and that you have
  messaged the bot at least once.
- **Missing env vars** — startup warning; monitoring continues.

## License

MIT — see [LICENSE](LICENSE).
