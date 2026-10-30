const express = require('express');
const router = express.Router();
const protect = require('../middleware/auth');
const adminOnly = require('../middleware/admin');
const {
  listVerifications,
  getVerificationDetails,
  approveVerification,
  rejectVerification,
} = require('../controllers/adminVerificationController');

// All admin routes strictly require both authenticated token AND admin role
router.get('/verifications',             protect, adminOnly, listVerifications);
router.get('/verifications/:id',         protect, adminOnly, getVerificationDetails);
router.put('/verifications/:id/approve', protect, adminOnly, approveVerification);
router.post('/verifications/:id/approve', protect, adminOnly, approveVerification);
router.put('/verifications/:id/reject',  protect, adminOnly, rejectVerification);
router.post('/verifications/:id/reject',  protect, adminOnly, rejectVerification);

module.exports = router;
