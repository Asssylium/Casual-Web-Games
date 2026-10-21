# Casual Game Portal

A casual game portal with a React 19 and Vite frontend, Node.js/Express 5 API, MongoDB sessions, and Socket.IO multiplayer.

## Requirements

- Node.js 22.12 or newer
- MongoDB running locally or a MongoDB connection URI

## Run locally

1. Install dependencies with `npm install`.
2. Set `MONGO_URI`, `SESSION_SECRET`, and `GOOGLE_CLIENT_ID` in `.env`. Create a Google OAuth web client and add your app origin (for local development, `http://localhost:5173`) to its authorized JavaScript origins.
3. Start MongoDB, then run `npm run dev`.
4. Open [http://localhost:5173](http://localhost:5173). Vite proxies API and Socket.IO traffic to the Express server on port 5000.

## Project structure

```text
client/                 React application
server/
	config/               Database and service configuration
	games/                Server-authoritative game rules
	middleware/           Express middleware
	models/               MongoDB models
	routes/               HTTP API routes
	index.js              Express and Socket.IO entry point
tests/                  Automated tests
vite.config.js          Frontend development and build configuration
```

The checked-out `.env` file uses the requested local development values and is excluded from Git. Do not use `SESSION_SECRET=secretkey` outside local development; production startup requires a secret of at least 32 characters and uses secure session cookies. Use `.env.example` as the configuration template.

## Production

Run `npm run build` to compile the React app into `dist/`, then start the API and static frontend with `npm start`. Set `NODE_ENV=production`, `MONGO_URI`, and a strong `SESSION_SECRET` in the deployment environment. Terminate TLS at a trusted reverse proxy so secure session cookies can be used.

## Authentication API

All endpoints are prefixed with `/api/auth` and expect JSON request bodies:

- `POST /signup` — `{ "username": "...", "email": "...", "password": "..." }`
- `POST /login` — `{ "identifier": "username or email", "password": "..." }`
- `POST /logout`
- `GET /status` — returns the current user or `401` if signed out

Passwords are hashed with bcrypt. Sessions are stored in MongoDB; the browser session cookie is HTTP-only, same-site, and secure in production. The game-stat fields are initialized on registration for use by game features.

Google signup and signin use Google Identity Services. Set `GOOGLE_CLIENT_ID` to the web client ID; the server verifies each ID token and creates or links an account only when Google reports a verified email address.

## Memory Pass

The Memory Pass tile is a live multiplayer prototype. Signed-in players can create a room or join with its five-character code. The host starts with at least two connected players. Everyone sees each player's object card and passing direction for 12 seconds, then the first player is selected randomly. On a turn, choose a card, pass it left or right as allowed, and name the card. The receiver may accept the card or challenge the claim. A caught lie eliminates the giver; challenging a truthful claim eliminates the receiver. The last remaining player wins.

Room state is held in server memory, so restarting the server ends active rooms. Run `npm test` for the card-claim rule tests and `npm run build` for the frontend production build.
