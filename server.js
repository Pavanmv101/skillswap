require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
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
const { initReminderScheduler } = require('./services/reminderService');

const app = express();
const server = http.createServer(app);

// ── Production-Grade Trusted CORS Configuration ───────────────────────────
const localDevOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:5173',
];

const configuredClientUrls = process.env.CLIENT_URL
  ? process.env.CLIENT_URL.split(',').map(u => u.trim().replace(/\/$/, ''))
  : [];

const allowedOrigins = [...localDevOrigins, ...configuredClientUrls];

const corsOriginDelegate = (origin, callback) => {
  // Allow requests with no origin (curl, server-to-server, native mobile)
  if (!origin) return callback(null, true);

  if (process.env.NODE_ENV !== 'production' || configuredClientUrls.length === 0) {
    // In local development or testing, permit all
    return callback(null, true);
  }

  // In production, match trusted client URLs or Vercel preview URLs if configured
  const isAllowed = allowedOrigins.some(allowed =>
    origin === allowed || (allowed.includes('.vercel.app') && origin.endsWith('.vercel.app'))
  );

  if (isAllowed) {
    callback(null, true);
  } else {
    callback(new Error(`Origin ${origin} not allowed by SkillSwap CORS policy`));
  }
};

// Initialize Socket.io for WebRTC signaling and real-time notifications
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' && configuredClientUrls.length > 0
      ? (origin, cb) => corsOriginDelegate(origin, cb)
      : '*',
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

// Initialize background session reminder scheduler
initReminderScheduler();

const PORT = process.env.PORT || 5001;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
