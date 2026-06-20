// Audio waveform visualizer — pixel grid (black squares on white)

// ── Parameters ────────────────────────────────────────────────────────────────
let CELL       = 8;   // px per cell
let ampVal     = 1.0; // vertical scale multiplier
let fadeVal    = 0.0; // edge fade exponent (0 = flat black, >0 = fade to transparent)
let smoothVal  = 0;   // moving-average half-window in columns
let jitterVal  = 0;   // max vertical jitter in cells

// ── Canvas ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('grid');
const ctx    = canvas.getContext('2d');
let W = 0, H = 0;

function setSize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  W = Math.floor(canvas.width  / CELL);
  H = Math.floor(canvas.height / CELL);
}

// ── Audio state ───────────────────────────────────────────────────────────────
let audioCtx    = null;
let audioBuffer = null;
let rawPeaks    = null; // Float32Array[W]: normalised peak per column (source of truth)
let sourceNode  = null;
let startTime   = 0;
let startOffset = 0;
let isPlaying   = false;

function ensureCtx() {
  if (!audioCtx) audioCtx = new AudioContext();
}

// ── Load from file ────────────────────────────────────────────────────────────
async function loadFile(file) {
  ensureCtx();
  if (isPlaying) stopPlayback();
  startOffset = 0;
  const buf   = await file.arrayBuffer();
  audioBuffer = await audioCtx.decodeAudioData(buf);
  document.getElementById('file-name').textContent = file.name;
  document.getElementById('btn-play').disabled = false;
  computeRawPeaks();
}

// ── Generate sine wave ────────────────────────────────────────────────────────
// Creates a 4-second buffer mixing 2–4 random sine components.
function generateSine() {
  ensureCtx();
  if (isPlaying) stopPlayback();
  startOffset = 0;

  const sr  = audioCtx.sampleRate;
  const dur = 4; // seconds
  const len = sr * dur;
  audioBuffer = audioCtx.createBuffer(1, len, sr);
  const data  = audioBuffer.getChannelData(0);

  // Pick 2–4 random harmonics
  const nComponents = 2 + Math.floor(Math.random() * 3);
  const components  = Array.from({ length: nComponents }, () => ({
    freq: 80 + Math.random() * 800,
    amp:  0.3 + Math.random() * 0.7,
    phase: Math.random() * Math.PI * 2,
  }));
  const totalAmp = components.reduce((s, c) => s + c.amp, 0);

  for (let i = 0; i < len; i++) {
    let v = 0;
    const t = i / sr;
    for (const c of components) v += c.amp * Math.sin(2 * Math.PI * c.freq * t + c.phase);
    data[i] = v / totalAmp;
  }

  document.getElementById('file-name').textContent = `sine ×${nComponents}`;
  document.getElementById('btn-play').disabled = false;
  computeRawPeaks();
}

// ── Peak computation ──────────────────────────────────────────────────────────
function computeRawPeaks() {
  if (!audioBuffer) return;
  const nCh  = audioBuffer.numberOfChannels;
  const len  = audioBuffer.length;

  // Mix to mono
  const mono = new Float32Array(len);
  for (let ch = 0; ch < nCh; ch++) {
    const d = audioBuffer.getChannelData(ch);
    for (let i = 0; i < len; i++) mono[i] += d[i] / nCh;
  }

  // Peak per column
  rawPeaks = new Float32Array(W);
  for (let c = 0; c < W; c++) {
    const s0 = Math.floor(c       / W * len);
    const s1 = Math.floor((c + 1) / W * len);
    let pk = 0;
    for (let i = s0; i < s1; i++) { const a = Math.abs(mono[i]); if (a > pk) pk = a; }
    rawPeaks[c] = pk;
  }

  // Normalize
  let mx = 0;
  for (let c = 0; c < W; c++) if (rawPeaks[c] > mx) mx = rawPeaks[c];
  if (mx > 0) for (let c = 0; c < W; c++) rawPeaks[c] /= mx;
}

// Apply box-filter smoothing (half-window = smoothVal columns).
function applySmooth(src) {
  if (smoothVal === 0) return src;
  const out = new Float32Array(src.length);
  for (let c = 0; c < src.length; c++) {
    let sum = 0, n = 0;
    for (let k = -smoothVal; k <= smoothVal; k++) {
      const i = c + k;
      if (i >= 0 && i < src.length) { sum += src[i]; n++; }
    }
    out[c] = sum / n;
  }
  return out;
}

// Deterministic per-column jitter value in [-1, 1] (sin-hash, stable every frame).
function jitterAt(c) {
  const v = Math.sin(c * 127.1 + 311.7) * 43758.5453;
  return (v - Math.floor(v)) * 2 - 1;
}

// ── Playback ──────────────────────────────────────────────────────────────────
function startPlayback() {
  if (!audioBuffer || isPlaying) return;
  ensureCtx();
  const offset = startOffset % audioBuffer.duration;
  sourceNode   = audioCtx.createBufferSource();
  sourceNode.buffer = audioBuffer;
  sourceNode.connect(audioCtx.destination);
  sourceNode.start(0, offset);
  startTime = audioCtx.currentTime - offset;
  isPlaying = true;
  sourceNode.onended = () => { isPlaying = false; startOffset = 0; syncPlayBtn(); };
  syncPlayBtn();
}

function stopPlayback() {
  if (!isPlaying) return;
  sourceNode?.stop();
  startOffset = audioCtx.currentTime - startTime;
  isPlaying   = false;
  syncPlayBtn();
}

function syncPlayBtn() {
  const btn = document.getElementById('btn-play');
  btn.textContent = isPlaying ? 'pause' : 'play';
  btn.classList.toggle('active', isPlaying);
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!rawPeaks || rawPeaks.length !== W) return;

  // Pipeline: smooth → amp → jitter (applied per column at render time)
  const smoothed = applySmooth(rawPeaks);
  const centerBase = H / 2;

  for (let c = 0; c < W; c++) {
    const half   = smoothed[c] * centerBase * ampVal;        // half-bar height in cells
    const center = centerBase + jitterAt(c) * jitterVal;     // shifted centre

    const rTop = Math.max(0,     Math.floor(center - half));
    const rBot = Math.min(H - 1, Math.ceil (center + half));

    for (let r = rTop; r <= rBot; r++) {
      // Normalised distance from bar centre [0 = centre, 1 = edge]
      const dist  = half > 0.001 ? Math.abs(r - center) / half : 0;
      const alpha = Math.pow(Math.max(0, 1 - dist), fadeVal === 0 ? 0 : fadeVal);
      if (alpha < 0.01) continue;

      if (fadeVal === 0) {
        ctx.fillStyle = '#111';
      } else {
        ctx.fillStyle = `rgba(17,17,17,${alpha.toFixed(2)})`;
      }
      ctx.fillRect(c * CELL + 1, r * CELL + 1, CELL - 1, CELL - 1);
    }
  }

  // Playhead
  if (audioBuffer && isPlaying) {
    const progress = Math.min(1, (audioCtx.currentTime - startTime) / audioBuffer.duration);
    const px = Math.round(progress * W) * CELL;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(px, 0, Math.max(1, CELL * 0.3), canvas.height);
  }
}

// ── Loop ─────────────────────────────────────────────────────────────────────
function loop() {
  requestAnimationFrame(loop);
  render();
}

// ── Toolbar wiring ────────────────────────────────────────────────────────────
function slider(id, valId, onchange) {
  const el  = document.getElementById(id);
  const val = document.getElementById(valId);
  const update = () => { onchange(+el.value); val.textContent = (+el.value).toFixed(el.step && +el.step < 1 ? 1 : 0) + (el.dataset.unit || ''); };
  el.addEventListener('input', update);
  update(); // set initial display
}

function setupToolbar() {
  document.getElementById('file-input').addEventListener('change', e => {
    const f = e.target.files[0]; if (f) loadFile(f);
  });

  document.getElementById('btn-sine').addEventListener('click', generateSine);

  document.getElementById('btn-play').addEventListener('click', () => {
    isPlaying ? stopPlayback() : startPlayback();
  });

  // Density changes grid dimensions → recompute peaks
  const densEl  = document.getElementById('s-density');
  const densVal = document.getElementById('v-density');
  densEl.addEventListener('input', () => {
    CELL = +densEl.value;
    densVal.textContent = CELL + 'px';
    setSize();
    computeRawPeaks();
  });
  densVal.textContent = CELL + 'px';

  document.getElementById('s-amp').addEventListener('input', e => {
    ampVal = +e.target.value;
    document.getElementById('v-amp').textContent = ampVal.toFixed(1);
  });

  document.getElementById('s-fade').addEventListener('input', e => {
    fadeVal = +e.target.value;
    document.getElementById('v-fade').textContent = fadeVal.toFixed(1);
  });

  document.getElementById('s-smooth').addEventListener('input', e => {
    smoothVal = +e.target.value;
    document.getElementById('v-smooth').textContent = smoothVal;
  });

  document.getElementById('s-jitter').addEventListener('input', e => {
    jitterVal = +e.target.value;
    document.getElementById('v-jitter').textContent = (+e.target.value).toFixed(2);
  });
}

// ── Boot ─────────────────────────────────────────────────────────────────────
setSize();
setupToolbar();
window.addEventListener('resize', () => { setSize(); computeRawPeaks(); });
loop();
