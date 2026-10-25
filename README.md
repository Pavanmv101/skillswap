# SkillSwap: Peer-to-Peer Skill Barter System

SkillSwap is a full-stack MERN (MongoDB, Express, React, Node.js) platform designed for college students and peers to exchange skills without monetary transactions. Users list skills they can teach and skills they want to learn. The system calculates bidirectional compatibility scores, detects schedule overlaps, facilitates swap requests, hosts live video sessions via Jitsi Meet, and tracks mutual ratings and reviews.

---

## Tech Stack

| Layer | Technology | Details |
|---|---|---|
| **Frontend** | React 18, Vite | SPA with React Router v6, custom modular CSS |
| **State & Auth** | React Context API | Token persisted in `localStorage`, Axios interceptors |
| **Backend** | Node.js, Express 5 | RESTful API architecture |
| **Database** | MongoDB, Mongoose | Relational-like schema with subdocuments & references |
| **Authentication**| JWT (`jsonwebtoken`) & `bcryptjs` | Stateless bearer token authentication |
| **Video Calls** | Custom Native WebRTC & Socket.io | Peer-to-peer audio/video streaming, screen sharing, STUN signaling |

---

## Project Structure

```
skillswap/
├── backend/
│   ├── config/
│   │   └── db.js                 # MongoDB connection
│   ├── controllers/
│   │   ├── authController.js     # Register & Login with JWT
│   │   ├── profileController.js  # User profile, public profiles, blocking
│   │   ├── matchController.js    # Compatibility scoring algorithm & search
│   │   ├── swapController.js     # Swap lifecycle (create, accept, reject, cancel, complete, schedule)
│   │   └── ratingController.js   # Rating creation & aggregate calculations
│   ├── middleware/
│   │   └── auth.js               # JWT verification middleware
│   ├── models/
│   │   ├── User.js               # User schema (skills, availability, ratings)
│   │   ├── SwapRequest.js        # Swap requests schema (status, roomId, schedule)
│   │   └── Rating.js             # Ratings & review schema
│   ├── routes/
│   │   ├── authRoutes.js
│   │   ├── profileRoutes.js
│   │   ├── matchRoutes.js
│   │   ├── swapRoutes.js
│   │   └── ratingRoutes.js
│   ├── seed.js                   # Demo users & sample swap seeder
│   ├── .env                      # Port, DB URI, JWT secret
│   └── server.js                 # Express app entrypoint
│
└── frontend/
    ├── index.html
    ├── vite.config.js            # Proxy `/api` to port 5001
    ├── package.json
    └── src/
        ├── api/
        │   └── axios.js          # Pre-configured Axios instance with auth interceptor
        ├── context/
        │   └── AuthContext.jsx   # Global login/logout state
        ├── components/
        │   ├── Navbar.jsx        # Navigation bar with active route highlight
        │   ├── CompatBar.jsx     # Visual compatibility score bar (0-100%)
        │   ├── Stars.jsx         # 5-star rating display
        │   ├── Spinner.jsx       # Loading indicator
        │   ├── SwapModal.jsx     # Send swap request modal
        │   ├── ScheduleModal.jsx # Date & time scheduler modal
        │   └── RatingModal.jsx   # Post-session rating modal
        ├── pages/
        │   ├── Landing.jsx       # Public landing page with features overview
        │   ├── Login.jsx         # User login form
        │   ├── Register.jsx      # New account registration
        │   ├── Dashboard.jsx     # Statistics overview & incoming notifications
        │   ├── Profile.jsx       # Skills & weekly availability slot editor
        │   ├── Matches.jsx       # Ranked matches, search & swap initiation
        │   ├── Swaps.jsx         # Tabs for Received, Sent, Active & Completed swaps
        │   ├── Room.jsx          # Live Jitsi video session screen
        │   └── PublicProfile.jsx # Public peer profile & review history
        ├── App.jsx               # Client routes & protected route wrapper
        ├── main.jsx              # React root entrypoint
        └── index.css             # Theme variables, cards, buttons, badges
```

---

## Quick Start Guide

### 1. Backend Setup

```bash
cd backend
npm install
```

Make sure your `.env` is configured (note: Port 5001 avoids macOS AirPlay port 5000 conflicts):
```env
PORT=5001
MONGO_URI=mongodb://localhost:27017/skillswap
JWT_SECRET=skillswap_super_secret_key_change_in_production
```

Start MongoDB service:
```bash
brew services start mongodb-community
```

*(Optional)* Seed sample users with skills, schedules, and reviews:
```bash
npm run seed
```

Start the backend server:
```bash
npm start
# -> Connected to MongoDB: mongodb://localhost:27017/skillswap
# -> Server running on port 5001
```

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run dev
# -> Local: http://localhost:3001
```

Open `http://localhost:3001` in your web browser.

---

## Compatibility Scoring Algorithm

To keep the application transparent and explainable to academic panels without black-box ML, the matching engine uses an intuitive rule-based scoring system (0–100 points):

1. **Forward Match (up to 60 pts)**:
   $$\text{Points} = \min(60, \text{Count of your wanted skills offered by them} \times 20)$$
2. **Reverse Match (up to 40 pts — Bidirectionality Bonus)**:
   $$\text{Points} = \min(40, \text{Count of their wanted skills offered by you} \times 20)$$
3. **Availability Overlap Check**:
   $$\text{Overlap} \iff (\text{Day}_A = \text{Day}_B) \land (\text{From}_A < \text{To}_B) \land (\text{From}_B < \text{To}_A)$$
   Displays an overlap badge so users know their schedules align before requesting a swap.

---

## API Endpoints Reference

### Auth
- `POST /api/auth/register` — Register a new account (`name`, `email`, `password`)
- `POST /api/auth/login` — Login and receive JWT token + user details

### Profile
- `GET /api/profile` — Get logged-in user profile
- `PUT /api/profile` — Update bio, skills offered, skills wanted, and availability slots
- `GET /api/profile/:id` — View any user's public profile and reviews
- `POST /api/profile/block/:id` — Block an abusive user

### Matching & Search
- `GET /api/match` — Fetch ranked matches computed by compatibility score
- `GET /api/match/search?q=keyword` — Search users by skill name or user name

### Swap Management
- `POST /api/swap` — Initiate a swap request
- `GET /api/swap` — List all swaps (sent and received)
- `PUT /api/swap/:id/accept` — Accept swap & generate unique Jitsi `roomId`
- `PUT /api/swap/:id/reject` — Reject a pending swap
- `PUT /api/swap/:id/cancel` — Cancel a pending swap sent by you
- `PUT /api/swap/:id/complete` — Mark an accepted swap as completed
- `PUT /api/swap/:id/schedule` — Set date/time for the session

### Ratings & Feedback
- `POST /api/rating` — Submit a 1–5 star rating and comment (prevents duplicates)
- `GET /api/rating/user/:id` — Get all ratings and reviews for a user

---

## Demo Accounts (Populated by `npm run seed`)

| Name | Email | Password | Teaches | Wants |
|---|---|---|---|---|
| Aarav Sharma | `aarav@skillswap.com` | `password123` | React, JavaScript, Node.js | Python, Machine Learning |
| Priya Patel | `priya@skillswap.com` | `password123` | Python, Machine Learning, Data Analysis | React, UI/UX Design |
| Rohan Verma | `rohan@skillswap.com` | `password123` | UI/UX Design, Figma | JavaScript, React |
| Sneha Kulkarni | `sneha@skillswap.com` | `password123` | Acoustic Guitar, Music Production | Python, Spanish |

---

## Academic Panel & Viva Questions Cheat Sheet

**Q: Why use MERN stack instead of traditional SQL/Django/PHP?**
> A: MERN offers a single-language ecosystem (JavaScript/Node.js) from client to database. MongoDB's JSON/BSON document model naturally matches React state, making it ideal for flexible profile structures like varying lists of skills and availability slots.

**Q: How does the matching algorithm work?**
> A: It calculates a bidirectional compatibility score. Up to 60 points are given for forward matches (the candidate teaches skills you want), and up to 40 bonus points are awarded for reverse matches (you can teach skills the candidate wants). It also checks for overlapping day/time availability windows.

**Q: How are passwords and authentication secured?**
> A: Passwords are encrypted using salted one-way hashing via `bcryptjs` (salt rounds = 10) before persisting to MongoDB. Authenticated sessions use signed JSON Web Tokens (JWT) transmitted via the standard `Authorization: Bearer <token>` HTTP header.

**Q: How is native WebRTC implemented for video calling?**
> A: We built a custom WebRTC implementation without relying on third-party services. The architecture consists of:
> 1. **Media Capture**: `navigator.mediaDevices.getUserMedia()` accesses user webcam and microphone streams.
> 2. **Signaling Server**: An Express + Socket.io server relays SDP (Session Description Protocol) offers, answers, and ICE candidates between peers.
> 3. **P2P Connection**: `new RTCPeerConnection()` establishes a direct peer-to-peer connection utilizing public Google STUN servers (`stun:stun.l.google.com:19302`) for NAT traversal.
> 4. **Screen Sharing**: `navigator.mediaDevices.getDisplayMedia()` dynamically replaces the outgoing video track on the WebRTC sender.

**Q: How is data consistency maintained for user ratings?**
> A: Each rating is stored as an individual record linking the swap request, rater, and ratee. Upon creating a rating, the controller prevents duplicate ratings for the same swap and re-computes `averageRating` and `totalRatings` on the ratee's User document.
