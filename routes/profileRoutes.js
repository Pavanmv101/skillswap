const express = require('express');
const router  = express.Router();
const protect = require('../middleware/auth');
const { getProfile, getPublicProfile, updateProfile, blockUser } = require('../controllers/profileController');

router.get('/',          protect, getProfile);
router.get('/:id',       protect, getPublicProfile);
router.put('/',          protect, updateProfile);
router.post('/block/:id', protect, blockUser);

module.exports = router;
