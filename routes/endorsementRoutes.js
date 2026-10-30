const express = require('express');
const router = express.Router();
const protect = require('../middleware/auth');
const {
  createEndorsement,
  getUserEndorsements,
} = require('../controllers/endorsementController');

router.post('/',        protect, createEndorsement);
router.get('/:userId',  protect, getUserEndorsements);

module.exports = router;
