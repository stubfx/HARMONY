// Chladni — text as standing wave
// Each character → a (m, n) resonant mode on a square plate.
// The composite nodal pattern is the visual signature of the text.

const canvas      = document.getElementById('canvas');
const ctx         = canvas.getContext('2d');
const input       = document.getElementById('text-input');
const btnPlay     = document.getElementById('btn-play');
const btnExport   = document.getElementById('btn-export');
const sliderThr   = document.getElementById('s-threshold');
const vThr        = document.getElementById('v-threshold');
const selDensity  = document.getElementById('s-density');
const inWidth     = document.getElementById('s-width');
const inHeight    = document.getElementById('s-height');
const selUnit     = document.getElementById('s-unit');

let audioCtx    = null;
let currentDots = [];
let updateTimer = null;

// ── Chladni mathematics ──────────────────────────────────────────────────────

// Map a character to a resonant mode (m, n, sym).
// m, n ∈ [1,7] — standing-wave harmonics.
// sym ∈ {+1,−1} — symmetric vs antisymmetric superposition.
function charToMode(c) {
  const code = c.charCodeAt(0);
  const m    = (code % 7) + 1;
  const n    = ((code >>> 3) % 7) + 1;
  const sym  = (m === n) ? 1 : (code % 2 === 0 ? 1 : -1);
  return { m, n, sym };
}

// Collapse text into unique modes; repeated characters strengthen their mode.
function textToModes(text) {
  if (!text) return [];
  const map = new Map();
  for (const c of text.toUpperCase()) {
    const code = c.charCodeAt(0);
    if (code < 32) continue;
    const { m, n, sym } = charToMode(c);
    const key = `${m},${n},${sym}`;
    if (!map.has(key)) map.set(key, { m, n, sym, amp: 0 });
    map.get(key).amp += 1;
  }
  const total = [...map.values()].reduce((s, v) => s + v.amp, 0);
  return [...map.values()].map(v => ({ ...v, amp: v.amp / total }));
}

// Chladni plate function for mode (m, n) at normalised coords (x, y) ∈ [0,1].
// Symmetric:     cos(mπx)·cos(nπy) + cos(nπx)·cos(mπy)
// Antisymmetric: cos(mπx)·cos(nπy) − cos(nπx)·cos(mπy)
// Max absolute value ≈ 2 regardless of text length (amplitudes sum to 1).
function chladniValue(x, y, modes) {
  const π = Math.PI;
  let v = 0;
  for (const { m, n, sym, amp } of modes) {
    v += amp * (
      Math.cos(m * π * x) * Math.cos(n * π * y) +
      sym * Math.cos(n * π * x) * Math.cos(m * π * y)
    );
  }
  return v;
}

// ── Dot generation ───────────────────────────────────────────────────────────

// Sample a grid; keep points near the nodal surface (|Z| < threshold).
// Slight jitter gives the organic, sand-like quality.
function generateDots(modes, size, threshold, step = 3) {
  const dots = [];
  for (let px = 0; px < size; px += step) {
    for (let py = 0; py < size; py += step) {
      const val = chladniValue(px / size, py / size, modes);
      const abs = Math.abs(val);
      if (abs < threshold) {
        dots.push({
          x:         px + (Math.random() - 0.5) * step * 0.75,
          y:         py + (Math.random() - 0.5) * step * 0.75,
          intensity: 1 - abs / threshold,
        });
      }
    }
  }
  return dots;
}

// ── Canvas rendering ─────────────────────────────────────────────────────────

function render(dots) {
  const { width: W, height: H } = canvas;
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, W, H);
  for (const { x, y, intensity } of dots) {
    ctx.fillStyle = `rgba(208,208,208,${(0.30 + intensity * 0.70).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(x, y, 1.1, 0, 6.2832);
    ctx.fill();
  }
}

// ── Audio ────────────────────────────────────────────────────────────────────

// Resonant frequency of mode (m,n) on a square plate: f ∝ √(m²+n²).
// Base tuned to 82 Hz so the chord sits in a low, ambient register.
function playAudio(modes) {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const now = audioCtx.currentTime;

  const master = audioCtx.createGain();
  master.gain.value = 0.32;
  master.connect(audioCtx.destination);

  for (const { m, n, amp } of modes) {
    const freq = 82 * Math.sqrt(m * m + n * n);
    const osc  = audioCtx.createOscillator();
    const env  = audioCtx.createGain();
    osc.type           = 'sine';
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0,              now);
    env.gain.linearRampToValueAtTime(amp * 0.45, now + 0.10);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 5.0);
    osc.connect(env);
    env.connect(master);
    osc.start(now);
    osc.stop(now + 5.5);
  }
}

// ── SVG export ───────────────────────────────────────────────────────────────

// mm equivalent of each unit — used to compute an adaptive dot radius so
// points appear at a consistent physical size regardless of canvas dimensions.
const TO_MM = { mm: 1, cm: 10, pt: 0.3528, in: 25.4 };

function exportSVG(modes, threshold) {
  const step     = parseInt(selDensity.value);
  const width    = parseFloat(inWidth.value)  || 80;
  const height   = parseFloat(inHeight.value) || 80;
  const unit     = selUnit.value;
  const viewSize = 800; // internal viewBox resolution

  // Dot radius scaled so each dot is ≈ 0.2 mm on the printed page.
  const sizeMm = Math.max(width, height) * (TO_MM[unit] ?? 1);
  const r      = Math.max(0.4, Math.min(4, 160 / sizeMm)).toFixed(2);

  // Regenerate at export density (independent from canvas preview density).
  const dots  = generateDots(modes, viewSize, threshold, step);
  const lines = dots.map(({ x, y }) =>
    `  <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="#3d3d3d"/>`
  );

  const svg = [
    `<svg width="${width}${unit}" height="${height}${unit}" viewBox="0 0 ${viewSize} ${viewSize}" xmlns="http://www.w3.org/2000/svg">`,
    ...lines,
    '</svg>',
  ].join('\n');

  const slug = (input.value.trim() || 'chladni').toLowerCase().replace(/\s+/g, '-');
  const a    = Object.assign(document.createElement('a'), {
    href:     URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })),
    download: `chladni-${slug}.svg`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Update & resize ──────────────────────────────────────────────────────────

function update() {
  const text      = input.value.trim();
  const size      = canvas.width;
  const threshold = parseFloat(sliderThr.value);

  if (!text) {
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, size, size);
    currentDots = [];
    return;
  }

  const modes = textToModes(text);
  currentDots = generateDots(modes, size, threshold);
  render(currentDots);
}

function scheduleUpdate() {
  clearTimeout(updateTimer);
  updateTimer = setTimeout(update, 60);
}

function resize() {
  // Leave ~160px for the bottom UI bar.
  const s = Math.min(window.innerWidth, window.innerHeight - 160, 680);
  canvas.width = canvas.height = Math.max(s, 280);
  update();
}

// ── Events ───────────────────────────────────────────────────────────────────

input.addEventListener('input', scheduleUpdate);

sliderThr.addEventListener('input', () => {
  vThr.textContent = parseFloat(sliderThr.value).toFixed(2);
  scheduleUpdate();
});

btnPlay.addEventListener('click', () => {
  const modes = textToModes(input.value.trim());
  if (modes.length) playAudio(modes);
});

btnExport.addEventListener('click', () => {
  const text = input.value.trim();
  if (!text) return;
  const modes     = textToModes(text);
  const threshold = parseFloat(sliderThr.value);
  exportSVG(modes, threshold);
});

window.addEventListener('resize', resize);

// ── Init ─────────────────────────────────────────────────────────────────────

input.value = 'HARMONY';
resize();
