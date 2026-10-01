const fetch = require("node-fetch");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * بررسی LIVE بودن یک حساب TikTok.
 * روش: صفحه پروفایل را می‌گیریم و دنبال نشانه‌های live می‌گردیم
 * ("Live now" / "isLive" / embed room id).
 */
async function isLive(username) {
  const url = `https://www.tiktok.com/@${username}/live`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
      timeout: 15000,
    });
    if (!res.ok) return { username, live: false, error: `HTTP ${res.status}` };
    const html = await res.text();
    const live =
      html.includes('"isLive":true') ||
      html.includes("Live now") ||
      /room_id=\d+/.test(html);
    let roomId = null;
    const m = html.match(/room_id=(\d+)/);
    if (m) roomId = m[1];
    return { username, live, roomId };
  } catch (e) {
    return { username, live: false, error: e.message };
  }
}

/** بررسی همه حساب‌ها به صورت موازی */
async function checkAll(accounts) {
  const results = await Promise.all(accounts.map(isLive));
  return results;
}

module.exports = { isLive, checkAll };
