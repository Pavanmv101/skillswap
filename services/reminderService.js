const SwapRequest = require('../models/SwapRequest');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { createAndEmitNotification } = require('./notificationService');

const REMINDER_WINDOW_MINUTES = 30; // Configurable window (30 minutes prior to session)
const CHECK_INTERVAL_MS = 60 * 1000; // Check every 60 seconds

let intervalId = null;
let isProcessing = false;

/**
 * Checks for upcoming accepted sessions within the reminder window
 * and creates non-duplicate notifications for both participants.
 * Includes concurrency lock and recovery for missed execution windows.
 */
async function checkUpcomingSessionReminders() {
  if (isProcessing) {
    console.log('[Reminder Service] Skip: Prior reminder check cycle is still actively processing');
    return { skipped: true, reason: 'concurrency_lock' };
  }

  isProcessing = true;
  let sentCount = 0;

  try {
    const now = new Date();
    // Catch-up window: includes sessions up to 15 mins past (e.g. after server cold-start wake-up)
    const catchUpPastThreshold = new Date(now.getTime() - 15 * 60 * 1000);
    const reminderThreshold = new Date(now.getTime() + REMINDER_WINDOW_MINUTES * 60 * 1000);

    // Strictly find accepted swaps only (never completed or cancelled)
    const upcomingSwaps = await SwapRequest.find({
      status: 'accepted',
      scheduledAt: {
        $gte: catchUpPastThreshold,
        $lte: reminderThreshold,
      },
    })
      .populate('fromUser', 'name email')
      .populate('toUser', 'name email');

    for (const swap of upcomingSwaps) {
      if (!swap.fromUser || !swap.toUser || !swap.scheduledAt) continue;

      const timeFormatted = new Date(swap.scheduledAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });

      // 1. Check & send reminder for fromUser
      const fromReminderExists = await Notification.findOne({
        relatedSwap: swap._id,
        recipient: swap.fromUser._id,
        type: 'SESSION_REMINDER',
      });

      if (!fromReminderExists) {
        try {
          await createAndEmitNotification({
            recipient: swap.fromUser._id,
            sender: swap.toUser._id,
            type: 'SESSION_REMINDER',
            title: 'Upcoming Session Reminder ⏰',
            message: `Your video call with ${swap.toUser.name} (${swap.offeredSkill} ⇄ ${swap.wantedSkill}) starts soon at ${timeFormatted}.`,
            relatedSwap: swap._id,
          });
          sentCount++;
          console.log(`[Reminder Service] Sent reminder to ${swap.fromUser.name} for swap ${swap._id}`);
        } catch (err) {
          if (err.code === 11000 || (err.name === 'MongoServerError' && err.code === 11000)) {
            console.log(`[Reminder Service] Duplicate reminder caught by database constraint for swap ${swap._id} (recipient: ${swap.fromUser._id})`);
          } else {
            console.error(`[Reminder Service] Error creating reminder for swap ${swap._id}:`, err);
          }
        }
      }

      // 2. Check & send reminder for toUser
      const toReminderExists = await Notification.findOne({
        relatedSwap: swap._id,
        recipient: swap.toUser._id,
        type: 'SESSION_REMINDER',
      });

      if (!toReminderExists) {
        try {
          await createAndEmitNotification({
            recipient: swap.toUser._id,
            sender: swap.fromUser._id,
            type: 'SESSION_REMINDER',
            title: 'Upcoming Session Reminder ⏰',
            message: `Your video call with ${swap.fromUser.name} (${swap.wantedSkill} ⇄ ${swap.offeredSkill}) starts soon at ${timeFormatted}.`,
            relatedSwap: swap._id,
          });
          sentCount++;
          console.log(`[Reminder Service] Sent reminder to ${swap.toUser.name} for swap ${swap._id}`);
        } catch (err) {
          if (err.code === 11000 || (err.name === 'MongoServerError' && err.code === 11000)) {
            console.log(`[Reminder Service] Duplicate reminder caught by database constraint for swap ${swap._id} (recipient: ${swap.toUser._id})`);
          } else {
            console.error(`[Reminder Service] Error creating reminder for swap ${swap._id}:`, err);
          }
        }
      }
    }

    return { processed: upcomingSwaps.length, sentCount, timestamp: now };
  } catch (err) {
    console.error('[Reminder Service] Error checking session reminders:', err);
    return { error: err.message };
  } finally {
    isProcessing = false;
  }
}

/**
 * Initializes the reminder cron/timer scheduler.
 * Runs check immediately upon server boot, then every CHECK_INTERVAL_MS.
 */
function initReminderScheduler() {
  if (intervalId) clearInterval(intervalId);

  console.log(`[Reminder Service] Scheduler initialized (Window: ${REMINDER_WINDOW_MINUTES} mins, Interval: ${CHECK_INTERVAL_MS / 1000}s)`);

  // Run immediate check upon boot
  checkUpcomingSessionReminders();

  // Schedule recurring checks
  intervalId = setInterval(checkUpcomingSessionReminders, CHECK_INTERVAL_MS);
}

function stopReminderScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[Reminder Service] Reminder scheduler interval stopped');
  }
}

module.exports = {
  initReminderScheduler,
  stopReminderScheduler,
  checkUpcomingSessionReminders,
  REMINDER_WINDOW_MINUTES,
};
