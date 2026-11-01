/**
 * Phase 6 — Advanced Skill Exchange (Step 3)
 * services/outboxDispatcher.js
 *
 * Implements the Transactional Outbox Dispatcher with:
 *  - Worker ownership fencing & lease-valid terminal updates
 *  - Two-phase claiming (expired lease recovery + pending events)
 *  - Strict atomic attempt accounting (attempts < MAX_ATTEMPTS)
 *  - Idempotent Notification persistence with E11000 verification
 *  - Pre-emission lease check & single-document normalization
 *  - Safe graceful shutdown draining tasks without releasing active leases
 */

'use strict';

const crypto = require('crypto');
const OutboxEvent = require('../models/OutboxEvent');
const Notification = require('../models/Notification');

const MAX_ATTEMPTS = 5;
const LEASE_DURATION_MS = 30000;
const POLL_INTERVAL_MS = 2000;
const SHUTDOWN_TIMEOUT_MS = 5000;

let pollTimer = null;
let isStopping = false;
let globalIo = null;
const activeTasks = new Map(); // Map<string, { eventId: string, isRunning: boolean }>

/**
 * Creates a unique worker identifier scoped to process and host.
 */
function createWorkerId() {
  return `worker-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
}

const defaultWorkerId = createWorkerId();

/**
 * Validates whether an E11000 error specifically originates from the
 * unique index on `outboxEvent`.
 */
function isOutboxEventDuplicateKeyError(err) {
  if (!err || err.code !== 11000) return false;

  if (err.keyPattern && err.keyPattern.outboxEvent) {
    return true;
  }
  if (err.keyValue && Object.prototype.hasOwnProperty.call(err.keyValue, 'outboxEvent')) {
    return true;
  }
  if (typeof err.message === 'string') {
    return (
      err.message.includes('unique_notification_per_outbox_event') ||
      err.message.includes('outboxEvent_1') ||
      err.message.includes('dup key: { outboxEvent:')
    );
  }

  return false;
}

/**
 * Determines whether an error is permanent (non-retryable).
 */
function isPermanentError(err, event) {
  if (!event || !event.recipient) return true;
  if (!err) return false;
  if (err.name === 'ValidationError' || err.name === 'CastError') return true;
  return false;
}

/**
 * Calculates exponential backoff with jitter for transient retries.
 */
function calculateBackoffMs(attempts) {
  const base = Math.min(Math.pow(2, attempts) * 1000, 60000);
  const jitter = Math.floor(Math.random() * 500);
  return base + jitter;
}

/**
 * Sweeps expired processing leases that have reached MAX_ATTEMPTS
 * and transitions them atomically to terminal 'failed'.
 */
async function sweepExhaustedExpiredLeases() {
  const now = new Date();
  await OutboxEvent.updateMany(
    {
      status: 'processing',
      leaseExpiresAt: { $lt: now },
      attempts: { $gte: MAX_ATTEMPTS },
    },
    {
      $set: {
        status: 'failed',
        error: 'Max attempts exhausted during processing lease expiration',
        lockedBy: null,
        leaseExpiresAt: null,
      },
    }
  );
}

/**
 * Claims the next eligible outbox event using two-phase atomic claiming.
 */
async function claimNextEvent(workerId) {
  const now = new Date();

  // Phase A: Expired Lease Recovery (strictly attempts < MAX_ATTEMPTS)
  const recoveredEvent = await OutboxEvent.findOneAndUpdate(
    {
      status: 'processing',
      leaseExpiresAt: { $lt: now },
      attempts: { $lt: MAX_ATTEMPTS },
    },
    {
      $set: {
        status: 'processing',
        lockedAt: now,
        lockedBy: workerId,
        leaseExpiresAt: new Date(now.getTime() + LEASE_DURATION_MS),
      },
      $inc: { attempts: 1 },
    },
    { sort: { leaseExpiresAt: 1, _id: 1 }, returnDocument: 'after' }
  );

  if (recoveredEvent) {
    return recoveredEvent;
  }

  // Phase B: Ready Pending Events (strictly attempts < MAX_ATTEMPTS)
  const pendingEvent = await OutboxEvent.findOneAndUpdate(
    {
      status: 'pending',
      attempts: { $lt: MAX_ATTEMPTS },
      $or: [{ nextRetryAt: null }, { nextRetryAt: { $lte: now } }],
    },
    {
      $set: {
        status: 'processing',
        lockedAt: now,
        lockedBy: workerId,
        leaseExpiresAt: new Date(now.getTime() + LEASE_DURATION_MS),
      },
      $inc: { attempts: 1 },
    },
    { sort: { createdAt: 1, _id: 1 }, returnDocument: 'after' }
  );

  return pendingEvent;
}

/**
 * Processes a single outbox event with worker fencing and idempotency.
 */
async function processEvent(event, workerId, ioInstance) {
  const eventIdStr = event._id.toString();
  const taskRecord = { eventId: eventIdStr, isRunning: true };
  activeTasks.set(eventIdStr, taskRecord);

  try {
    // 1. Validate recipient presence
    if (!event.recipient) {
      throw new Error('OutboxEvent is missing required recipient');
    }

    // 2. Persist single Notification document idempotently
    let notification;
    try {
      const notifDoc = new Notification({
        recipient: event.recipient,
        sender: event.sender || event.payload?.sender || null,
        type: event.type,
        title: event.title || event.payload?.title || 'SkillSwap Notification',
        message: event.message || event.payload?.message || '',
        relatedSwap: event.relatedSwap || event.payload?.relatedSwap || null,
        outboxEvent: event._id,
        metadata: event.payload?.metadata || {},
      });
      notification = await notifDoc.save();
    } catch (err) {
      if (isOutboxEventDuplicateKeyError(err)) {
        // Idempotency recovery: load existing notification
        notification = await Notification.findOne({ outboxEvent: event._id });
      } else {
        throw err;
      }
    }

    if (!notification) {
      throw new Error(`Failed to resolve notification document for outbox event ${event._id}`);
    }

    // Normalize document: ensure single document object (never an array)
    if (Array.isArray(notification)) {
      notification = notification[0];
    }

    // Populate relational fields for frontend consumption
    await notification.populate([
      { path: 'sender', select: 'name email' },
      { path: 'relatedSwap', select: 'offeredSkill wantedSkill status roomId scheduledAt' },
    ]);

    const socketPayload = notification.toObject ? notification.toObject() : notification;

    // 3. Pre-emission lease validation: recheck worker ownership and unexpired lease
    const activeLease = await OutboxEvent.findOne({
      _id: event._id,
      status: 'processing',
      lockedBy: workerId,
      leaseExpiresAt: { $gt: new Date() },
    });

    if (!activeLease) {
      // Lease lost or expired before emission; halt immediately without side effects
      return { success: false, reason: 'lease_lost_before_socket_emission' };
    }

    // 4. Socket.io delivery (at-least-once external emission)
    if (ioInstance) {
      ioInstance.to(`user:${event.recipient.toString()}`).emit('notification:new', socketPayload);
    }

    // 5. Terminal fenced update to 'dispatched'
    const res = await OutboxEvent.updateOne(
      {
        _id: event._id,
        status: 'processing',
        lockedBy: workerId,
        leaseExpiresAt: { $gt: new Date() },
      },
      {
        $set: {
          status: 'dispatched',
          dispatchedAt: new Date(),
          lockedBy: null,
          leaseExpiresAt: null,
          error: null,
        },
      }
    );

    if (res.matchedCount === 0) {
      return { success: false, reason: 'fencing_lost_on_dispatch_commit' };
    }

    return { success: true, notificationId: notification._id };
  } catch (err) {
    const permanent = isPermanentError(err, event);

    if (permanent || event.attempts >= MAX_ATTEMPTS) {
      // Terminal failure
      await OutboxEvent.updateOne(
        {
          _id: event._id,
          status: 'processing',
          lockedBy: workerId,
          leaseExpiresAt: { $gt: new Date() },
        },
        {
          $set: {
            status: 'failed',
            error: err.message || 'Permanent error or max retries exhausted',
            lockedBy: null,
            leaseExpiresAt: null,
          },
        }
      );
      return { success: false, status: 'failed', error: err.message };
    } else {
      // Transient error: schedule retry with backoff without incrementing attempts again
      const backoffMs = calculateBackoffMs(event.attempts);
      await OutboxEvent.updateOne(
        {
          _id: event._id,
          status: 'processing',
          lockedBy: workerId,
          leaseExpiresAt: { $gt: new Date() },
        },
        {
          $set: {
            status: 'pending',
            error: err.message || 'Transient failure',
            nextRetryAt: new Date(Date.now() + backoffMs),
            lockedBy: null,
            leaseExpiresAt: null,
          },
        }
      );
      return { success: false, status: 'pending', nextRetryMs: backoffMs };
    }
  } finally {
    taskRecord.isRunning = false;
    activeTasks.delete(eventIdStr);
  }
}

/**
 * Claims and processes the next eligible event.
 * Exported for test harnesses and manual single-step execution.
 */
async function processNextOutboxEvent(workerId = defaultWorkerId, ioInstance = globalIo) {
  if (isStopping) return null;

  try {
    await sweepExhaustedExpiredLeases();
    const event = await claimNextEvent(workerId);
    if (!event) return null;

    return await processEvent(event, workerId, ioInstance);
  } catch (err) {
    console.error('[OutboxDispatcher] Unhandled error during event processing:', err);
    return null;
  }
}

/**
 * Initializes the background dispatcher polling loop.
 */
function initOutboxDispatcher(ioInstance) {
  if (pollTimer) return;
  globalIo = ioInstance;
  isStopping = false;

  console.log(`[OutboxDispatcher] Initializing outbox worker (PID: ${process.pid})`);

  pollTimer = setInterval(async () => {
    if (isStopping) return;
    try {
      let processed = null;
      do {
        processed = await processNextOutboxEvent(defaultWorkerId, globalIo);
      } while (processed && !isStopping);
    } catch (err) {
      console.warn('[OutboxDispatcher] Polling cycle error:', err.message);
    }
  }, POLL_INTERVAL_MS);

  if (pollTimer.unref) {
    pollTimer.unref();
  }
}

/**
 * Gracefully shuts down the outbox dispatcher.
 * Drains active tasks without releasing leases belonging to still-running tasks.
 */
async function stopOutboxDispatcher() {
  if (!pollTimer && !isStopping) return;
  isStopping = true;

  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  console.log('[OutboxDispatcher] Graceful shutdown initiated. Waiting for active tasks...');

  const startTime = Date.now();
  while (activeTasks.size > 0 && Date.now() - startTime < SHUTDOWN_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, 100));
  }

  // If timeout expired while tasks are still running: DO NOT release their leases!
  // Let them expire naturally in MongoDB so another worker won't collide.
  if (activeTasks.size > 0) {
    console.warn(
      `[OutboxDispatcher] Shutdown timeout expired with ${activeTasks.size} task(s) still in-flight. Leases retained for natural expiration.`
    );
  } else {
    console.log('[OutboxDispatcher] Clean shutdown complete.');
  }
}

module.exports = {
  initOutboxDispatcher,
  stopOutboxDispatcher,
  processNextOutboxEvent,
  processEvent,
  isOutboxEventDuplicateKeyError,
  createWorkerId,
  MAX_ATTEMPTS,
  LEASE_DURATION_MS,
};
