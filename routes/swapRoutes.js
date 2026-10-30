const express = require('express');
const router  = express.Router();
const protect = require('../middleware/auth');
const {
  createSwapRequest,
  getSwapRequests,
  acceptSwapRequest,
  rejectSwapRequest,
  cancelSwapRequest,
  completeSwapRequest,
  scheduleSwap,
} = require('../controllers/swapController');

router.post('/',                protect, createSwapRequest);
router.get('/',                 protect, getSwapRequests);

// Return STUN / TURN configuration (credentials kept secure on backend)
router.get('/ice-servers', protect, (req, res) => {
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ];

  if (process.env.TURN_URL) {
    iceServers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_CREDENTIAL || '',
    });
  }

  res.status(200).json({ iceServers });
});

router.put('/:id/accept',       protect, acceptSwapRequest);
router.put('/:id/reject',       protect, rejectSwapRequest);
router.put('/:id/cancel',       protect, cancelSwapRequest);
router.put('/:id/complete',     protect, completeSwapRequest);
router.put('/:id/schedule',     protect, scheduleSwap);

module.exports = router;
