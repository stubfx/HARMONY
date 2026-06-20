// Audio waveform visualizer — pixel grid (black squares on white)

let CELL = 8; // px per cell — controlled by density slider

const canvas = document.getElementById('grid');
const ctx    = canvas.getContext('2d');
let W = 0, H = 0;

// ── Audio state ───────────────────────────────────────────────────────────────
let audioCtx    = null;
let audioBuffer = null;
let peaks       = null;  // Float32Array[W]: normalized peak amplitude per column
let sourceNode  = null;
let startTime   = 0;
let startOffset = 0;
let isPlaying   = false;

// ── Geometry ──────────────────────────────────────────────────────────────────
function setSize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  W = Math.floor(canvas.width  / CELL);
  H = Math.floor(canvas.height / CELL);
}

// ── Audio loading ─────────────────────────────────────────────────────────────
function ensureCtx() {
  if (!audioCtx) audioCtx = new AudioContext();
}

async function loadFile(file) {
  ensureCtx();
  if (isPlaying) stopPlayback();
  startOffset = 0;

  const buf   = await file.arrayBuffer();
  audioBuffer = await audioCtx.decodeAudioData(buf);

  document.getElementById('file-name').textContent = file.name;
  document.getElementById('btn-play').disabled = false;

  computePeaks();
}

// Mix channels to mono and compute peak amplitude per grid column.
function computePeaks() {
  if (!audioBuffer) return;

  const nCh  = audioBuffer.numberOfChannels;
  const len  = audioBuffer.length;

  // Mix to mono
  const mono = new Float32Array(len);
  for (let ch = 0; ch < nCh; ch++) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < len; i++) mono[i] += data[i] / nCh;
  }

  // Peak per column
  const raw = new Float32Array(W);
  for (let c = 0; c < W; c++) {
    const s0 = Math.floor(c       / W * len);
    const s1 = Math.floor((c + 1) / W * len);
    let pk = 0;
    for (let i = s0; i < s1; i++) {
      const a = Math.abs(mono[i]);
      if (a > pk) pk = a;
    }
    raw[c] = pk;
  }

  // Normalize so loudest column fills full half-height
  let maxPk = 0;
  for (let c = 0; c < W; c++) if (raw[c] > maxPk) maxPk = raw[c];
  if (maxPk === 0) maxPk = 1;

  peaks = new Float32Array(W);
  for (let c = 0; c < W; c++) peaks[c] = raw[c] / maxPk;
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
  startTime  = audioCtx.currentTime - offset;
  isPlaying  = true;
  sourceNode.onended = () => {
    isPlaying   = false;
    startOffset = 0;
    syncPlayBtn();
  };
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

  // Grid lines
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.lineWidth   = 0.5;
  for (let c = 0; c <= W; c++) { ctx.moveTo(c*CELL, 0);       ctx.lineTo(c*CELL, H*CELL); }
  for (let r = 0; r <= H; r++) { ctx.moveTo(0,      r*CELL);  ctx.lineTo(W*CELL, r*CELL); }
  ctx.stroke();

  if (!peaks) return;

  // Waveform: filled bars from vertical center ± peak amplitude
  ctx.fillStyle = '#111';
  const center = H / 2;
  for (let c = 0; c < W; c++) {
    const half = peaks[c] * center;
    const rTop = Math.max(0,     Math.floor(center - half));
    const rBot = Math.min(H - 1, Math.ceil (center + half));
    for (let r = rTop; r <= rBot; r++) {
      ctx.fillRect(c * CELL + 1, r * CELL + 1, CELL - 1, CELL - 1);
    }
  }

  // Playhead — thin vertical line at current position
  if (audioBuffer) {
    const elapsed  = isPlaying
      ? audioCtx.currentTime - startTime
      : startOffset;
    if (elapsed > 0) {
      const progress = Math.min(1, elapsed / audioBuffer.duration);
      const px = Math.round(progress * W) * CELL;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(px, 0, Math.max(1, CELL * 0.25), canvas.height);
    }
  }
}

// ── Loop ─────────────────────────────────────────────────────────────────────
function loop() {
  requestAnimationFrame(loop);
  render();
}

// ── Toolbar ───────────────────────────────────────────────────────────────────
function setupToolbar() {
  document.getElementById('file-input').addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) loadFile(f);
  });

  const slider  = document.getElementById('density');
  const valSpan = document.getElementById('density-val');
  slider.addEventListener('input', () => {
    CELL = +slider.value;
    valSpan.textContent = CELL + 'px';
    setSize();
    computePeaks();
  });

  document.getElementById('btn-play').addEventListener('click', () => {
    isPlaying ? stopPlayback() : startPlayback();
  });
}

// ── Boot ─────────────────────────────────────────────────────────────────────
setSize();
setupToolbar();
window.addEventListener('resize', () => { setSize(); computePeaks(); });
loop();
