# TikTok LIVE Monitor

Node.js monitor for the seven configured public TikTok accounts. It exposes `/api/live` for the AROPL website.

## Accounts
- @aropl.afganistan
- @nasarhashem
- @keyvan.alalmahdi
- @user2277795158168
- @mehr.ecp
- @maryamalalmahdi
- @aroplfarsi

## Run
Requires Node.js 20+.

```bash
npm install
npm start
```

Then open `http://localhost:3000/test.html`.

API: `http://localhost:3000/api/live`
Health: `http://localhost:3000/health`

You can override the list with `TIKTOK_ACCOUNTS=aroplfarsi,nasarhashem`.

This uses the unofficial `tiktok-live-connector` package. It does not require TikTok login, app registration, or a TikTok API key to read public LIVE status, but the connector uses signed WebSocket infrastructure and is reverse-engineered; TikTok protocol changes can break it.

For production, run this Node service on a Node-capable host. Your existing Cloudflare site can call `/api/live` over HTTPS. Do not change the existing site UI until this monitor is independently verified.
