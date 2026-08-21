// Snake Arena — authoritative multiplayer server
// Handles rooms, lobby, 80s rounds, food/poison/star spawning, scoring, leaderboard.

const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

app.use(express.static(path.join(__dirname, "public")));

// ---------- Config ----------
const WORLD_W = 1600;
const WORLD_H = 900;
const TICK_MS = 50; // 20 ticks/sec
const ROUND_MS = 80000;
const COUNTDOWN_S = 3;
const BASE_SPEED = 2.8; // world units per tick
const BOOST_SPEED = 4.6;
const MAX_TURN_PER_TICK = 0.20; // radians, limits how sharply a snake can turn
const MIN_SEGMENTS = 6;
const MAX_SEGMENTS = 70;
const FOOD_COUNT = 37;
const POISON_COUNT = 13;
const FOOD_VALUE = 10;
const POISON_VALUE = -8;
const SS_FOOD_COUNT = 5; // magic food — scarce & high-value, players compete for it
const SS_FOOD_VALUE = 50; // 5x regular food, worth racing across the arena for
const STAR_DURATION_MS = 6000;
const HEAD_RADIUS = 11;
const ITEM_RADIUS = 9;
const BOOST_MAX_ENERGY = 100;
const BOOST_DRAIN_PER_TICK = 2.2;
const BOOST_REGEN_PER_TICK = 0.9;

const MAX_PLAYERS_PER_ROOM = 45;

/** rooms: Map<roomCode, RoomState> */
const rooms = new Map();

function rid(prefix) {
  return prefix + Math.random().toString(36).slice(2, 9);
}

function createRoom(code) {
  const room = {
    code,
    players: new Map(), // socketId -> player
    hostId: null,
    status: "lobby", // lobby | countdown | playing | ended
    food: [],
    ssFood: [],
    poison: [],
    star: null,
    endsAt: null,
    loop: null,
    countdownTimer: null,
  };
  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  return rooms.get(code) || createRoom(code);
}

function randPos(margin = 60) {
  return {
    x: margin + Math.random() * (WORLD_W - margin * 2),
    y: margin + Math.random() * (WORLD_H - margin * 2),
  };
}

function spawnFood(room) {
  const p = randPos(30);
  room.food.push({ id: rid("f"), x: p.x, y: p.y });
}

function spawnPoison(room) {
  const p = randPos(30);
  room.poison.push({ id: rid("p"), x: p.x, y: p.y });
}

function spawnSSFood(room) {
  const p = randPos(30);
  room.ssFood.push({ id: rid("sf"), x: p.x, y: p.y });
}

function maybeSpawnStar(room) {
  if (room.star) return;
  if (Math.random() < 0.006) {
    const p = randPos(80);
    room.star = { id: rid("s"), x: p.x, y: p.y };
  }
}

function resetField(room) {
  room.food = [];
  room.ssFood = [];
  room.poison = [];
  room.star = null;
  for (let i = 0; i < FOOD_COUNT; i++) spawnFood(room);
  for (let i = 0; i < SS_FOOD_COUNT; i++) spawnSSFood(room);
  for (let i = 0; i < POISON_COUNT; i++) spawnPoison(room);
}

function freshPlayerRuntimeState(p) {
  const start = randPos(150);
  p.x = start.x;
  p.y = start.y;
  p.angle = Math.random() * Math.PI * 2;
  p.targetAngle = p.angle;
  p.trail = [{ x: p.x, y: p.y }];
  p.score = 0;
  p.boosting = false;
  p.boostEnergy = BOOST_MAX_ENERGY;
  p.multiplierUntil = 0;
  p.segments = MIN_SEGMENTS;
}

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    pattern: p.pattern,
    x: p.x,
    y: p.y,
    angle: p.angle,
    trail: p.trail,
    score: Math.round(p.score),
    segments: p.segments,
    boosting: p.boosting,
    boostEnergy: p.boostEnergy,
    multiplied: Date.now() < p.multiplierUntil,
  };
}

function lobbyPayload(room) {
  return {
    room: room.code,
    hostId: room.hostId,
    status: room.status,
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      pattern: p.pattern,
      ready: true,
    })),
  };
}

function broadcastLobby(room) {
  io.to(room.code).emit("lobbyUpdate", lobbyPayload(room));
}

function startCountdown(room) {
  if (room.status !== "lobby") return;
  if (room.players.size === 0) return;
  room.status = "countdown";
  broadcastLobby(room);
  let n = COUNTDOWN_S;
  io.to(room.code).emit("countdown", n);
  room.countdownTimer = setInterval(() => {
    n -= 1;
    if (n > 0) {
      io.to(room.code).emit("countdown", n);
    } else {
      clearInterval(room.countdownTimer);
      room.countdownTimer = null;
      io.to(room.code).emit("countdown", 0);
      beginRound(room);
    }
  }, 1000);
}

function beginRound(room) {
  room.status = "playing";
  resetField(room);
  for (const p of room.players.values()) freshPlayerRuntimeState(p);
  room.endsAt = Date.now() + ROUND_MS;
  broadcastLobby(room);
  io.to(room.code).emit("gameStart", { endsAt: room.endsAt, world: { w: WORLD_W, h: WORLD_H } });

  if (room.loop) clearInterval(room.loop);
  room.loop = setInterval(() => tick(room), TICK_MS);
}

function endRound(room) {
  room.status = "ended";
  if (room.loop) clearInterval(room.loop);
  room.loop = null;
  const leaderboard = [...room.players.values()]
    .map((p) => ({ id: p.id, name: p.name, color: p.color, pattern: p.pattern, score: Math.round(p.score) }))
    .sort((a, b) => b.score - a.score);
  io.to(room.code).emit("gameOver", { leaderboard });
  broadcastLobby(room);
}

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function tick(room) {
  const now = Date.now();
  if (now >= room.endsAt) {
    endRound(room);
    return;
  }

  maybeSpawnStar(room);

  for (const p of room.players.values()) {
    // turn toward target angle, clamped
    const diff = angleDiff(p.angle, p.targetAngle);
    const clamped = Math.max(-MAX_TURN_PER_TICK, Math.min(MAX_TURN_PER_TICK, diff));
    p.angle += clamped;

    // boost / energy
    if (p.boosting && p.boostEnergy > 5) {
      p.boostEnergy = Math.max(0, p.boostEnergy - BOOST_DRAIN_PER_TICK);
    } else {
      p.boosting = false;
      p.boostEnergy = Math.min(BOOST_MAX_ENERGY, p.boostEnergy + BOOST_REGEN_PER_TICK);
    }
    const speed = p.boosting ? BOOST_SPEED : BASE_SPEED;

    p.x += Math.cos(p.angle) * speed;
    p.y += Math.sin(p.angle) * speed;

    // bounce off walls
    if (p.x < HEAD_RADIUS) {
      p.x = HEAD_RADIUS;
      p.angle = Math.PI - p.angle;
      p.targetAngle = p.angle;
    } else if (p.x > WORLD_W - HEAD_RADIUS) {
      p.x = WORLD_W - HEAD_RADIUS;
      p.angle = Math.PI - p.angle;
      p.targetAngle = p.angle;
    }
    if (p.y < HEAD_RADIUS) {
      p.y = HEAD_RADIUS;
      p.angle = -p.angle;
      p.targetAngle = p.angle;
    } else if (p.y > WORLD_H - HEAD_RADIUS) {
      p.y = WORLD_H - HEAD_RADIUS;
      p.angle = -p.angle;
      p.targetAngle = p.angle;
    }

    // update trail
    p.trail.unshift({ x: p.x, y: p.y });
    const maxLen = 4 + p.segments * 2;
    if (p.trail.length > maxLen) p.trail.length = maxLen;

    // collisions: food
    for (let i = room.food.length - 1; i >= 0; i--) {
      const f = room.food[i];
      const dx = f.x - p.x, dy = f.y - p.y;
      if (dx * dx + dy * dy < (HEAD_RADIUS + ITEM_RADIUS) * (HEAD_RADIUS + ITEM_RADIUS)) {
        room.food.splice(i, 1);
        const mult = now < p.multiplierUntil ? 2 : 1;
        p.score = Math.max(0, p.score + FOOD_VALUE * mult);
        p.segments = Math.min(MAX_SEGMENTS, p.segments + 1);
        setTimeout(() => { if (room.status === "playing") spawnFood(room); }, 350 + Math.random() * 900);
      }
    }
    // collisions: magic food (super score — scarce & contested)
    for (let i = room.ssFood.length - 1; i >= 0; i--) {
      const sf = room.ssFood[i];
      const dx = sf.x - p.x, dy = sf.y - p.y;
      if (dx * dx + dy * dy < (HEAD_RADIUS + ITEM_RADIUS) * (HEAD_RADIUS + ITEM_RADIUS)) {
        room.ssFood.splice(i, 1);
        const mult = now < p.multiplierUntil ? 2 : 1;
        p.score = Math.max(0, p.score + SS_FOOD_VALUE * mult);
        p.segments = Math.min(MAX_SEGMENTS, p.segments + 2);
        setTimeout(() => { if (room.status === "playing") spawnSSFood(room); }, 800 + Math.random() * 1600);
      }
    }
    // collisions: poison
    for (let i = room.poison.length - 1; i >= 0; i--) {
      const po = room.poison[i];
      const dx = po.x - p.x, dy = po.y - p.y;
      if (dx * dx + dy * dy < (HEAD_RADIUS + ITEM_RADIUS) * (HEAD_RADIUS + ITEM_RADIUS)) {
        room.poison.splice(i, 1);
        p.score = Math.max(0, p.score + POISON_VALUE);
        p.segments = Math.max(MIN_SEGMENTS, p.segments - 2);
        setTimeout(() => { if (room.status === "playing") spawnPoison(room); }, 500 + Math.random() * 1200);
      }
    }
    // collisions: star
    if (room.star) {
      const dx = room.star.x - p.x, dy = room.star.y - p.y;
      if (dx * dx + dy * dy < (HEAD_RADIUS + ITEM_RADIUS) * (HEAD_RADIUS + ITEM_RADIUS)) {
        room.star = null;
        p.multiplierUntil = now + STAR_DURATION_MS;
      }
    }
  }

  const timeLeft = Math.max(0, room.endsAt - now);
  io.to(room.code).emit("state", {
    t: timeLeft,
    players: [...room.players.values()].map(publicPlayer),
    food: room.food,
    ssFood: room.ssFood,
    poison: room.poison,
    star: room.star,
  });
}

io.on("connection", (socket) => {
  let joinedRoom = null;

  socket.on("join", ({ room, name, color, pattern }) => {
    const code = (room || "MAIN").toString().trim().toUpperCase().slice(0, 12) || "MAIN";
    const r = getRoom(code);

    if (r.players.size >= MAX_PLAYERS_PER_ROOM) {
      socket.emit("joinError", "This room is full.");
      return;
    }

    const safeName = (name || "Player").toString().slice(0, 16).trim() || "Player";
    const player = {
      id: socket.id,
      name: safeName,
      color: /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#39ff88",
      pattern: ["solid", "stripe", "dot", "gradient"].includes(pattern) ? pattern : "solid",
      x: 0, y: 0, angle: 0, targetAngle: 0,
      trail: [], score: 0, segments: MIN_SEGMENTS,
      boosting: false, boostEnergy: BOOST_MAX_ENERGY, multiplierUntil: 0,
    };
    freshPlayerRuntimeState(player);

    r.players.set(socket.id, player);
    if (!r.hostId) r.hostId = socket.id;

    socket.join(code);
    joinedRoom = code;

    socket.emit("joined", { you: player.id, room: code, world: { w: WORLD_W, h: WORLD_H } });
    broadcastLobby(r);

    // if a game is already in progress, drop the new player straight into spectator-ish sync
    if (r.status === "playing") {
      socket.emit("gameStart", { endsAt: r.endsAt, world: { w: WORLD_W, h: WORLD_H } });
    }
  });

  socket.on("startGame", () => {
    if (!joinedRoom) return;
    const r = rooms.get(joinedRoom);
    if (!r || socket.id !== r.hostId) return;
    if (r.status !== "lobby") return;
    startCountdown(r);
  });

  socket.on("playAgain", () => {
    if (!joinedRoom) return;
    const r = rooms.get(joinedRoom);
    if (!r || socket.id !== r.hostId) return;
    if (r.status !== "ended") return;
    r.status = "lobby";
    broadcastLobby(r);
  });

  socket.on("input", ({ angle, boosting }) => {
    if (!joinedRoom) return;
    const r = rooms.get(joinedRoom);
    if (!r) return;
    const p = r.players.get(socket.id);
    if (!p || r.status !== "playing") return;
    if (typeof angle === "number" && !Number.isNaN(angle)) p.targetAngle = angle;
    p.boosting = !!boosting && p.boostEnergy > 5;
  });

  socket.on("updateSkin", ({ color, pattern }) => {
    if (!joinedRoom) return;
    const r = rooms.get(joinedRoom);
    if (!r) return;
    const p = r.players.get(socket.id);
    if (!p) return;
    if (/^#[0-9a-fA-F]{6}$/.test(color)) p.color = color;
    if (["solid", "stripe", "dot", "gradient"].includes(pattern)) p.pattern = pattern;
    broadcastLobby(r);
  });

  socket.on("disconnect", () => {
    if (!joinedRoom) return;
    const r = rooms.get(joinedRoom);
    if (!r) return;
    r.players.delete(socket.id);
    if (r.hostId === socket.id) {
      r.hostId = r.players.size ? r.players.values().next().value.id : null;
    }
    if (r.players.size === 0) {
      if (r.loop) clearInterval(r.loop);
      if (r.countdownTimer) clearInterval(r.countdownTimer);
      rooms.delete(r.code);
      return;
    }
    broadcastLobby(r);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Snake Arena server running on port ${PORT}`);
});
