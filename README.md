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

### Vercel

Keep the Vercel project root set to the repository root, not `client/`. The root `vercel.json` builds `client/` into `dist/` and rewrites `/api/*` to the Node function at `api/index.js`. Configure `MONGO_URI`, `SESSION_SECRET` (at least 32 random characters), and `GOOGLE_CLIENT_ID` in Vercel's Production environment, then redeploy. Do not set `PORT` to a database or server URL; Vercel manages function ports. Add the deployed site origin to the Google OAuth client's authorized JavaScript origins.

Vercel Functions do not provide the persistent Socket.IO server required for live Memory Pass rooms. The authentication API can run on Vercel, but multiplayer needs a separately hosted, long-running Node service. Set `VITE_SOCKET_URL` in Vercel to that service's HTTPS origin (for example, `https://game.example.com`) and redeploy. Set `CLIENT_ORIGIN` on the game server to the exact frontend origin (for example, `https://casual.example.com`).

Socket authentication uses the same MongoDB-backed session as the API. To share its cookie across the frontend and game server, use custom domains under the same parent domain (for example, `casual.example.com` and `game.example.com`) and set `COOKIE_DOMAIN=.example.com` on both deployments. The game server also needs the same `MONGO_URI` and `SESSION_SECRET`. A Vercel `*.vercel.app` frontend and a separately hosted game server on an unrelated domain cannot share this cookie; use a custom domain or implement token-based socket authentication instead.

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
