# Casual Game Portal

A casual game portal with a React 19 and Vite frontend, Node.js/Express 5 API, MongoDB sessions, and Ably Realtime multiplayer.

## Requirements

- Node.js 22.12 or newer
- MongoDB running locally or a MongoDB connection URI

## Run locally

1. Install dependencies with `npm install`.
2. Set `MONGO_URI`, `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, and `ABLY_API_KEY` in `.env`. Create a Google OAuth web client and add your app origin (for local development, `http://localhost:5173`) to its authorized JavaScript origins. Configure the server-side Ably key to publish and issue scoped subscribe tokens for `memory:*` and `secret-hitler:*` channels.
3. Start MongoDB, then run `npm run dev`.
4. Open [http://localhost:5173](http://localhost:5173). Vite proxies API traffic to the Express server on port 5000.

## Project structure

```text
client/                 React application
server/
	config/               Database and service configuration
	games/                Server-authoritative game rules
	middleware/           Express middleware
	models/               MongoDB models
	routes/               HTTP API routes
	index.js              Express API and static server entry point
tests/                  Automated tests
vite.config.js          Frontend development and build configuration
```

The checked-out `.env` file uses the requested local development values and is excluded from Git. Do not use `SESSION_SECRET=secretkey` outside local development; production startup requires a secret of at least 32 characters and uses secure session cookies. Use `.env.example` as the configuration template.

## Production

Run `npm run build` to compile the React app into `dist/`, then start the API and static frontend with `npm start`. Set `NODE_ENV=production`, `MONGO_URI`, and a strong `SESSION_SECRET` in the deployment environment. Terminate TLS at a trusted reverse proxy so secure session cookies can be used.

### Vercel

Keep the Vercel project root set to the repository root, not `client/`. The root `vercel.json` builds `client/` into `dist/` and rewrites `/api/*` to the Node function at `api/index.js`. Configure `MONGO_URI`, `SESSION_SECRET` (at least 32 random characters), `GOOGLE_CLIENT_ID`, and `ABLY_API_KEY` in Vercel's Production environment, then redeploy. The Ably API key must allow server-side publish and token issuance for `memory:*` channels; it is never sent to the browser. The server issues short-lived Ably tokens limited to subscribing to the current room state and that player's private hand. Do not set `PORT`; Vercel manages function ports. Add the deployed site origin to the Google OAuth client's authorized JavaScript origins.

Memory Pass room state and hands are stored in MongoDB. Ably carries live state updates; clients send game actions to the authenticated API, which validates them before publishing. Configure the same `MONGO_URI` and `SESSION_SECRET` locally when testing multiplayer. Vercel functions may process concurrent updates; optimistic room versioning rejects conflicting moves so clients can refresh and retry. Reveal expiry is applied on the next API request, not by a background timer.

## Secret Hitler

Secret Hitler is a noncommercial fan adaptation for private game nights. It supports 5-10 players, hidden roles and private team knowledge, simultaneous elections, secret policy selection, presidential powers, vetoes, and both teams' win conditions. MongoDB stores room state; when configured, Ably publishes public state separately from each player's private role, intel, and policy hand. Votes are only published after every active player has voted. Without `ABLY_API_KEY`, the game falls back to authenticated polling. Role-reveal expiry is applied on the next API request, not by a background timer.

The original game was created by Mike Boxleiter, Tommy Maranges, and Mac Schubert: [secrethitler.com](https://www.secrethitler.com/). This digital adaptation uses an original interface and does not include the supplied print-and-play artwork. It is distributed under the same [Creative Commons BY-NC-SA 4.0 license](https://creativecommons.org/licenses/by-nc-sa/4.0/): attribution is required, commercial use is prohibited, and adaptations must use the same license.

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
