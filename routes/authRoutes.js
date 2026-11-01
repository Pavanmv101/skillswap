const express = require('express');
const router = express.Router();
const { rateLimit } = require('express-rate-limit');
const { register, login, seedDemoAccounts } = require('../controllers/authController');

// 15-minute window, max 50 requests per IP on sensitive authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  statusCode: 429,
  message: {
    message: 'Too many authentication attempts, please try again after 15 minutes',
  },
});

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/seed-demo', authLimiter, seedDemoAccounts);

module.exports = router;
