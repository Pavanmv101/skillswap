# SkillSwap: Peer-to-Peer Collaborative Skill Barter Platform

SkillSwap is a production-grade full-stack web application designed for students, developers, and lifelong learners to exchange skills collaboratively without monetary transactions. By combining direct bilateral swaps, 3-person circular trade cycles, rule-based weighted recommendation algorithms, peer endorsements, trust verifications, and browser-native WebRTC video calling, SkillSwap provides an end-to-end decentralized learning network.

---

## 1. Problem Statement

Traditional tutoring and course platforms require financial payments, pricing out students and self-learners. Existing barter systems suffer from:
1. **The Double Coincidence of Wants:** Person A wants to learn what Person B teaches, but Person B wants something Person A cannot offer.
2. **Lack of Trust & Accountability:** Unverified skill claims and rampant no-shows undermine peer collaboration.
3. **Fragmented Communication:** Scheduling sessions across disparate timezones and juggling third-party meeting links causes friction.

SkillSwap solves these challenges by implementing **3-way circular exchange discovery** (A → B → C → A), an **explainable hybrid recommendation engine**, **reliability scoring and skill verifications**, **timezone-aware proposal scheduling**, and **in-browser authenticated WebRTC video sessions**.

---

## 2. Key Features

### 🔄 Peer-to-Peer Skill Exchange
- **Bilateral Swaps:** Direct 1-to-1 skill barter proposals with acceptance, rejection, cancellation, and scheduling lifecycles.
- **3-Way Circular Exchanges:** Graph cycle detection identifies closed-loop trading loops ($A \to B \to C \to A$), enabling participants to learn their desired skill even without a direct mutual match.
- **Atomic Reservation Locks:** Concurrency control prevents participants from double-booking overlapping exchanges or accepting conflicting invitations.

### 🎯 Hybrid Weighted Recommendations
- Transparent, explainable rule-based matching engine combining:
  - **Skill Direct Compatibility:** Bidirectional match score between offered and wanted skills.
  - **Reliability & Reputation Weight:** Completion rates, punctuality, and Bayesian average ratings.
  - **Availability & Timezone Alignment:** Overlap detection across active participant availability windows.
- *Note:* The recommendation engine is strictly deterministic and rule-based; it does not utilize black-box machine learning.

### 🛡️ Skill Verification & Peer Endorsements
- **Credential Verification:** Users submit certificates, project URLs, and proofs for administrative review and official verification badges.
- **Peer Endorsements:** Verified peers endorse each other on specific skills with database-enforced unique constraints to prevent spam.

### 📈 Reliability & Reputation Scoring
- Dynamic scoring based on swap completion history, session attendance, cancellation frequency, and mutual star ratings with written reviews.

### 📹 Authenticated WebRTC Video Sessions
- In-browser peer-to-peer audio/video streaming and screen sharing powered by native WebRTC and Socket.io signaling.
- Centralized database authorization: Only authenticated participants assigned to a specific swap or circular leg may join video rooms or exchange signaling packets.
- Optimized indexed room resolution via a sparse database index on `SwapRequest.roomId`.

### 📅 Timezone-Aware Proposal Scheduling
- Interactive scheduling modal supporting IANA timezones and local browser time conversion.
- Two-way proposal review: Teachers propose dates/times; learners review and confirm or request rescheduling with reason tracking. Existing confirmed schedules remain active until a new proposal is mutually confirmed.

### ✅ Two-Stage Learner-Confirmed Completion
- Independent leg completion: Teachers mark their teaching session complete; learners confirm delivery.
- Parent circular exchanges finalize automatically only when all three legs are confirmed by their respective learners.

### 📬 Transactional Outbox & Real-Time Notifications
- Guaranteed event delivery using MongoDB transactional outbox patterns.
- Background polling dispatcher with lease fencing, exponential retry backoff, and terminal failure handling.
- Real-time Socket.io delivery with synchronized unread-count reconciliation.

---

## 3. Technology Stack

| Component | Technology | Version / Details |
| :--- | :--- | :--- |
| **Backend Runtime** | Node.js | v18+ |
| **Web Framework** | Express | v5.2.x |
| **Database** | MongoDB | v6.0+ via Mongoose 9.x |
| **Real-Time & Signaling**| Socket.io | v4.8.x (WebSockets & polling) |
| **Security & Auth** | JWT (`jsonwebtoken`), `bcryptjs`, `express-rate-limit` | Stateless tokens, salted password hashes, IP rate limiting |
| **Frontend Framework** | React | v18.x (Single-Page Application) |
| **Build Tool** | Vite | v5.4.x |
| **Routing** | React Router | v6.x |
| **HTTP Client** | Axios | Configured with automatic bearer token interceptors |

---

## 4. Architecture Overview

```
                      ┌────────────────────────────────────────┐
                      │          React SPA (Vercel)            │
                      └──────────────────┬─────────────────────┘
                                         │
                         HTTPS REST API  │   WSS Signaling / Events
                                         ▼
                      ┌────────────────────────────────────────┐
                      │       Express 5 Server (Render)        │
                      │  - Auth Rate Limiter & Input Validator │
                      │  - REST Controllers (Swap, Match, etc.)│
                      │  - WebRTC Room Authorization Manager   │
                      │  - Socket.io Real-Time Signaling Server│
                      └──────────────┬───────────────────▲─────┘
                                     │                   │
                  Read/Write Queries │                   │ Lease Polling
                                     ▼                   │
                      ┌────────────────────────────┐     │
                      │   MongoDB Atlas / Local    │     │
                      │ - Users & Verification     │     │
                      │ - Swaps & CircularExchanges│     │
                      │ - Transactional Outbox ────┼─────┘
                      └────────────────────────────┘
```

---

## 5. Project Directory Structure

```
skillswap/
├── backend/
│   ├── config/
│   │   └── db.js                 # Database connection manager
│   ├── controllers/
│   │   ├── adminController.js    # Skill verification moderation
│   │   ├── authController.js     # User registration, login, and demo seeding
│   │   ├── circularCompletionController.js # Two-stage leg completion & finalization
│   │   ├── circularProposalController.js   # 3-way cycle detection & activation
│   │   ├── circularSchedulingController.js # Timezone-aware scheduling & confirmation
│   │   ├── endorsementController.js        # Peer skill endorsements
│   │   ├── learningController.js # Learning progress tracking
│   │   ├── matchController.js    # Compatibility scoring algorithm
│   │   ├── notificationController.js       # Notification retrieval & read state
│   │   ├── profileController.js  # Profile management & availability slots
│   │   ├── ratingController.js   # Mutual ratings & reputation calculation
│   │   ├── recommendationController.js     # Hybrid weighted recommendations
│   │   ├── swapController.js     # Bilateral swap lifecycle
│   │   └── verificationController.js       # Credential proof submissions
│   ├── middleware/
│   │   └── auth.js               # JWT authentication middleware
│   ├── models/
│   │   ├── CircularExchange.js   # 3-way circular exchange schema & cycle validation
│   │   ├── Endorsement.js        # Peer endorsements with unique index
│   │   ├── ExchangeReservation.js# Atomic participant locks
│   │   ├── LearningTrack.js      # Learning roadmaps & milestone assessments
│   │   ├── Notification.js       # Notifications with outboxEvent reference
│   │   ├── OutboxEvent.js        # Transactional outbox event store
│   │   ├── Rating.js             # User ratings & feedback
│   │   ├── SkillVerification.js  # Certificate verifications
│   │   ├── SwapRequest.js        # Bilateral & circular child swaps with roomId sparse index
│   │   └── User.js               # User accounts, skills, availability & ratings
│   ├── routes/                   # Express route declarations
│   ├── services/
│   │   ├── notificationService.js # Notification creation and Socket.io emission
│   │   ├── outboxDispatcher.js   # Transactional outbox worker with lease management
│   │   └── reminderService.js    # Clustered session reminder scheduler
│   ├── run_tests.js              # Unified Test Runner
│   ├── test_db_guard.js          # Centralized test database isolation harness
│   ├── package.json              # Backend dependencies & npm test scripts
│   ├── seed.js                   # Demo accounts seeder
│   └── server.js                 # Application entrypoint & WebRTC authorization
│
└── frontend/
    ├── index.html
    ├── vite.config.js            # Vite build configuration & API proxy
    ├── package.json              # Frontend dependencies
    └── src/
        ├── api/axios.js          # Axios client with bearer token interceptor
        ├── components/           # Reusable UI components
        │   ├── CircularCompletionModal.jsx # Teacher completion & learner confirmation
        │   ├── CircularExchangeCard.jsx    # Interactive circular exchange leg card
        │   ├── CircularScheduleModal.jsx   # Timezone-aware leg schedule modal
        │   ├── Navbar.jsx        # Navigation & real-time notification bell
        │   ├── RatingModal.jsx   # Post-session rating modal
        │   └── ScheduleModal.jsx # Bilateral scheduling modal
        ├── context/              # Context state providers (Auth, Notifications)
        ├── pages/                # Application views (Dashboard, Swaps, Matches, Room)
        ├── App.jsx               # Routes and PrivateRoute protection
        └── main.jsx              # React DOM entrypoint
```

---

## 6. Environment Variables

Configure environment variables in a `.env` file in the `backend/` directory.

> **IMPORTANT:** Only environment variable names are listed below. Never commit production values, passwords, or connection strings.

| Variable Name | Required | Purpose |
| :--- | :--- | :--- |
| `PORT` | Optional | Backend HTTP/WebSocket port (defaults to `5001` to avoid macOS AirPlay conflict on 5000) |
| `MONGO_URI` | Required | MongoDB connection URI for application runtime |
| `TEST_MONGO_URI` | Optional | Dedicated MongoDB connection URI for automated tests (defaults to `skillswap_test`) |
| `JWT_SECRET` | Required | Secret key used for signing and verifying JWT tokens |
| `CLIENT_URL` | Optional | Comma-separated list of allowed frontend origins for CORS |
| `NODE_ENV` | Optional | Application runtime environment (`development`, `production`, or `test`) |

---

## 7. Local Setup Instructions

### Prerequisites
- Node.js v18 or later
- MongoDB Community Server v6.0 or later installed and running locally
- Git

### 1. Clone Repository & Install Dependencies
```bash
git clone <repository-url>
cd backend

# Install backend dependencies
npm install

# Install frontend dependencies
cd ../frontend
npm install
cd ../backend
```

### 2. Configure Environment
Create a `.env` file inside the `backend/` directory:
```env
PORT=5001
MONGO_URI=mongodb://localhost:27017/skillswap
TEST_MONGO_URI=mongodb://localhost:27017/skillswap_test
JWT_SECRET=your_local_development_secret_key_minimum_32_characters
CLIENT_URL=http://localhost:3000,http://localhost:5173
NODE_ENV=development
```

### 3. Seed Demo Data (Optional)
Populate sample users, bilateral swaps, ratings, and skill verifications:
```bash
npm run seed
```

### 4. Start Development Servers
Start backend server (Terminal 1):
```bash
cd backend
npm start
# -> Server running on port 5001
```

Start frontend development server (Terminal 2):
```bash
cd frontend
npm run dev
# -> Local: http://localhost:5173
```

Open `http://localhost:5173` in your browser.

---

## 8. Test Execution Instructions

SkillSwap includes a **Unified Test Runner** backed by an **Automated Test Database Guard** ([`test_db_guard.js`](file:///Users/pavanmv/Downloads/backend/test_db_guard.js)). The guard guarantees that tests run exclusively against `skillswap_test`, completely preventing accidental data mutation or cleanup against the production database.

Run test suites from the `backend/` directory:

```bash
# Run all verified integration test suites sequentially (127 tests)
npm test

# Run HTTP rate limiting, input validation, and WebRTC authorization security tests
npm run test:security

# Run WebRTC signaling, room authorization, and roomId sparse index tests
npm run test:webrtc

# Run transactional outbox dispatcher, concurrency, and lease tests
npm run test:outbox

# Run 3-way circular exchanges, reservations, scheduling, and completion tests
npm run test:circular

# Run Phase 7 security remediations, roomId index, and db guard verification
npm run test:phase7

# Run MongoDB Atlas replica-set transaction verification suite (11 tests)
npm run test:atlas
```

All test suites execute deterministically, require zero manual database preparation, and cleanly disconnect all sockets, timers, and database connections upon completion.

---

## 9. Deployment Architecture

SkillSwap is architected for cloud deployment across decoupled, managed infrastructure:

- **Frontend Deployment (Vercel):**
  - **Live URL:** [https://skillswap-eight-pink.vercel.app](https://skillswap-eight-pink.vercel.app)
  - Hosted as a high-performance Single Page Application (SPA).
  - Configured with `vercel.json` rewrites to route API calls or direct cross-origin Axios calls to the backend.
- **Backend Deployment (Render):**
  - **Live API:** [https://skillswap-api-23ag.onrender.com](https://skillswap-api-23ag.onrender.com)
  - Containerized Node.js web service running with Express and Socket.io.
  - Reverse proxy trust configured via `app.set('trust proxy', 1)` to support accurate IP rate limiting behind front-facing load balancers.
  - Strict CORS origin validation allows verified Vercel preview branches while rejecting domain lookalikes.
- **Database (MongoDB Atlas):**
  - Managed MongoDB replica set with SSL/TLS encryption.
  - Fully supports multi-document ACID transactions for circular exchange reservations and outbox event persistence.

---

## 10. Known Limitations & Future Scope

1. **Advanced ML-Based Recommendations:**
   - *Current Implementation:* Deterministic, rule-based weighted algorithm combining compatibility, availability overlap, and user ratings.
   - *Future Scope:* Graph neural networks (GNN) and collaborative filtering to predict successful long-term peer mentorships.
2. **Automated Optimal Scheduling:**
   - *Current Implementation:* Two-way proposal/confirm workflow with participant timezone display.
   - *Future Scope:* Automated multi-party calendar synchronization (Google Calendar / Outlook iCal integration) to automatically propose optimal intersecting slots.
3. **TURN Relay Configuration:**
   - *Current Implementation:* Utilizes public Google STUN servers (`stun:stun.l.google.com:19302`) for WebRTC NAT traversal.
   - *Future Scope:* In corporate, university, or cellular networks with symmetric NATs, a dedicated TURN relay server (e.g., Coturn) is recommended for media fallback.
4. **Multilingual & Localization Support:**
   - *Current Implementation:* Single-language (English) interface.
   - *Future Scope:* Full internationalization (i18n) support across skill taxonomies and interface strings.
5. **Dedicated Native Mobile Applications:**
   - *Current Implementation:* Responsive web application optimized for mobile and desktop viewports.
   - *Future Scope:* Native mobile clients (React Native or Flutter) leveraging native WebRTC drivers and push notification services.
