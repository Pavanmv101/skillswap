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

// Import notification and reminder services
const { setIO } = require('./services/notificationService');
const { initReminderScheduler } = require('./services/reminderService');

const app = express();
const server = http.createServer(app);

// Initialize Socket.io for WebRTC signaling and real-time notifications
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
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

app.use(cors());
app.use(express.json({ limit: '10mb' }));

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
