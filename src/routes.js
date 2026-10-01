const express = require("express");
const { checkAll } = require("./tiktok-monitor");
const accounts = require("./accounts");

const router = express.Router();

// GET /api/lives — وضعیت همه حساب‌ها
router.get("/lives", async (req, res) => {
  try {
    const results = await checkAll(accounts);
    res.json({
      live: results.filter(r => r.live),
      offline: results.filter(r => !r.live),
      checkedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/lives/:username — وضعیت یک حساب
router.get("/lives/:username", async (req, res) => {
  const { isLive } = require("./tiktok-monitor");
  const r = await isLive(req.params.username);
  res.json(r);
});

module.exports = router;
