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
router.put('/:id/accept',       protect, acceptSwapRequest);
router.put('/:id/reject',       protect, rejectSwapRequest);
router.put('/:id/cancel',       protect, cancelSwapRequest);
router.put('/:id/complete',     protect, completeSwapRequest);
router.put('/:id/schedule',     protect, scheduleSwap);

module.exports = router;
