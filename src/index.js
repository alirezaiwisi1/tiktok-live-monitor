require("dotenv").config();
const express = require("express");
const routes = require("./routes");
const accounts = require("./accounts");
const { checkAll } = require("./tiktok-monitor");

const app = express();
const PORT = process.env.PORT || 3000;
const INTERVAL = (process.env.CHECK_INTERVAL_SECONDS || 60) * 1000;

// اگر در .env لیست داده شده، جایگزین accounts.js می‌شود
const envAccounts = (process.env.TIKTOK_ACCOUNTS || "").split(",").map(s => s.trim()).filter(Boolean);
if (envAccounts.length) {
  accounts.length = 0;
  accounts.push(...envAccounts);
}

app.use(express.static("public"));
app.use("/api", routes);

app.listen(PORT, () => {
  console.log(`✅ tiktok-live-monitor running on http://localhost:${PORT}`);
  console.log(`👀 monitoring ${accounts.length} accounts: ${accounts.join(", ")}`);
});

// کش وضعیت هر INTERVAL ثانیه (برای کاهش درخواست‌های تکراری)
let cache = null;
async function refresh() {
  try {
    cache = await checkAll(accounts);
    console.log(`[${new Date().toLocaleTimeString()}] live: ${cache.filter(r => r.live).map(r => r.username).join(", ") || "—"}`);
  } catch (e) {
    console.error("refresh error:", e.message);
  }
}
refresh();
setInterval(refresh, INTERVAL);
