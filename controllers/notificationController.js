const mongoose = require('mongoose');
const Notification = require('../models/Notification');

const MAX_RECONCILE_IDS = 100;

function parseReconcileIds(queryReconcileIds) {
  let raw = [];
  if (queryReconcileIds) {
    if (Array.isArray(queryReconcileIds)) {
      raw = queryReconcileIds;
    } else if (typeof queryReconcileIds === 'string') {
      raw = queryReconcileIds.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  if (raw.length > MAX_RECONCILE_IDS) {
    raw = raw.slice(0, MAX_RECONCILE_IDS);
  }
  return raw
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
}

// GET /api/notifications
// Supports query params: ?page=1&limit=20&unreadOnly=false&reconcileIds=id1,id2
exports.getNotifications = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const recipientObjectId = new mongoose.Types.ObjectId(req.userId);
    const baseMatch = { recipient: recipientObjectId };
    if (req.query.unreadOnly === 'true') {
      baseMatch.isRead = false;
    }

    const validReconcileObjectIds = parseReconcileIds(req.query.reconcileIds);
    const snapshotTimestamp = new Date().toISOString();

    const [result] = await Notification.aggregate([
      { $match: baseMatch },
      { $sort: { createdAt: -1, _id: -1 } },
      {
        $facet: {
          notifications: [
            { $skip: skip },
            { $limit: limit },
            {
              $lookup: {
                from: 'users',
                localField: 'sender',
                foreignField: '_id',
                pipeline: [{ $project: { name: 1, email: 1 } }],
                as: 'sender',
              },
            },
            {
              $unwind: {
                path: '$sender',
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $lookup: {
                from: 'swaprequests',
                localField: 'relatedSwap',
                foreignField: '_id',
                pipeline: [
                  {
                    $project: {
                      offeredSkill: 1,
                      wantedSkill: 1,
                      status: 1,
                      roomId: 1,
                      scheduledAt: 1,
                    },
                  },
                ],
                as: 'relatedSwap',
              },
            },
            {
              $unwind: {
                path: '$relatedSwap',
                preserveNullAndEmptyArrays: true,
              },
            },
          ],
          total: [{ $count: 'count' }],
          unreadSummary: [
            { $match: { isRead: false } },
            { $count: 'count' },
          ],
          reconciledNotificationIds: [
            {
              $match: {
                _id: { $in: validReconcileObjectIds },
              },
            },
            { $project: { _id: 1 } },
          ],
          reconciledUnread: [
            {
              $match: {
                _id: { $in: validReconcileObjectIds },
                isRead: false,
              },
            },
            { $project: { _id: 1 } },
          ],
        },
      },
    ]);

    const notifications = result?.notifications || [];
    const total = result?.total?.[0]?.count || 0;
    const unreadCount = result?.unreadSummary?.[0]?.count || 0;
    const reconciledNotificationIds = (result?.reconciledNotificationIds || []).map((d) =>
      d._id.toString()
    );
    const reconciledUnreadIds = (result?.reconciledUnread || []).map((d) =>
      d._id.toString()
    );

    res.status(200).json({
      notifications,
      unreadCount,
      reconciledNotificationIds,
      reconciledUnreadIds,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 1,
      snapshotAt: snapshotTimestamp,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// GET /api/notifications/unread-count
// Supports query params: ?reconcileIds=id1,id2
exports.getUnreadCount = async (req, res) => {
  try {
    const recipientObjectId = new mongoose.Types.ObjectId(req.userId);
    const validReconcileObjectIds = parseReconcileIds(req.query.reconcileIds);

    const [result] = await Notification.aggregate([
      {
        $match: {
          recipient: recipientObjectId,
        },
      },
      {
        $facet: {
          unreadCount: [
            { $match: { isRead: false } },
            { $count: 'count' },
          ],
          reconciledNotificationIds: [
            {
              $match: {
                _id: { $in: validReconcileObjectIds },
              },
            },
            { $project: { _id: 1 } },
          ],
          reconciledUnread: [
            {
              $match: {
                _id: { $in: validReconcileObjectIds },
                isRead: false,
              },
            },
            { $project: { _id: 1 } },
          ],
        },
      },
    ]);

    const unreadCount = result?.unreadCount?.[0]?.count || 0;
    const reconciledNotificationIds = (result?.reconciledNotificationIds || []).map((d) =>
      d._id.toString()
    );
    const reconciledUnreadIds = (result?.reconciledUnread || []).map((d) =>
      d._id.toString()
    );

    res.status(200).json({ unreadCount, reconciledNotificationIds, reconciledUnreadIds });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PUT /api/notifications/:id/read
exports.markAsRead = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid notification ID' });
    }

    const notification = await Notification.findById(req.params.id);
    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    // Verify ownership
    if (notification.recipient.toString() !== req.userId.toString()) {
      return res.status(403).json({ message: 'Not authorized to update this notification' });
    }

    notification.isRead = true;
    await notification.save();

    res.status(200).json({ success: true, notification });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// PUT /api/notifications/read-all
exports.markAllAsRead = async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { recipient: req.userId, isRead: false },
      { isRead: true }
    );

    res.status(200).json({
      success: true,
      modifiedCount: result.modifiedCount || 0,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// DELETE /api/notifications/:id
exports.deleteNotification = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid notification ID' });
    }

    const notification = await Notification.findById(req.params.id);
    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    // Verify ownership
    if (notification.recipient.toString() !== req.userId.toString()) {
      return res.status(403).json({ message: 'Not authorized to delete this notification' });
    }

    await Notification.deleteOne({ _id: req.params.id });

    res.status(200).json({ success: true, message: 'Notification deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// DELETE /api/notifications
// Clear all notifications belonging to the authenticated user
exports.clearAllNotifications = async (req, res) => {
  try {
    const result = await Notification.deleteMany({ recipient: req.userId });

    res.status(200).json({
      success: true,
      deletedCount: result.deletedCount || 0,
    });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};
