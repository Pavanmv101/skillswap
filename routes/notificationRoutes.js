const express = require('express');
const router = express.Router();
const protect = require('../middleware/auth');
const {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  clearAllNotifications,
} = require('../controllers/notificationController');

router.get('/',              protect, getNotifications);
router.get('/unread-count',  protect, getUnreadCount);
router.put('/read-all',      protect, markAllAsRead);
router.put('/:id/read',      protect, markAsRead);
router.delete('/:id',        protect, deleteNotification);
router.delete('/',           protect, clearAllNotifications);

module.exports = router;
