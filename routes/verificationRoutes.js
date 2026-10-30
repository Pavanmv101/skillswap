const express = require('express');
const router = express.Router();
const protect = require('../middleware/auth');
const {
  submitVerification,
  getMyVerifications,
  getVerificationById,
  downloadCertificateFile,
} = require('../controllers/verificationController');

router.post('/',        protect, submitVerification);
router.get('/my',       protect, getMyVerifications);
router.get('/:id',      protect, getVerificationById);
router.get('/:id/file', protect, downloadCertificateFile);

module.exports = router;
