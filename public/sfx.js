// Snake Arena SFX — everything is synthesized with the Web Audio API,
// so there are zero external audio files to host or license.

const SFX = (() => {
  let ctx = null;
  let masterGain = null;
  let musicGain = null;
  let muted = false;
  let musicTimer = null;
  let musicStep = 0;

  function ensureCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.9;
      masterGain.connect(ctx.destination);

      musicGain = ctx.createGain();
      musicGain.gain.value = 0.16;
      musicGain.connect(masterGain);
    }
    if (ctx.state === "suspended") ctx.resume();
  }

  function tone({ freq, dur = 0.15, type = "square", gain = 0.22, slideTo = null, delay = 0, destination = null }) {
    if (muted) return;
    ensureCtx();
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(destination || masterGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noiseBurst({ dur = 0.18, gain = 0.18, delay = 0 }) {
    if (muted) return;
    ensureCtx();
    const t0 = ctx.currentTime + delay;
    const bufferSize = ctx.sampleRate * dur;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(g);
    g.connect(masterGain);
    src.start(t0);
  }

  const eatFood = () => {
    tone({ freq: 520, slideTo: 900, dur: 0.09, type: "square", gain: 0.18 });
  };

  const eatSSFood = () => {
    [660, 990, 1320].forEach((f, i) =>
      tone({ freq: f, dur: 0.12, type: "triangle", gain: 0.18, delay: i * 0.04 })
    );
  };

  const eatPoison = () => {
    tone({ freq: 280, slideTo: 90, dur: 0.28, type: "sawtooth", gain: 0.2 });
    noiseBurst({ dur: 0.15, gain: 0.08 });
  };

  const starPickup = () => {
    [660, 880, 1100, 1320].forEach((f, i) =>
      tone({ freq: f, dur: 0.14, type: "triangle", gain: 0.16, delay: i * 0.05 })
    );
  };

  const countdownTick = (final) => {
    tone({ freq: final ? 880 : 440, dur: final ? 0.35 : 0.12, type: "square", gain: 0.25 });
  };

  const gameStart = () => {
    tone({ freq: 220, slideTo: 1100, dur: 0.4, type: "sawtooth", gain: 0.2 });
  };

  const boostOn = () => tone({ freq: 300, slideTo: 500, dur: 0.08, type: "triangle", gain: 0.1 });

  const gameOver = () => {
    [523, 659, 784, 1046].forEach((f, i) =>
      tone({ freq: f, dur: 0.28, type: "square", gain: 0.18, delay: i * 0.14 })
    );
  };

  const uiClick = () => tone({ freq: 500, dur: 0.05, type: "square", gain: 0.12 });

  // --- background chiptune loop ---
  const bassLine = [110, 110, 146.83, 110, 130.81, 110, 98, 110];
  const arpPattern = [0, 4, 7, 4, 0, 4, 7, 12];
  const scale = [220, 246.94, 261.63, 293.66, 329.63, 349.23, 392, 440]; // A minor-ish

  function musicStepFn() {
    if (muted) { return; }
    ensureCtx();
    const t = ctx.currentTime;
    // bass pulse
    const bassFreq = bassLine[musicStep % bassLine.length];
    tone({ freq: bassFreq, dur: 0.18, type: "triangle", gain: 0.09, destination: musicGain });
    // arpeggio note
    const idx = arpPattern[musicStep % arpPattern.length] % scale.length;
    tone({ freq: scale[idx], dur: 0.13, type: "square", gain: 0.05, destination: musicGain });
    musicStep++;
  }

  function startMusic() {
    ensureCtx();
    if (musicTimer) return;
    musicStep = 0;
    musicTimer = setInterval(musicStepFn, 165);
  }

  function stopMusic() {
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  }

  function setMuted(v) {
    muted = v;
    if (masterGain) masterGain.gain.value = muted ? 0 : 0.9;
  }

  function isMuted() { return muted; }

  function unlock() { ensureCtx(); }

  return {
    unlock, eatFood, eatSSFood, eatPoison, starPickup, countdownTick, gameStart, gameOver,
    boostOn, uiClick, startMusic, stopMusic, setMuted, isMuted,
  };
})();
