const express = require('express');
const router = express.Router();
const { register, login, seedDemoAccounts } = require('../controllers/authController');

router.post('/register', register);
router.post('/login', login);
router.post('/seed-demo', seedDemoAccounts);

module.exports = router;
