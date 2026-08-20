(() => {
  "use strict";

  // ---------- constants ----------
  const COLOR_PRESETS = ["#39ff88", "#ff3d81", "#3ddcff", "#ffd23f", "#b06bff", "#ff7a3d"];
  const PATTERNS = [
    { id: "solid", label: "Solid" },
    { id: "stripe", label: "Stripe" },
    { id: "dot", label: "Dot" },
    { id: "gradient", label: "Gradient" },
  ];

  // ---------- state ----------
  const state = {
    mySocketId: null,
    room: "MAIN",
    hostId: null,
    lobbyStatus: "lobby",
    selectedColor: COLOR_PRESETS[0],
    selectedPattern: "solid",
    world: { w: 1600, h: 900 },
    game: { players: [], food: [], poison: [], star: null, t: 30000 },
    pointer: { x: 800, y: 450 },
    boosting: false,
  };

  const socket = io();

  // ---------- DOM refs ----------
  const screens = {
    lobby: document.getElementById("screen-lobby"),
    game: document.getElementById("screen-game"),
    results: document.getElementById("screen-results"),
  };
  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove("active"));
    screens[name].classList.add("active");
  }

  const nameInput = document.getElementById("nameInput");
  const roomInput = document.getElementById("roomInput");
  const colorSwatchesEl = document.getElementById("colorSwatches");
  const patternOptionsEl = document.getElementById("patternOptions");
  const previewCanvas = document.getElementById("previewCanvas");
  const joinBtn = document.getElementById("joinBtn");
  const joinError = document.getElementById("joinError");
  const roomLabel = document.getElementById("roomLabel");
  const playerCount = document.getElementById("playerCount");
  const rosterList = document.getElementById("rosterList");
  const hostControls = document.getElementById("hostControls");
  const startBtn = document.getElementById("startBtn");
  const waitMsg = document.getElementById("waitMsg");
  const inviteHint = document.getElementById("inviteHint");

  const countdownOverlay = document.getElementById("countdownOverlay");
  const countdownNum = document.getElementById("countdownNum");

  const hudTimer = document.getElementById("hudTimer");
  const hudScore = document.getElementById("hudScore");
  const hudLeaderboard = document.getElementById("hudLeaderboard");
  const muteBtn = document.getElementById("muteBtn");
  const boostFill = document.getElementById("boostFill");
  const gameCanvas = document.getElementById("gameCanvas");
  const gctx = gameCanvas.getContext("2d");

  const podiumEl = document.getElementById("podium");
  const fullLeaderboardEl = document.getElementById("fullLeaderboard");
  const resultsHostControls = document.getElementById("resultsHostControls");
  const playAgainBtn = document.getElementById("playAgainBtn");
  const resultsWaitMsg = document.getElementById("resultsWaitMsg");

  // prefill room from URL (?room=CODE)
  const urlRoom = new URLSearchParams(location.search).get("room");
  if (urlRoom) roomInput.value = urlRoom.toUpperCase();
  inviteHint.textContent = "Share this page's link with ?room=YOURCODE so friends land in the same lobby.";

  // ---------- lobby: color & pattern pickers ----------
  function buildSwatches() {
    colorSwatchesEl.innerHTML = "";
    COLOR_PRESETS.forEach((c) => {
      const el = document.createElement("div");
      el.className = "swatch" + (c === state.selectedColor ? " selected" : "");
      el.style.background = c;
      el.style.color = c;
      el.addEventListener("click", () => {
        state.selectedColor = c;
        buildSwatches();
        drawPreview();
        SFX.uiClick();
      });
      colorSwatchesEl.appendChild(el);
    });
  }

  function buildPatternOptions() {
    patternOptionsEl.innerHTML = "";
    PATTERNS.forEach((p) => {
      const el = document.createElement("div");
      el.className = "pattern-chip" + (p.id === state.selectedPattern ? " selected" : "");
      el.textContent = p.label;
      el.addEventListener("click", () => {
        state.selectedPattern = p.id;
        buildPatternOptions();
        drawPreview();
        SFX.uiClick();
      });
      patternOptionsEl.appendChild(el);
    });
  }

  function drawSnakeSegment(ctx, x, y, r, color, pattern, idx) {
    ctx.beginPath();
    if (pattern === "stripe" && idx % 3 === 0) {
      ctx.fillStyle = "#0b0e1a";
    } else if (pattern === "dot" && idx % 3 === 0) {
      ctx.fillStyle = shadeColor(color, -40);
    } else if (pattern === "gradient") {
      ctx.fillStyle = shadeColor(color, -idx * 2.2);
    } else {
      ctx.fillStyle = color;
    }
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function shadeColor(hex, percent) {
    const num = parseInt(hex.slice(1), 16);
    let r = (num >> 16) + percent;
    let g = ((num >> 8) & 0x00ff) + percent;
    let b = (num & 0x0000ff) + percent;
    r = Math.max(0, Math.min(255, r));
    g = Math.max(0, Math.min(255, g));
    b = Math.max(0, Math.min(255, b));
    return "#" + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
  }

  function drawPreview() {
    const ctx = previewCanvas.getContext("2d");
    ctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    const cy = previewCanvas.height / 2;
    const segCount = 10;
    for (let i = segCount - 1; i >= 0; i--) {
      const x = 30 + i * 20;
      const r = 12 - i * 0.4;
      drawSnakeSegment(ctx, x, cy + Math.sin(i * 0.6) * 4, r, state.selectedColor, state.selectedPattern, i);
    }
    // head
    ctx.beginPath();
    ctx.fillStyle = state.selectedColor;
    ctx.arc(30 + segCount * 20, cy, 13, 0, Math.PI * 2);
    ctx.fill();
    // eyes
    ctx.fillStyle = "#0b0e1a";
    ctx.beginPath();
    ctx.arc(30 + segCount * 20 + 5, cy - 5, 2.4, 0, Math.PI * 2);
    ctx.arc(30 + segCount * 20 + 5, cy + 5, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  buildSwatches();
  buildPatternOptions();
  drawPreview();

  // ---------- join flow ----------
  joinBtn.addEventListener("click", () => {
    SFX.unlock();
    const name = nameInput.value.trim() || "Player" + Math.floor(Math.random() * 999);
    const room = (roomInput.value.trim() || "MAIN").toUpperCase();
    state.room = room;
    joinError.textContent = "";
    socket.emit("join", { room, name, color: state.selectedColor, pattern: state.selectedPattern });
  });

  socket.on("joinError", (msg) => { joinError.textContent = msg; });

  socket.on("joined", ({ you, room, world }) => {
    state.mySocketId = you;
    state.room = room;
    state.world = world;
    roomLabel.textContent = "— " + room;
    history.replaceState(null, "", "?room=" + room);
  });

  socket.on("lobbyUpdate", (payload) => {
    state.hostId = payload.hostId;
    state.lobbyStatus = payload.status;
    playerCount.textContent = `${payload.players.length} / 40`;

    rosterList.innerHTML = "";
    payload.players.forEach((p) => {
      const li = document.createElement("li");
      li.className = "roster-item";
      const dot = document.createElement("span");
      dot.className = "roster-dot";
      dot.style.background = p.color;
      dot.style.color = p.color;
      const name = document.createElement("span");
      name.className = "roster-name";
      name.textContent = p.name + (p.id === state.mySocketId ? " (you)" : "");
      li.appendChild(dot);
      li.appendChild(name);
      if (p.id === payload.hostId) {
        const tag = document.createElement("span");
        tag.className = "host-tag";
        tag.textContent = "HOST";
        li.appendChild(tag);
      }
      rosterList.appendChild(li);
    });

    const amHost = state.mySocketId && payload.hostId === state.mySocketId;
    if (payload.status === "lobby") {
      hostControls.classList.toggle("hidden", !amHost);
      waitMsg.classList.toggle("hidden", amHost);
      if (state.mySocketId) showScreen("lobby");
    }
  });

  startBtn.addEventListener("click", () => {
    SFX.uiClick();
    socket.emit("startGame");
  });

  // ---------- countdown ----------
  socket.on("countdown", (n) => {
    countdownOverlay.classList.remove("hidden");
    countdownNum.textContent = n > 0 ? n : "GO!";
    SFX.countdownTick(n <= 0);
    if (n <= 0) {
      setTimeout(() => countdownOverlay.classList.add("hidden"), 500);
    }
  });

  // ---------- game start ----------
  let roundEndsAt = 0;
  socket.on("gameStart", ({ endsAt, world }) => {
    state.world = world;
    roundEndsAt = endsAt;
    countdownOverlay.classList.add("hidden");
    showScreen("game");
    resizeCanvas();
    SFX.gameStart();
    SFX.startMusic();
    lastFoodCount = null;
    lastPoisonCount = null;
  });

  // ---------- live state ----------
  let lastFoodCount = null;
  let lastPoisonCount = null;
  let lastStarPresent = false;

  socket.on("state", (payload) => {
    // sound cues based on count deltas (cheap, avoids per-item id diffing)
    if (lastFoodCount !== null && payload.food.length < lastFoodCount) SFX.eatFood();
    if (lastPoisonCount !== null && payload.poison.length < lastPoisonCount) SFX.eatPoison();
    if (lastStarPresent && !payload.star) SFX.starPickup();
    lastFoodCount = payload.food.length;
    lastPoisonCount = payload.poison.length;
    lastStarPresent = !!payload.star;

    state.game = payload;
    updateHud();
  });

  socket.on("gameOver", ({ leaderboard }) => {
    SFX.stopMusic();
    SFX.gameOver();
    renderResults(leaderboard);
    showScreen("results");
  });

  playAgainBtn.addEventListener("click", () => {
    SFX.uiClick();
    socket.emit("playAgain");
  });

  socket.on("lobbyUpdate", (payload) => {
    if (payload.status === "lobby" && screens.results.classList.contains("active")) {
      showScreen("lobby");
    }
    const amHost = state.mySocketId && payload.hostId === state.mySocketId;
    if (payload.status === "ended") {
      resultsHostControls.classList.toggle("hidden", !amHost);
      resultsWaitMsg.classList.toggle("hidden", amHost);
    }
  });

  // ---------- results rendering ----------
  function renderResults(leaderboard) {
    const amHost = state.mySocketId && state.hostId === state.mySocketId;
    resultsHostControls.classList.toggle("hidden", !amHost);
    resultsWaitMsg.classList.toggle("hidden", amHost);

    podiumEl.innerHTML = "";
    const top3 = leaderboard.slice(0, 3);
    const order = [1, 0, 2]; // silver, gold, bronze visual order
    order.forEach((i) => {
      const p = top3[i];
      if (!p) return;
      const slot = document.createElement("div");
      slot.className = "podium-slot podium-" + (i + 1);
      const medal = ["🥇", "🥈", "🥉"][i];
      slot.innerHTML = `
        <div class="podium-medal">${medal}</div>
        <div class="podium-avatar" style="background:${p.color}; color:${p.color}">${p.name.slice(0,1).toUpperCase()}</div>
        <div class="podium-name">${escapeHtml(p.name)}</div>
        <div class="podium-score">${p.score}</div>
        <div class="podium-bar" style="background:${p.color}"></div>
      `;
      podiumEl.appendChild(slot);
    });

    fullLeaderboardEl.innerHTML = "";
    leaderboard.forEach((p, i) => {
      const li = document.createElement("li");
      li.className = "lb-row";
      li.innerHTML = `
        <span class="lb-rank">#${i + 1}</span>
        <span class="lb-dot" style="background:${p.color}; color:${p.color}"></span>
        <span class="lb-name">${escapeHtml(p.name)}${p.id === state.mySocketId ? " (you)" : ""}</span>
        <span class="lb-score">${p.score}</span>
      `;
      fullLeaderboardEl.appendChild(li);
    });
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- HUD ----------
  let hudThrottle = 0;
  function updateHud() {
    const timeLeft = Math.max(0, roundEndsAt - Date.now());
    hudTimer.textContent = (state.game.t / 1000).toFixed(1);

    const me = state.game.players.find((p) => p.id === state.mySocketId);
    if (me) {
      hudScore.textContent = me.score;
      boostFill.style.width = me.boostEnergy + "%";
    }

    hudThrottle++;
    if (hudThrottle % 3 === 0) {
      const top5 = [...state.game.players].sort((a, b) => b.score - a.score).slice(0, 5);
      hudLeaderboard.innerHTML = top5
        .map(
          (p, i) => `<span class="hud-lb-item"><span class="hud-lb-dot" style="background:${p.color}"></span>#${i + 1} ${escapeHtml(p.name)} — ${p.score}</span>`
        )
        .join("");
    }
  }

  // ---------- mute ----------
  let muted = false;
  muteBtn.addEventListener("click", () => {
    muted = !muted;
    SFX.setMuted(muted);
    muteBtn.textContent = muted ? "🔇" : "🔊";
  });

  // ---------- canvas sizing ----------
  let canvasScale = 1, offsetX = 0, offsetY = 0;
  function resizeCanvas() {
    const wrap = gameCanvas.parentElement;
    const availW = wrap.clientWidth - 20;
    const availH = wrap.clientHeight - 20;
    const worldRatio = state.world.w / state.world.h;
    let cw = availW, ch = availW / worldRatio;
    if (ch > availH) { ch = availH; cw = availH * worldRatio; }
    const dpr = window.devicePixelRatio || 1;
    gameCanvas.style.width = cw + "px";
    gameCanvas.style.height = ch + "px";
    gameCanvas.width = cw * dpr;
    gameCanvas.height = ch * dpr;
    canvasScale = (cw * dpr) / state.world.w;
    gctx.setTransform(canvasScale, 0, 0, canvasScale, 0, 0);
  }
  window.addEventListener("resize", resizeCanvas);

  // ---------- input ----------
  function updatePointerFromEvent(clientX, clientY) {
    const rect = gameCanvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * state.world.w;
    const y = ((clientY - rect.top) / rect.height) * state.world.h;
    state.pointer.x = x;
    state.pointer.y = y;
  }

  gameCanvas.addEventListener("mousemove", (e) => updatePointerFromEvent(e.clientX, e.clientY));
  gameCanvas.addEventListener("mousedown", () => { state.boosting = true; SFX.boostOn(); });
  window.addEventListener("mouseup", () => { state.boosting = false; });
  gameCanvas.addEventListener(
    "touchmove",
    (e) => { const t = e.touches[0]; if (t) updatePointerFromEvent(t.clientX, t.clientY); e.preventDefault(); },
    { passive: false }
  );
  gameCanvas.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    if (t) updatePointerFromEvent(t.clientX, t.clientY);
    state.boosting = true;
    SFX.boostOn();
  });
  window.addEventListener("touchend", () => { state.boosting = false; });

  setInterval(() => {
    if (!screens.game.classList.contains("active")) return;
    const me = state.game.players.find((p) => p.id === state.mySocketId);
    let angle = 0;
    if (me) angle = Math.atan2(state.pointer.y - me.y, state.pointer.x - me.x);
    socket.emit("input", { angle, boosting: state.boosting });
  }, 66);

  // ---------- render loop ----------
  function drawGrid() {
    gctx.save();
    gctx.strokeStyle = "rgba(255,255,255,0.035)";
    gctx.lineWidth = 1;
    const step = 80;
    for (let x = 0; x <= state.world.w; x += step) {
      gctx.beginPath(); gctx.moveTo(x, 0); gctx.lineTo(x, state.world.h); gctx.stroke();
    }
    for (let y = 0; y <= state.world.h; y += step) {
      gctx.beginPath(); gctx.moveTo(0, y); gctx.lineTo(state.world.w, y); gctx.stroke();
    }
    gctx.restore();
  }

  function drawFood(f) {
    gctx.save();
    gctx.shadowColor = "#ffb23f";
    gctx.shadowBlur = 12;
    gctx.fillStyle = "#ffb23f";
    gctx.beginPath();
    gctx.arc(f.x, f.y, 7, 0, Math.PI * 2);
    gctx.fill();
    gctx.fillStyle = "#3ddc7a";
    gctx.fillRect(f.x - 1.5, f.y - 11, 3, 5);
    gctx.restore();
  }

  function drawPoison(p) {
    gctx.save();
    gctx.shadowColor = "#ff3d81";
    gctx.shadowBlur = 14;
    gctx.fillStyle = "#200b1a";
    gctx.strokeStyle = "#ff3d81";
    gctx.lineWidth = 2;
    gctx.beginPath();
    gctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    gctx.fill();
    gctx.stroke();
    gctx.strokeStyle = "#ff3d81";
    gctx.lineWidth = 1.6;
    gctx.beginPath();
    gctx.moveTo(p.x - 3, p.y - 3); gctx.lineTo(p.x + 3, p.y + 3);
    gctx.moveTo(p.x + 3, p.y - 3); gctx.lineTo(p.x - 3, p.y + 3);
    gctx.stroke();
    gctx.restore();
  }

  let starSpin = 0;
  function drawStar(s) {
    starSpin += 0.05;
    gctx.save();
    gctx.translate(s.x, s.y);
    gctx.rotate(starSpin);
    gctx.shadowColor = "#ffd23f";
    gctx.shadowBlur = 20;
    gctx.fillStyle = "#ffd23f";
    gctx.beginPath();
    const spikes = 5, outer = 12, inner = 5;
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = (Math.PI / spikes) * i;
      gctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    gctx.closePath();
    gctx.fill();
    gctx.restore();
  }

  function drawSnake(p) {
    const isMe = p.id === state.mySocketId;
    const trail = p.trail || [];
    // body
    for (let i = trail.length - 1; i >= 0; i--) {
      const seg = trail[i];
      const t = i / Math.max(1, trail.length - 1);
      const r = Math.max(3, 10 - t * 6);
      gctx.save();
      if (p.pattern === "stripe" && i % 4 < 2) {
        gctx.fillStyle = shadeColor(p.color, -55);
      } else if (p.pattern === "dot" && i % 5 === 0) {
        gctx.fillStyle = "#ffffff";
      } else if (p.pattern === "gradient") {
        gctx.fillStyle = shadeColor(p.color, -t * 70);
      } else {
        gctx.fillStyle = p.color;
      }
      gctx.beginPath();
      gctx.arc(seg.x, seg.y, r, 0, Math.PI * 2);
      gctx.fill();
      gctx.restore();
    }
    // multiplier sparkle
    if (p.multiplied) {
      gctx.save();
      gctx.strokeStyle = "#ffd23f";
      gctx.lineWidth = 2;
      gctx.globalAlpha = 0.7;
      gctx.beginPath();
      gctx.arc(p.x, p.y, 16 + Math.sin(Date.now() / 100) * 2, 0, Math.PI * 2);
      gctx.stroke();
      gctx.restore();
    }
    // head
    gctx.save();
    gctx.shadowColor = p.color;
    gctx.shadowBlur = isMe ? 18 : 8;
    gctx.fillStyle = p.color;
    gctx.beginPath();
    gctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
    gctx.fill();
    if (isMe) {
      gctx.lineWidth = 2;
      gctx.strokeStyle = "#ffffff";
      gctx.globalAlpha = 0.8;
      gctx.stroke();
    }
    gctx.restore();

    // eyes
    const ex = Math.cos(p.angle) * 5, ey = Math.sin(p.angle) * 5;
    const perpX = Math.cos(p.angle + Math.PI / 2) * 4, perpY = Math.sin(p.angle + Math.PI / 2) * 4;
    gctx.fillStyle = "#0b0e1a";
    gctx.beginPath();
    gctx.arc(p.x + ex + perpX, p.y + ey + perpY, 2.4, 0, Math.PI * 2);
    gctx.arc(p.x + ex - perpX, p.y + ey - perpY, 2.4, 0, Math.PI * 2);
    gctx.fill();

    // name label
    gctx.save();
    gctx.font = "600 12px 'Space Grotesk', sans-serif";
    gctx.textAlign = "center";
    gctx.fillStyle = "rgba(234,240,255,0.9)";
    gctx.shadowColor = "#000";
    gctx.shadowBlur = 4;
    gctx.fillText(p.name, p.x, p.y - 20);
    gctx.restore();
  }

  function render() {
    requestAnimationFrame(render);
    if (!screens.game.classList.contains("active")) return;
    gctx.clearRect(0, 0, state.world.w, state.world.h);
    drawGrid();
    state.game.food.forEach(drawFood);
    state.game.poison.forEach(drawPoison);
    if (state.game.star) drawStar(state.game.star);
    // draw others first, me last so my snake renders on top
    const others = state.game.players.filter((p) => p.id !== state.mySocketId);
    others.forEach(drawSnake);
    const me = state.game.players.find((p) => p.id === state.mySocketId);
    if (me) drawSnake(me);
  }
  requestAnimationFrame(render);

  resizeCanvas();
})();
