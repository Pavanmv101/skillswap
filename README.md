# SkillSwap

A peer-to-peer skill exchange platform. Users list skills they can teach and skills they want to learn. The platform matches them, lets them send swap requests, video call via Jitsi, and rate each other after sessions.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express.js |
| Database | MongoDB, Mongoose |
| Auth | JWT (jsonwebtoken), bcryptjs |
| Frontend | React 18, Vite |
| Routing | React Router v6 |
| HTTP Client | Axios |
| Video Calls | Jitsi Meet (iframe embed) |

---

## Project Structure

```
skillswap/
├── backend/
│   ├── config/db.js
│   ├── controllers/
│   │   ├── authController.js
│   │   ├── profileController.js
│   │   ├── matchController.js
│   │   ├── swapController.js
│   │   └── ratingController.js
│   ├── middleware/auth.js
│   ├── models/
│   │   ├── User.js
│   │   ├── SwapRequest.js
│   │   └── Rating.js
│   ├── routes/
│   │   ├── authRoutes.js
│   │   ├── profileRoutes.js
│   │   ├── matchRoutes.js
│   │   ├── swapRoutes.js
│   │   └── ratingRoutes.js
│   ├── .env
│   └── server.js
│
└── frontend/
    ├── src/
    │   ├── api/axios.js
    │   ├── context/AuthContext.jsx
    │   ├── components/
    │   │   ├── Navbar.jsx
    │   │   ├── Spinner.jsx
    │   │   ├── SwapModal.jsx
    │   │   └── RatingModal.jsx
    │   ├── pages/
    │   │   ├── Login.jsx
    │   │   ├── Register.jsx
    │   │   ├── Profile.jsx
    │   │   ├── Matches.jsx
    │   │   ├── Swaps.jsx
    │   │   └── Room.jsx
    │   ├── App.jsx
    │   ├── main.jsx
    │   └── index.css
    └── vite.config.js
```

---

## Setup & Running

### Prerequisites
- Node.js v18+
- MongoDB running locally (`mongod`) or a MongoDB Atlas URI

### 1. Backend

```bash
cd backend
npm install
```

Create a `.env` file (already provided):
```
PORT=5000
MONGO_URI=mongodb://localhost:27017/skillswap
JWT_SECRET=skillswap_super_secret_key_change_in_production
```

Start the server:
```bash
node server.js
# → MongoDB connected
# → Server running on port 5000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:3000
```

The Vite dev server proxies all `/api` calls to `http://localhost:5000` automatically.

---

## API Endpoints

### Auth
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/auth/register` | Register new user | ❌ |
| POST | `/api/auth/login` | Login, receive JWT | ❌ |

### Profile
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/profile` | Get current user's profile | ✅ |
| PUT | `/api/profile` | Update skills & availability | ✅ |

### Matching
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| GET | `/api/match` | Find users who offer skills you want | ✅ |

### Swap Requests
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/swap` | Send a swap request | ✅ |
| GET | `/api/swap` | List all your swap requests | ✅ |
| PUT | `/api/swap/:id/accept` | Accept a request (generates roomId) | ✅ |
| PUT | `/api/swap/:id/reject` | Reject a request | ✅ |
| PUT | `/api/swap/:id/complete` | Mark a swap as completed | ✅ |

### Ratings
| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/api/rating` | Submit a rating for a swap | ✅ |
| GET | `/api/rating/user/:id` | Get all ratings for a user | ✅ |

---

## User Flow

```
Register → Update Profile (add skills)
        → Browse Matches
        → Send Swap Request
        → Other user Accepts → roomId generated
        → Both join Jitsi video call
        → Mark swap Complete
        → Rate each other (updates averageRating)
```

---

## Notes for Academic Panel

- **No TypeScript** — plain JavaScript throughout for readability
- **No Redux / Zustand** — React Context API used for auth state
- **No extra libraries** — only what's in `package.json`
- **JWT is stateless** — no sessions, no cookies
- **Matching is a simple array overlap** — `$in` query on MongoDB
- **Jitsi** — no backend SDK needed; the room name is a string, the frontend opens `https://meet.jit.si/<roomId>` in an iframe
