# Snake Arena — 45-Player Multiplayer Snake

Mouse-controlled multiplayer Snake for up to 45 players in one room. Host starts an
80-second round; everyone eats gold food (+10), avoids pink poison (-8), races for
scarce purple magic food (+50, only 5 on the field), and can grab a gold star for a
temporary 2x score multiplier. Hold the mouse button to boost (limited
energy, regenerates). Pick a neon color + pattern for your snake in the lobby. All sound
and music is synthesized live with the Web Audio API — no audio files to host.

## Why this can't be "just" a Netlify deploy

Netlify serves static files and short-lived serverless functions. This game needs a
persistent WebSocket connection (via Socket.io) that stays open for the whole round and
broadcasts ~20 updates/second to every player — that needs a real always-on server.
Netlify can still host the *frontend* (see Option B below), but the game server itself
needs a host built for persistent connections. Render.com's free tier works well and
takes about 5 minutes.

## Run it locally first (recommended)

```bash
npm install
npm start
```

Then open `http://localhost:3000` in a few browser tabs (or ask friends on the same
network to open `http://YOUR-LOCAL-IP:3000`) to try it before deploying.

---

## Option A — Single deploy on Render (simplest, one URL, do this if you don't need Netlify specifically)

1. Push this folder to a new GitHub repo.
2. Go to [render.com](https://render.com) → **New +** → **Web Service** → connect the repo.
3. Settings:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free
4. Deploy. Render gives you a URL like `https://snake-arena.onrender.com` — that's
   the whole game (frontend + realtime server), working immediately, no code changes needed.

(Free-tier Render services sleep after inactivity and take ~30s to wake up on the next
visit — fine for a demo/test, upgrade to a paid instance for always-on.)

---

## Option B — Netlify frontend + Render backend (if you specifically want it on netlify.app)

1. **Deploy the backend first**, same as Option A steps 1–4, but you only need it for the
   server. Note the resulting URL, e.g. `https://snake-arena-server.onrender.com`.

2. **Point the frontend at that backend.** Open `public/game.js` and change:
   ```js
   const socket = io();
   ```
   to:
   ```js
   const socket = io("https://snake-arena-server.onrender.com");
   ```

3. **Deploy `public/` to Netlify:**
   - Drag-and-drop the `public` folder onto [app.netlify.com/drop](https://app.netlify.com/drop), **or**
   - Via CLI:
     ```bash
     npm install -g netlify-cli
     cd public
     netlify deploy --prod
     ```
   - `netlify.toml` in this repo is already set to publish the `public` folder if you
     deploy from the project root instead.

4. Visit your `*.netlify.app` URL — the page loads from Netlify, and all game traffic
   goes to your Render backend over WebSockets. CORS is already open on the server
   (`origin: "*"`) so this works without extra config.

---

## Project structure

```
server.js         Authoritative game server (Express + Socket.io)
public/
  index.html       Lobby, game, and results screens
  style.css        Neon-arcade visual theme
  game.js          Client networking, input, canvas rendering, HUD
  sfx.js           Synthesized sound effects + background chiptune loop
```

## Tuning knobs (all in `server.js`)

- `ROUND_MS` — round length (currently 80000 = 80s)
- `FOOD_COUNT` / `POISON_COUNT` — how crowded the arena feels
- `SS_FOOD_COUNT` / `SS_FOOD_VALUE` — magic food: scarce high-value pickups players compete for (5 × +50)
- `BASE_SPEED` / `BOOST_SPEED` — pace of play
- `MAX_TURN_PER_TICK` — how sharply snakes can turn (higher = easier to whip around)
- `MAX_PLAYERS_PER_ROOM` — currently 45

## Multiple simultaneous games

Rooms are just a code (`?room=YOURCODE` in the URL, or typed in the lobby). Any number
of independent 45-player rounds can run at once on the same deployment under different
room codes.
# cop-snake-game
