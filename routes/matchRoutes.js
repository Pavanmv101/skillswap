const express = require('express');
const router  = express.Router();
const protect = require('../middleware/auth');
const { getMatches, searchUsers } = require('../controllers/matchController');

router.get('/',       protect, getMatches);
router.get('/search', protect, searchUsers);

module.exports = router;
