require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const connectDB = require('./config/db');

// Import routes
const authRoutes = require('./routes/authRoutes');
const profileRoutes = require('./routes/profileRoutes');
const matchRoutes = require('./routes/matchRoutes');
const swapRoutes = require('./routes/swapRoutes');
const ratingRoutes = require('./routes/ratingRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const verificationRoutes = require('./routes/verificationRoutes');
const adminRoutes = require('./routes/adminRoutes');
const endorsementRoutes = require('./routes/endorsementRoutes');
const learningRoutes = require('./routes/learningRoutes');
const cronRoutes = require('./routes/cronRoutes');

// Import notification and reminder services
const { setIO } = require('./services/notificationService');
const { initReminderScheduler, stopReminderScheduler } = require('./services/reminderService');

const app = express();
const server = http.createServer(app);

// ── Production-Grade Trusted CORS Configuration ───────────────────────────
const localDevOrigins = new Set([
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:5173',
]);

const configuredClientUrls = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',').map(u => u.trim().replace(/\/$/, '')).filter(Boolean)
  : [];

// Extract canonical SkillSwap project slugs from configured URLs or default to 'skillswap'
const allowedVercelSlugs = new Set(['skillswap']);
for (const rawUrl of configuredClientUrls) {
  try {
    const u = new URL(rawUrl);
    if (u.hostname.endsWith('.vercel.app')) {
      const parts = u.hostname.split('.');
      if (parts.length === 3) {
        allowedVercelSlugs.add(parts[0].toLowerCase());
      }
    }
  } catch (e) {
    // ignore malformed configured URL entry
  }
}

function isAllowedOrigin(origin) {
  // Allow requests with no origin (curl, server-to-server, native mobile)
  if (!origin) return true;

  // Local development / non-production environment: permit localhost and dev ports
  if (process.env.NODE_ENV !== 'production') {
    if (localDevOrigins.has(origin)) return true;
    if (configuredClientUrls.length === 0) return true;
  }

  // Parse origin strictly using URL API
  let parsedUrl;
  try {
    parsedUrl = new URL(origin);
  } catch (err) {
    return false; // Malformed or invalid origin URL
  }

  // Require https in production
  if (process.env.NODE_ENV === 'production' && parsedUrl.protocol !== 'https:') {
    return false;
  }

  // Check exact match against configured client URLs (e.g. custom domain https://skillswap.com)
  const normalizedOrigin = parsedUrl.origin;
  if (configuredClientUrls.includes(normalizedOrigin)) {
    return true;
  }

  // Validate Vercel preview deployments strictly
  const hostname = parsedUrl.hostname.toLowerCase();
  
  // Must end with exactly .vercel.app and have exactly 3 parts: <subdomain>.vercel.app
  const hostParts = hostname.split('.');
  if (hostParts.length === 3 && hostParts[1] === 'vercel' && hostParts[2] === 'app') {
    const subdomain = hostParts[0];

    // Must be valid alphanumeric with hyphens (RFC 1123 DNS label)
    if (!/^[a-z0-9-]+$/.test(subdomain)) {
      return false;
    }

    // Do not permit non-standard ports on Vercel preview URLs
    if (parsedUrl.port && parsedUrl.port !== '443') {
      return false;
    }

    // Check if subdomain matches any approved SkillSwap project slug:
    // e.g. 'skillswap' or preview formats like 'skillswap-git-*' or 'skillswap-*'
    for (const slug of allowedVercelSlugs) {
      if (subdomain === slug || subdomain.startsWith(`${slug}-`)) {
        return true;
      }
    }
  }

  return false;
}

const corsOriginDelegate = (origin, callback) => {
  if (isAllowedOrigin(origin)) {
    callback(null, true);
  } else {
    callback(new Error(`Origin ${origin} not allowed by SkillSwap CORS policy`));
  }
};

// Initialize Socket.io for WebRTC signaling and real-time notifications
const io = new Server(server, {
  cors: {
    origin: corsOriginDelegate,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  },
});

// Provide io instance to notification service
setIO(io);

// Socket.io JWT Authentication Middleware
io.use((socket, next) => {
  const token =
    socket.handshake.auth?.token ||
    (socket.handshake.headers?.authorization &&
      socket.handshake.headers.authorization.replace('Bearer ', ''));

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
    } catch (err) {
      console.warn('[Socket.io] Token handshake verification note:', err.message);
    }
  }
  next();
});

// Connect to MongoDB
connectDB();

app.use(cors({ origin: corsOriginDelegate, credentials: true }));
app.use(express.json({ limit: '10mb' }));

// Safe Health Check Endpoint for Render keep-alive and UptimeRobot monitoring
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'skillswap-backend',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
  });
});

// Mount API routes
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/match', matchRoutes);
app.use('/api/swap', swapRoutes);
app.use('/api/rating', ratingRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/verification', verificationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/endorsements', endorsementRoutes);
app.use('/api/learning', learningRoutes);
app.use('/api/cron', cronRoutes);

// Centralized error handling middleware (handles CORS rejection with 403 Forbidden)
app.use((err, req, res, next) => {
  if (err && err.message && err.message.includes('CORS policy')) {
    return res.status(403).json({ message: err.message });
  }
  console.error('[Server Error]', err);
  res.status(500).json({
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'production' ? undefined : err.message,
  });
});

// Real-time Event Handlers
io.on('connection', (socket) => {
  console.log(`[Socket.io] Socket connected: ${socket.id}`);

  // Automatically join private user notification room if authenticated during handshake
  if (socket.userId) {
    const userRoom = `user:${socket.userId}`;
    socket.join(userRoom);
    console.log(`[Socket.io] User ${socket.userId} joined notification room: ${userRoom}`);
  }

  // Allow client to authenticate post-connection if token was retrieved later
  socket.on('authenticate', (token) => {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      const userRoom = `user:${socket.userId}`;
      socket.join(userRoom);
      console.log(`[Socket.io] Socket ${socket.id} authenticated for room: ${userRoom}`);
    } catch (err) {
      console.warn('[Socket.io] Post-connection auth rejected:', err.message);
    }
  });

  // ─── WebRTC P2P Signaling ──────────────────────────────────
  // User joins a video room
  socket.on('join-room', ({ roomId, userName }) => {
    socket.join(roomId);
    console.log(`User ${userName} (${socket.id}) joined video room: ${roomId}`);

    socket.to(roomId).emit('user-joined', {
      socketId: socket.id,
      userName: userName || 'Peer',
    });
  });

  // Relay WebRTC SDP Offer
  socket.on('webrtc-offer', ({ roomId, sdp }) => {
    socket.to(roomId).emit('webrtc-offer', {
      sdp,
      senderId: socket.id,
    });
  });

  // Relay WebRTC SDP Answer
  socket.on('webrtc-answer', ({ roomId, sdp }) => {
    socket.to(roomId).emit('webrtc-answer', {
      sdp,
      senderId: socket.id,
    });
  });

  // Relay ICE Candidate
  socket.on('webrtc-ice-candidate', ({ roomId, candidate }) => {
    socket.to(roomId).emit('webrtc-ice-candidate', {
      candidate,
      senderId: socket.id,
    });
  });

  // Peer leaves room explicitly
  socket.on('leave-room', ({ roomId }) => {
    socket.leave(roomId);
    socket.to(roomId).emit('user-left');
  });

  socket.on('disconnecting', () => {
    for (const room of socket.rooms) {
      if (room !== socket.id && !room.startsWith('user:')) {
        socket.to(room).emit('user-left');
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.io] Socket disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 5001;

if (require.main === module) {
  // Initialize background session reminder scheduler
  initReminderScheduler();

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// ── Graceful Shutdown Handler (SIGTERM & SIGINT) ──────────────────────────
let isShuttingDown = false;

const gracefulShutdown = async (signal = 'SIGTERM') => {
  if (isShuttingDown) {
    console.log(`[Server] Shutdown already in progress. Ignoring duplicate ${signal} signal.`);
    return;
  }
  isShuttingDown = true;
  console.log(`[Server] ${signal} signal received. Starting graceful shutdown sequence...`);

  // Force exit fallback timer (10 seconds) to prevent hanging indefinitely
  const forceExitTimer = setTimeout(() => {
    console.error('[Server] Graceful shutdown timed out after 10s. Forcing exit.');
    process.exit(1);
  }, 10000);
  forceExitTimer.unref();

  let hasError = false;

  // 1. Stop background reminder scheduler
  try {
    stopReminderScheduler();
  } catch (schedErr) {
    console.error('[Server] Error stopping reminder scheduler:', schedErr.message);
    hasError = true;
  }

  // 2. Close Socket.io server (in Socket.io v4, io.close() disconnects sockets and closes attached httpServer)
  if (io) {
    try {
      console.log('[Server] Closing Socket.io engine and attached HTTP server...');
      await new Promise((resolve) => {
        io.close((err) => {
          if (err) {
            console.error('[Server] Note during Socket.io close:', err.message);
          } else {
            console.log('[Server] Socket.io engine and attached HTTP server closed.');
          }
          resolve();
        });
      });
    } catch (ioErr) {
      console.error('[Server] Error closing Socket.io:', ioErr.message);
      hasError = true;
    }
  }

  // 3. Fallback: Close HTTP server only if still listening (e.g. if io was not attached or omitted)
  if (server.listening) {
    try {
      console.log('[Server] Closing HTTP server...');
      await new Promise((resolve) => {
        server.close((err) => {
          if (err && err.code !== 'ERR_SERVER_NOT_RUNNING') {
            console.error('[Server] Note during HTTP server close:', err.message);
          } else {
            console.log('[Server] HTTP server stopped accepting connections.');
          }
          resolve();
        });
      });
    } catch (srvErr) {
      console.error('[Server] Error closing HTTP server:', srvErr.message);
      hasError = true;
    }
  }

  // 4. Close MongoDB connection cleanly (always attempted, never skipped by earlier step errors)
  try {
    if (mongoose.connection && mongoose.connection.readyState !== 0) {
      console.log('[Server] Closing MongoDB connection...');
      await mongoose.connection.close(false);
      console.log('[Server] MongoDB connection closed cleanly.');
    }
  } catch (dbErr) {
    console.error('[Server] Error closing MongoDB connection:', dbErr.message);
    hasError = true;
  }

  clearTimeout(forceExitTimer);

  if (hasError) {
    console.warn('[Server] Graceful shutdown finished with warnings/errors. Exiting with code 1.');
    process.exit(1);
  } else {
    console.log('[Server] Graceful shutdown complete. Exiting process with code 0.');
    process.exit(0);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = {
  app,
  server,
  io,
  isAllowedOrigin,
  gracefulShutdown,
};
