(() => {
  "use strict";

  const STORAGE_CFG = "aim.config.v2";
  const STORAGE_HIST = "aim.history.v1";
  const MAX_HISTORY = 100;

  const defaults = {
    width: 800,
    height: 500,
    soundOk: true,
    soundBad: true,
    radius: 30,
    dispersion: 0,
    oscillate: false,
    speed: 0,
    nonLinear: false,
    mode: "targets",
    modeValue: 20,
  };

  const $ = (id) => document.getElementById(id);

  const screens = {
    config: $("config"),
    game: $("game"),
    results: $("results"),
    history: $("history"),
  };

  const els = {
    width: $("cfg-width"),
    widthRange: $("cfg-width-range"),
    height: $("cfg-height"),
    heightRange: $("cfg-height-range"),
    soundOk: $("cfg-sound-ok"),
    soundBad: $("cfg-sound-bad"),
    radius: $("cfg-radius"),
    radiusRange: $("cfg-radius-range"),
    dispersion: $("cfg-dispersion"),
    dispersionRange: $("cfg-dispersion-range"),
    oscillate: $("cfg-oscillate"),
    speed: $("cfg-speed"),
    speedRange: $("cfg-speed-range"),
    nonLinear: $("cfg-nonlinear"),
    modeRadios: () => document.querySelectorAll('input[name="mode"]'),
    modeValue: $("cfg-mode-value"),
    playBtn: $("play-btn"),
    historyBtn: $("history-btn"),
    backBtn: $("back-btn"),
    saveBtn: $("save-btn"),
    restartBtn: $("restart-btn"),
    backHistoryBtn: $("back-history-btn"),
    clearHistoryBtn: $("clear-history-btn"),
    canvas: $("canvas"),
    historyList: $("history-list"),
    res: {
      avg: $("r-avg"),
      hits: $("r-hits"),
      miss: $("r-miss"),
      min: $("r-min"),
      max: $("r-max"),
      med: $("r-med"),
    },
  };

  const ctx = els.canvas.getContext("2d");

  // ---------- helpers ----------
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const toInt = (v, f) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : f; };
  const randRange = (lo, hi) => lo + Math.random() * (hi - lo);
  const uid = () => (crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2, 10));

  function fmtDate(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  const modeIconId = (m) => m === "time" ? "i-stopwatch" : m === "infinite" ? "i-infinity" : "i-bullseye";

  // ---------- audio ----------
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    }
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }
  function beep(freq, durMs) {
    const ac = ensureAudio();
    if (!ac) return;
    const now = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const dur = durMs / 1000;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.005);
    gain.gain.linearRampToValueAtTime(0.18, now + dur - 0.01);
    gain.gain.linearRampToValueAtTime(0, now + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }
  const beepOk = () => beep(880, 60);
  const beepBad = () => beep(220, 80);

  // ---------- range/number binding ----------
  function paintFill(rangeEl) {
    const lo = Number(rangeEl.min) || 0;
    const hi = Number(rangeEl.max) || 100;
    const v = Number(rangeEl.value);
    const p = hi > lo ? clamp(((v - lo) / (hi - lo)) * 100, 0, 100) : 0;
    rangeEl.style.setProperty("--fill", p + "%");
  }

  function bindRangeNumber(rangeEl, numberEl) {
    function sync(val, src) {
      let n = parseInt(val, 10);
      if (!Number.isFinite(n)) return;
      const rmin = Number(rangeEl.min);
      const rmax = Number(rangeEl.max);
      const nmin = Number(numberEl.min);
      if (Number.isFinite(rmax)) n = Math.min(rmax, n);
      if (Number.isFinite(rmin)) n = Math.max(rmin, n);
      if (Number.isFinite(nmin)) n = Math.max(nmin, n);
      if (src !== "range")  rangeEl.value = n;
      if (src !== "number") numberEl.value = n;
      paintFill(rangeEl);
    }
    rangeEl.addEventListener("input",  () => sync(rangeEl.value, "range"));
    numberEl.addEventListener("input", () => sync(numberEl.value, "number"));
    numberEl.addEventListener("blur",  () => sync(numberEl.value, "number"));
    return { set: (v) => sync(v, "init") };
  }

  const bindings = {};

  // ---------- config persistence ----------
  function loadConfig() {
    let cfg = { ...defaults };
    try {
      const raw = localStorage.getItem(STORAGE_CFG);
      if (raw) cfg = { ...cfg, ...JSON.parse(raw) };
    } catch (_) {}
    return cfg;
  }
  function saveConfig(cfg) {
    try { localStorage.setItem(STORAGE_CFG, JSON.stringify(cfg)); } catch (_) {}
  }

  function applyConfigToUI(cfg) {
    updateScreenLimits();
    bindings.width.set(cfg.width);
    bindings.height.set(cfg.height);
    bindings.radius.set(cfg.radius);
    bindings.dispersion.set(cfg.dispersion);
    bindings.speed.set(cfg.speed);
    els.soundOk.checked = !!cfg.soundOk;
    els.soundBad.checked = !!cfg.soundBad;
    els.oscillate.checked = !!cfg.oscillate;
    els.nonLinear.checked = !!cfg.nonLinear;
    els.modeRadios().forEach((r) => { r.checked = (r.value === cfg.mode); });
    els.modeValue.value = cfg.modeValue;
    updateModeValueState();
  }

  function readConfigFromUI() {
    updateScreenLimits();
    const mode = [...els.modeRadios()].find((r) => r.checked)?.value || "targets";
    return {
      width: clamp(toInt(els.width.value, defaults.width), 100, screen.width),
      height: clamp(toInt(els.height.value, defaults.height), 100, screen.height),
      soundOk: els.soundOk.checked,
      soundBad: els.soundBad.checked,
      radius: Math.max(5, toInt(els.radius.value, defaults.radius)),
      dispersion: Math.max(0, toInt(els.dispersion.value, defaults.dispersion)),
      oscillate: els.oscillate.checked,
      speed: Math.max(0, toInt(els.speed.value, defaults.speed)),
      nonLinear: els.nonLinear.checked,
      mode,
      modeValue: Math.max(1, toInt(els.modeValue.value, defaults.modeValue)),
    };
  }

  function updateModeValueState() {
    const mode = [...els.modeRadios()].find((r) => r.checked)?.value;
    const infinite = (mode === "infinite");
    els.modeValue.disabled = infinite;
    els.modeValue.style.opacity = infinite ? 0.35 : 1;
  }

  function updateScreenLimits() {
    const maxW = Math.max(100, screen.width);
    const maxH = Math.max(100, screen.height);
    els.widthRange.max = maxW;
    els.heightRange.max = maxH;
    els.width.max = maxW;
    els.height.max = maxH;
    paintFill(els.widthRange);
    paintFill(els.heightRange);
  }

  // ---------- history ----------
  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_HIST);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }
  function saveHistory(arr) {
    try { localStorage.setItem(STORAGE_HIST, JSON.stringify(arr)); } catch (_) {}
  }
  function appendHistory(rec) {
    const h = loadHistory();
    h.unshift(rec);
    if (h.length > MAX_HISTORY) h.length = MAX_HISTORY;
    saveHistory(h);
  }
  function deleteHistoryEntry(id) {
    saveHistory(loadHistory().filter((r) => r.id !== id));
  }
  function clearHistory() {
    saveHistory([]);
  }

  function renderHistory() {
    const list = els.historyList;
    list.innerHTML = "";
    const h = loadHistory();
    for (const rec of h) {
      const row = document.createElement("div");
      row.className = "hist-row";
      row.innerHTML = `
        <span class="hist-date">${fmtDate(rec.ts)}</span>
        <div class="hist-stats">
          <span class="hist-mode"><svg class="ic"><use href="#${modeIconId(rec.mode)}"/></svg></span>
          <span class="hist-stat avg"><svg class="ic"><use href="#i-stopwatch"/></svg>${Math.round(rec.avgMs)}</span>
          <span class="hist-stat"><svg class="ic"><use href="#i-bullseye"/></svg>${rec.hits}</span>
          <span class="hist-stat miss"><svg class="ic"><use href="#i-x"/></svg>${rec.misses}</span>
        </div>
        <button class="hist-del" data-id="${rec.id}" aria-label="del">
          <svg class="ic"><use href="#i-trash"/></svg>
        </button>
      `;
      list.appendChild(row);
    }

    list.querySelectorAll(".hist-del").forEach((btn) => {
      let armed = false;
      let tid = null;
      btn.addEventListener("click", () => {
        if (armed) {
          clearTimeout(tid);
          deleteHistoryEntry(btn.dataset.id);
          renderHistory();
        } else {
          armed = true;
          btn.classList.add("armed");
          tid = setTimeout(() => { armed = false; btn.classList.remove("armed"); }, 2500);
        }
      });
    });
  }

  // arm-to-confirm helper for the global "clear all" button
  function makeArmedButton(btn, onConfirm) {
    let armed = false;
    let tid = null;
    btn.addEventListener("click", () => {
      if (armed) {
        clearTimeout(tid);
        btn.classList.remove("armed");
        armed = false;
        onConfirm();
      } else {
        armed = true;
        btn.classList.add("armed");
        tid = setTimeout(() => { armed = false; btn.classList.remove("armed"); }, 2500);
      }
    });
  }

  // ---------- game state ----------
  let cfg = null;
  let target = null;
  let hits = 0, misses = 0;
  let times = [];
  let startTime = 0, endTime = 0;
  let timerId = null;
  let rafId = null;
  let running = false;
  let lastFrame = 0;
  let oscStart = 0;
  let lastResult = null;

  function spawnTarget() {
    let r = cfg.radius + (Math.random() - 0.5) * cfg.dispersion;
    r = Math.max(2, Math.round(r));
    const x = randRange(r, cfg.width - r);
    const y = randRange(r, cfg.height - r);
    setTarget(x, y, r);
  }

  function setTarget(x, y, r) {
    let vx = 0, vy = 0;
    if (cfg.speed > 0) {
      const ang = Math.random() * Math.PI * 2;
      vx = Math.cos(ang) * cfg.speed;
      vy = Math.sin(ang) * cfg.speed;
    }
    target = {
      x, y, r, vx, vy,
      seed: Math.random() * 100,
      spawnedAt: performance.now(),
    };
  }

  function setupCanvas() {
    els.canvas.width = cfg.width;
    els.canvas.height = cfg.height;
    els.canvas.style.width = cfg.width + "px";
    els.canvas.style.height = cfg.height + "px";
  }

  function step(ts) {
    if (!running) return;
    const dt = lastFrame ? (ts - lastFrame) / 1000 : 0;
    lastFrame = ts;

    if (target && cfg.speed > 0) {
      if (cfg.nonLinear) {
        const t = (ts - oscStart) * 0.001 + target.seed;
        const omega = (Math.sin(t * 1.3) + 0.6 * Math.sin(t * 0.7 + 1.7)) * 2.5;
        const a = Math.atan2(target.vy, target.vx) + omega * dt;
        target.vx = Math.cos(a) * cfg.speed;
        target.vy = Math.sin(a) * cfg.speed;
      }
      target.x += target.vx * dt;
      target.y += target.vy * dt;
      const r = target.r;
      if (target.x < r) { target.x = r; target.vx = -target.vx; }
      else if (target.x > cfg.width - r) { target.x = cfg.width - r; target.vx = -target.vx; }
      if (target.y < r) { target.y = r; target.vy = -target.vy; }
      else if (target.y > cfg.height - r) { target.y = cfg.height - r; target.vy = -target.vy; }
    }

    draw(ts);
    rafId = requestAnimationFrame(step);
  }

  function draw(ts) {
    // area background
    ctx.fillStyle = "#0d111c";
    ctx.fillRect(0, 0, cfg.width, cfg.height);
    // subtle border
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(167,139,250,0.35)";
    ctx.strokeRect(0.5, 0.5, cfg.width - 1, cfg.height - 1);

    if (!target) return;

    // target body with soft radial gradient
    const g = ctx.createRadialGradient(target.x, target.y, 0, target.x, target.y, target.r);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.75, "#e5e7eb");
    g.addColorStop(1, "#b8bec9");
    ctx.beginPath();
    ctx.arc(target.x, target.y, target.r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();

    // oscillating inner ring (period 500ms)
    if (cfg.oscillate) {
      const elapsed = ts - oscStart;
      const phase = (elapsed % 500) / 500;
      const pulse = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
      const minR = target.r * 0.25;
      const maxR = target.r * 0.85;
      const ringR = minR + (maxR - minR) * pulse;
      ctx.beginPath();
      ctx.arc(target.x, target.y, ringR, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#fbbf24";
      ctx.stroke();
    }
  }

  // ---------- input ----------
  function onCanvasMouseDown(e) {
    if (!running || !target) return;
    if (e.button !== 0) return;
    const rect = els.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (cfg.width / rect.width);
    const y = (e.clientY - rect.top) * (cfg.height / rect.height);
    if (x < 0 || x > cfg.width || y < 0 || y > cfg.height) return;
    const dx = x - target.x;
    const dy = y - target.y;
    if (dx * dx + dy * dy <= target.r * target.r) {
      const t = performance.now() - target.spawnedAt;
      times.push(t);
      hits++;
      if (cfg.soundOk) beepOk();
      if (cfg.mode === "targets" && hits >= cfg.modeValue) {
        finish();
        return;
      }
      spawnTarget();
    } else {
      misses++;
      if (cfg.soundBad) beepBad();
    }
  }

  function onKeydown(e) {
    if (e.key !== "Escape" && e.keyCode !== 27) return;
    if (running) {
      finish();
    } else if (!screens.results.classList.contains("hidden")) {
      showConfig();
    } else if (!screens.history.classList.contains("hidden")) {
      showConfig();
    }
  }

  // ---------- screens ----------
  function show(name) {
    for (const k of Object.keys(screens)) {
      screens[k].classList.toggle("hidden", k !== name);
    }
  }

  function showConfig() {
    cleanupGame();
    show("config");
    updateScreenLimits();
  }

  function showHistory() {
    renderHistory();
    show("history");
  }

  function start(reuseCfg) {
    if (!reuseCfg) {
      cfg = readConfigFromUI();
      saveConfig(cfg);
    }
    if (!cfg) return;
    hits = 0;
    misses = 0;
    times = [];
    startTime = performance.now();
    endTime = 0;
    oscStart = startTime;
    lastFrame = 0;
    setupCanvas();
    spawnTarget();
    show("game");
    running = true;
    if (cfg.mode === "time") timerId = setTimeout(finish, cfg.modeValue * 1000);
    ensureAudio();
    rafId = requestAnimationFrame(step);
  }

  function restart() {
    if (!cfg) return showConfig();
    cleanupGame();
    start(true);
  }

  function cleanupGame() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    if (timerId) clearTimeout(timerId);
    timerId = null;
    target = null;
  }

  function finish() {
    if (!running) return;
    endTime = performance.now();
    cleanupGame();
    showResults();
  }

  function showResults() {
    const avg = times.length ? (times.reduce((a, b) => a + b, 0) / times.length) : 0;
    const sorted = times.slice().sort((a, b) => a - b);
    const min = sorted[0] ?? 0;
    const max = sorted[sorted.length - 1] ?? 0;
    let med = 0;
    if (sorted.length) {
      const mid = sorted.length >> 1;
      med = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }
    els.res.avg.textContent  = `${avg.toFixed(0)} ms`;
    els.res.hits.textContent = `${hits}`;
    els.res.miss.textContent = `${misses}`;
    els.res.min.textContent  = `${min.toFixed(0)} ms`;
    els.res.max.textContent  = `${max.toFixed(0)} ms`;
    els.res.med.textContent  = `${med.toFixed(0)} ms`;

    lastResult = {
      id: uid(),
      ts: Date.now(),
      mode: cfg.mode,
      modeValue: cfg.modeValue,
      hits, misses,
      avgMs: avg, minMs: min, maxMs: max, medMs: med,
      durationMs: endTime - startTime,
      cfg: {
        width: cfg.width, height: cfg.height,
        radius: cfg.radius, dispersion: cfg.dispersion,
        speed: cfg.speed, oscillate: cfg.oscillate,
        nonLinear: cfg.nonLinear,
      },
    };
    els.saveBtn.classList.remove("saved");

    show("results");
  }

  function onSave() {
    if (!lastResult) return;
    if (els.saveBtn.classList.contains("saved")) return;
    appendHistory(lastResult);
    els.saveBtn.classList.add("saved");
  }

  // ---------- wiring ----------
  function wire() {
    bindings.width      = bindRangeNumber(els.widthRange,      els.width);
    bindings.height     = bindRangeNumber(els.heightRange,     els.height);
    bindings.radius     = bindRangeNumber(els.radiusRange,     els.radius);
    bindings.dispersion = bindRangeNumber(els.dispersionRange, els.dispersion);
    bindings.speed      = bindRangeNumber(els.speedRange,      els.speed);

    els.playBtn.addEventListener("click", () => start());
    els.historyBtn.addEventListener("click", () => showHistory());
    els.backBtn.addEventListener("click", () => showConfig());
    els.backHistoryBtn.addEventListener("click", () => showConfig());
    els.saveBtn.addEventListener("click", onSave);
    els.restartBtn.addEventListener("click", () => restart());
    makeArmedButton(els.clearHistoryBtn, () => { clearHistory(); renderHistory(); });

    els.canvas.addEventListener("mousedown", onCanvasMouseDown);
    document.addEventListener("keydown", onKeydown);
    document.addEventListener("contextmenu", (e) => { if (running) e.preventDefault(); });

    els.modeRadios().forEach((r) => r.addEventListener("change", updateModeValueState));

    window.addEventListener("resize", () => {
      updateScreenLimits();
      // re-clamp numbers if they now exceed the screen
      const maxW = screen.width, maxH = screen.height;
      if (toInt(els.width.value, 0)  > maxW) bindings.width.set(maxW);
      if (toInt(els.height.value, 0) > maxH) bindings.height.set(maxH);
    });
  }

  // ---------- bootstrap ----------
  wire();
  applyConfigToUI(loadConfig());
})();
