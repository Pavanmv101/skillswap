const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { checkUpcomingSessionReminders } = require('../services/reminderService');

// Timing-safe comparison to prevent timing attack enumeration
function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// POST /api/cron/reminders
// Protected external webhook endpoint for Render Cron Jobs, UptimeRobot, or cron-job.org
router.post('/reminders', async (req, res) => {
  const secretHeader =
    req.headers['x-cron-secret'] ||
    (req.headers.authorization && req.headers.authorization.replace('Bearer ', ''));

  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret || !secretHeader || !timingSafeEqualStr(secretHeader, expectedSecret)) {
    return res.status(401).json({ message: 'Unauthorized cron invocation' });
  }

  try {
    const result = await checkUpcomingSessionReminders();
    res.status(200).json({
      status: 'ok',
      message: 'Session reminders checked and processed idempotently',
      result,
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
