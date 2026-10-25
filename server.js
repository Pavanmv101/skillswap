require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const connectDB = require('./config/db');

// Import routes
const authRoutes = require('./routes/authRoutes');
const profileRoutes = require('./routes/profileRoutes');
const matchRoutes = require('./routes/matchRoutes');
const swapRoutes = require('./routes/swapRoutes');
const ratingRoutes = require('./routes/ratingRoutes');

const app = express();
const server = http.createServer(app);

// Initialize Socket.io for WebRTC signaling
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Connect to MongoDB
connectDB();

app.use(cors());
app.use(express.json());

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/match', matchRoutes);
app.use('/api/swap', swapRoutes);
app.use('/api/rating', ratingRoutes);

// WebRTC Signaling via Socket.io
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // User joins a video room
  socket.on('join-room', ({ roomId, userName }) => {
    socket.join(roomId);
    console.log(`User ${userName} (${socket.id}) joined room: ${roomId}`);

    // Notify other peer in the room that a user has joined
    socket.to(roomId).emit('user-joined', {
      socketId: socket.id,
      userName: userName || 'Peer'
    });
  });

  // Relay WebRTC SDP Offer
  socket.on('webrtc-offer', ({ roomId, sdp }) => {
    socket.to(roomId).emit('webrtc-offer', {
      sdp,
      senderId: socket.id
    });
  });

  // Relay WebRTC SDP Answer
  socket.on('webrtc-answer', ({ roomId, sdp }) => {
    socket.to(roomId).emit('webrtc-answer', {
      sdp,
      senderId: socket.id
    });
  });

  // Relay ICE Candidate
  socket.on('webrtc-ice-candidate', ({ roomId, candidate }) => {
    socket.to(roomId).emit('webrtc-ice-candidate', {
      candidate,
      senderId: socket.id
    });
  });

  // Peer leaves room explicitly
  socket.on('leave-room', ({ roomId }) => {
    socket.leave(roomId);
    socket.to(roomId).emit('user-left');
  });

  socket.on('disconnecting', () => {
    for (const room of socket.rooms) {
      if (room !== socket.id) {
        socket.to(room).emit('user-left');
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 5001;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
