const Notification = require('../models/Notification');
const User = require('../models/User');
const SwapRequest = require('../models/SwapRequest');

let ioInstance = null;

function setIO(io) {
  ioInstance = io;
}

function getIO() {
  return ioInstance;
}

/**
 * Creates a notification in MongoDB and broadcasts it in real-time
 * to the recipient's private Socket.io room (`user:${recipient}`)
 */
async function createAndEmitNotification({ recipient, sender, type, title, message, relatedSwap }) {
  try {
    if (!recipient) {
      console.warn('Cannot create notification: Missing recipient');
      return null;
    }

    const notification = new Notification({
      recipient,
      sender: sender || null,
      type,
      title,
      message,
      relatedSwap: relatedSwap || null,
      isRead: false,
    });

    await notification.save();

    // Populate sender and swap details for rich frontend rendering
    await notification.populate('sender', 'name email');
    if (relatedSwap) {
      await notification.populate('relatedSwap', 'offeredSkill wantedSkill status roomId scheduledAt');
    }

    // Broadcast in real-time if Socket.io is active
    if (ioInstance) {
      const roomName = `user:${recipient.toString()}`;
      ioInstance.to(roomName).emit('notification:new', notification);
      console.log(`[Socket.io] Real-time notification emitted to room "${roomName}": ${type} - ${title}`);
    }

    return notification;
  } catch (err) {
    console.error('Error creating/emitting notification:', err);
    return null;
  }
}

module.exports = {
  setIO,
  getIO,
  createAndEmitNotification,
};
