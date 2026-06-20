// Audio waveform visualizer — pixel grid, CMYK export

// ── Parameters ────────────────────────────────────────────────────────────────
let CELL       = 5;
let ampVal     = 1.0;
let fadeVal    = 4.0;
let smoothVal  = 2;
let jitterVal  = 0;

// ── Canvas ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('grid');
const ctx    = canvas.getContext('2d');
let W = 0, H = 0;

function setSize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  W = Math.floor(canvas.width  / CELL);
  H = Math.floor(canvas.height / CELL);
  rebuildMaskGrid();
}

// ── ICC profile state ─────────────────────────────────────────────────────────
let iccData = null; // Uint8Array of the loaded .icc file

function setICC(bytes, label) {
  iccData = bytes;
  document.getElementById('icc-name').textContent = label;
  document.getElementById('btn-clear-icc').hidden = false;
}

async function loadICC(file) {
  setICC(new Uint8Array(await file.arrayBuffer()), file.name);
}

async function fetchFOGRA39() {
  try {
    const res = await fetch('/fogra39.icc');
    if (!res.ok) throw new Error();
    setICC(new Uint8Array(await res.arrayBuffer()), 'ISOcoated_v2 (FOGRA39)');
  } catch {
    alert('Scarica ISOcoated_v2_eci.icc da eci.org e salvalo in public/fogra39.icc');
  }
}

function clearICC() {
  iccData = null;
  document.getElementById('icc-name').textContent = '—';
  document.getElementById('btn-clear-icc').hidden = true;
}

// ── Mask state ────────────────────────────────────────────────────────────────
let maskBitmap = null;  // raw ImageBitmap from loaded file
let maskGrid   = null;  // Float32Array W×H, 0=hide 1=reveal (grayscale luminance)

async function loadMask(file) {
  maskBitmap = await createImageBitmap(file);
  rebuildMaskGrid();
  document.getElementById('mask-name').textContent = file.name;
  document.getElementById('btn-clear-mask').hidden = false;
}

function clearMask() {
  maskBitmap = null;
  maskGrid   = null;
  document.getElementById('mask-name').textContent = '—';
  document.getElementById('btn-clear-mask').hidden = true;
}

function rebuildMaskGrid() {
  if (!maskBitmap || W === 0 || H === 0) return;
  const oc   = new OffscreenCanvas(canvas.width, canvas.height);
  const octx = oc.getContext('2d');
  // Stretch mask to fill canvas exactly
  octx.drawImage(maskBitmap, 0, 0, canvas.width, canvas.height);
  const px = octx.getImageData(0, 0, canvas.width, canvas.height).data;

  maskGrid = new Float32Array(W * H);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      let sum = 0, n = 0;
      const x0 = c * CELL, x1 = Math.min(x0 + CELL, canvas.width);
      const y0 = r * CELL, y1 = Math.min(y0 + CELL, canvas.height);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * canvas.width + x) * 4;
          // Rec.709 luminance → grayscale
          sum += (0.2126 * px[i] + 0.7152 * px[i+1] + 0.0722 * px[i+2]) / 255;
          n++;
        }
      }
      maskGrid[r * W + c] = n > 0 ? sum / n : 1;
    }
  }
}

// ── Audio state ───────────────────────────────────────────────────────────────
let audioCtx       = null;
let audioBuffer    = null;
let rawPeaks       = null;
let sourceNode     = null;
let startTime      = 0;
let startOffset    = 0;
let isPlaying      = false;
let currentName    = '';

function ensureCtx() {
  if (!audioCtx) audioCtx = new AudioContext();
}

// ── Load file ─────────────────────────────────────────────────────────────────
async function loadFile(file) {
  ensureCtx();
  if (isPlaying) stopPlayback();
  startOffset = 0;
  currentName = file.name.replace(/\.[^.]+$/, '');
  audioBuffer = await audioCtx.decodeAudioData(await file.arrayBuffer());
  document.getElementById('file-name').textContent = file.name;
  document.getElementById('btn-play').disabled = false;
  computeRawPeaks();
}

// ── Sine wave generator ───────────────────────────────────────────────────────
function generateSine() {
  ensureCtx();
  if (isPlaying) stopPlayback();
  startOffset = 0;
  const sr  = audioCtx.sampleRate;
  const len = sr * 4;
  audioBuffer = audioCtx.createBuffer(1, len, sr);
  const data  = audioBuffer.getChannelData(0);
  const n     = 2 + Math.floor(Math.random() * 3);
  const comps = Array.from({ length: n }, () => ({
    f: 80 + Math.random() * 800,
    a: 0.3 + Math.random() * 0.7,
    p: Math.random() * Math.PI * 2,
  }));
  const tot = comps.reduce((s, c) => s + c.a, 0);
  for (let i = 0; i < len; i++) {
    let v = 0, t = i / sr;
    for (const c of comps) v += c.a * Math.sin(2 * Math.PI * c.f * t + c.p);
    data[i] = v / tot;
  }
  currentName = `sine_x${n}`;
  document.getElementById('file-name').textContent = `sine ×${n}`;
  document.getElementById('btn-play').disabled = false;
  computeRawPeaks();
}

// ── Peak computation ──────────────────────────────────────────────────────────
function computeRawPeaks() {
  if (!audioBuffer || W === 0) return;
  const nCh = audioBuffer.numberOfChannels;
  const len  = audioBuffer.length;
  const mono = new Float32Array(len);
  for (let ch = 0; ch < nCh; ch++) {
    const d = audioBuffer.getChannelData(ch);
    for (let i = 0; i < len; i++) mono[i] += d[i] / nCh;
  }
  rawPeaks = new Float32Array(W);
  for (let c = 0; c < W; c++) {
    const s0 = Math.floor(c / W * len), s1 = Math.floor((c + 1) / W * len);
    let pk = 0;
    for (let i = s0; i < s1; i++) { const a = Math.abs(mono[i]); if (a > pk) pk = a; }
    rawPeaks[c] = pk;
  }
  let mx = 0;
  for (let c = 0; c < W; c++) if (rawPeaks[c] > mx) mx = rawPeaks[c];
  if (mx > 0) for (let c = 0; c < W; c++) rawPeaks[c] /= mx;
}

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

// Deterministic per-column jitter in [-1, 1]
function jitterAt(c) {
  const v = Math.sin(c * 127.1 + 311.7) * 43758.5453;
  return (v - Math.floor(v)) * 2 - 1;
}

// ── Playback ──────────────────────────────────────────────────────────────────
function startPlayback() {
  if (!audioBuffer || isPlaying) return;
  ensureCtx();
  const off = startOffset % audioBuffer.duration;
  sourceNode = audioCtx.createBufferSource();
  sourceNode.buffer = audioBuffer;
  sourceNode.connect(audioCtx.destination);
  sourceNode.start(0, off);
  startTime = audioCtx.currentTime - off;
  isPlaying = true;
  sourceNode.onended = () => { isPlaying = false; startOffset = 0; syncPlayBtn(); };
  syncPlayBtn();
}

function stopPlayback() {
  if (!isPlaying) return;
  sourceNode?.stop();
  startOffset = audioCtx.currentTime - startTime;
  isPlaying = false;
  syncPlayBtn();
}

function syncPlayBtn() {
  const b = document.getElementById('btn-play');
  b.textContent = isPlaying ? 'pause' : 'play';
  b.classList.toggle('active', isPlaying);
}

// ── CMYK TIFF export ──────────────────────────────────────────────────────────
//
// Without ICC (14 entries):
//   0     header           8 bytes
//   8     IFD              2 + 14×12 + 4 = 174 bytes  → ends at 182
//   182   BitsPerSample    8 bytes  → ends at 190
//   190   XResolution      8 bytes  → ends at 198
//   198   YResolution      8 bytes  → ends at 206
//   206   image data
//
// With ICC profile (15 entries):
//   0     header           8 bytes
//   8     IFD              2 + 15×12 + 4 = 186 bytes  → ends at 194
//   194   BitsPerSample    8 bytes  → ends at 202
//   202   XResolution      8 bytes  → ends at 210
//   210   YResolution      8 bytes  → ends at 218
//   218   ICC profile      icc.length bytes
//   218+N image data
//
function buildTIFF(w, h, cmykData, icc) {
  const hasICC  = icc && icc.length > 0;
  const nEnt    = hasICC ? 15 : 14;
  const bpsOff  = 8 + 2 + nEnt * 12 + 4;
  const xResOff = bpsOff + 8;
  const yResOff = xResOff + 8;
  const iccOff  = yResOff + 8;
  const imgOff  = hasICC ? iccOff + icc.length : iccOff;
  const imgSz   = w * h * 4;
  const buf     = new ArrayBuffer(imgOff + imgSz);
  const dv      = new DataView(buf);
  let p = 0;

  const u8  = v => dv.setUint8(p++, v);
  const u16 = v => { dv.setUint16(p, v, true); p += 2; };
  const u32 = v => { dv.setUint32(p, v, true); p += 4; };
  const ent = (tag, type, count, val) => { u16(tag); u16(type); u32(count); u32(val); };

  // Header
  u8(0x49); u8(0x49); u16(42); u32(8);

  // IFD — tags in ascending order
  u16(nEnt);
  ent(256, 4, 1, w);                          // ImageWidth
  ent(257, 4, 1, h);                          // ImageLength
  ent(258, 3, 4, bpsOff);                     // BitsPerSample → offset [8,8,8,8]
  ent(259, 3, 1, 1);                          // Compression: none
  ent(262, 3, 1, 5);                          // PhotometricInterpretation: CMYK
  ent(273, 4, 1, imgOff);                     // StripOffsets
  ent(277, 3, 1, 4);                          // SamplesPerPixel
  ent(278, 4, 1, h);                          // RowsPerStrip
  ent(279, 4, 1, imgSz);                      // StripByteCounts
  ent(282, 5, 1, xResOff);                    // XResolution → 300/1
  ent(283, 5, 1, yResOff);                    // YResolution → 300/1
  ent(284, 3, 1, 1);                          // PlanarConfiguration: chunky
  ent(296, 3, 1, 2);                          // ResolutionUnit: inch
  ent(332, 3, 1, 1);                          // InkSet: CMYK
  if (hasICC) ent(34675, 1, icc.length, iccOff); // ICCProfile
  u32(0);                                     // next IFD = none

  // BitsPerSample [8, 8, 8, 8]
  p = bpsOff; u16(8); u16(8); u16(8); u16(8);

  // XResolution / YResolution: 300/1
  p = xResOff; u32(300); u32(1);
  p = yResOff; u32(300); u32(1);

  // ICC profile bytes (if present)
  if (hasICC) new Uint8Array(buf, iccOff, icc.length).set(icc);

  // Image data
  new Uint8Array(buf, imgOff).set(cmykData);
  return buf;
}

function exportCMYK() {
  const defName = currentName || 'waveform';
  const name    = prompt('Export filename (without extension):', defName);
  if (name === null) return;

  // Re-render at 300 DPI by scaling cells up (screen assumed ~96 DPI)
  const scale   = 300 / 96;
  const cellSz  = Math.max(2, Math.round(CELL * scale)); // scaled cell size
  const ew      = W * cellSz;  // export canvas width  (exact grid multiple)
  const eh      = H * cellSz;  // export canvas height

  const oc   = new OffscreenCanvas(ew, eh);
  const octx = oc.getContext('2d');
  drawWaveform(octx, W, H, cellSz);

  const px = octx.getImageData(0, 0, ew, eh).data;

  // Find darkest pixel to anchor 100% K
  let minR = 255;
  for (let i = 0; i < px.length; i += 4) if (px[i] < minR) minR = px[i];
  const maxK = (255 - minR) / 255;

  const cmyk = new Uint8Array(ew * eh * 4); // zero = (0,0,0,0) = white
  if (maxK > 0.001) {
    for (let i = 0; i < ew * eh; i++) {
      const kRaw = (255 - px[i * 4]) / 255;
      if (kRaw < 0.01) continue;
      const kPct  = Math.max(5, Math.round((kRaw / maxK) * 100 / 5) * 5);
      cmyk[i * 4 + 3] = Math.round(kPct / 100 * 255);
    }
  }

  const buf  = buildTIFF(ew, eh, cmyk, iccData);
  const blob = new Blob([buf], { type: 'image/tiff' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url,
    download: (name || defName).replace(/\.tiff?$/i, '') + '.tiff',
  });
  a.click();
  URL.revokeObjectURL(url);
}

// ── Render core — works on any context at any cell size ───────────────────────
function drawWaveform(rctx, rW, rH, cellSz) {
  rctx.fillStyle = '#fff';
  rctx.fillRect(0, 0, rW * cellSz, rH * cellSz);
  if (!rawPeaks || rawPeaks.length < rW) return;

  const smoothed = applySmooth(rawPeaks);
  const cb = rH / 2;

  for (let c = 0; c < rW; c++) {
    const half   = smoothed[c] * cb * ampVal;
    const center = cb + jitterAt(c) * jitterVal;
    const rTop   = Math.max(0,      Math.floor(center - half));
    const rBot   = Math.min(rH - 1, Math.ceil (center + half));

    for (let r = rTop; r <= rBot; r++) {
      const dist  = half > 0.001 ? Math.abs(r - center) / half : 0;
      const wave  = fadeVal === 0 ? 1 : Math.pow(Math.max(0, 1 - dist), fadeVal);
      const mask  = maskGrid ? maskGrid[r * W + c] : 1;
      const alpha = wave * mask;
      if (alpha < 0.01) continue;
      rctx.fillStyle = alpha >= 0.995 ? '#000' : `rgba(0,0,0,${alpha.toFixed(3)})`;
      rctx.fillRect(c * cellSz + 1, r * cellSz + 1, cellSz - 1, cellSz - 1);
    }
  }
}

// ── Render (screen) ───────────────────────────────────────────────────────────
function render() {
  drawWaveform(ctx, W, H, CELL);

  // Playhead
  if (audioBuffer && isPlaying) {
    const prog = Math.min(1, (audioCtx.currentTime - startTime) / audioBuffer.duration);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(Math.round(prog * W) * CELL, 0, Math.max(1, CELL * 0.3), canvas.height);
  }
}

// ── Loop ─────────────────────────────────────────────────────────────────────
function loop() { requestAnimationFrame(loop); render(); }

// ── Toolbar ───────────────────────────────────────────────────────────────────
function setupToolbar() {
  document.getElementById('file-input').addEventListener('change', e => {
    const f = e.target.files[0]; if (f) loadFile(f);
  });
  document.getElementById('mask-input').addEventListener('change', e => {
    const f = e.target.files[0]; if (f) loadMask(f);
  });
  document.getElementById('btn-clear-mask').addEventListener('click', clearMask);
  document.getElementById('icc-input').addEventListener('change', e => {
    const f = e.target.files[0]; if (f) loadICC(f);
  });
  document.getElementById('btn-fogra39').addEventListener('click', fetchFOGRA39);
  document.getElementById('btn-clear-icc').addEventListener('click', clearICC);
  document.getElementById('btn-sine').addEventListener('click', generateSine);
  document.getElementById('btn-play').addEventListener('click', () => {
    isPlaying ? stopPlayback() : startPlayback();
  });
  document.getElementById('btn-export').addEventListener('click', exportCMYK);

  function bind(sid, vid, decimals, unit, cb) {
    const sl = document.getElementById(sid);
    const vl = document.getElementById(vid);
    sl.addEventListener('input', () => {
      const v = +sl.value;
      vl.textContent = v.toFixed(decimals) + (unit || '');
      cb(v);
    });
    // fire once to sync display with HTML default value
    vl.textContent = (+sl.value).toFixed(decimals) + (unit || '');
    cb(+sl.value);
  }

  bind('s-density', 'v-density', 0, 'px', v => { CELL = v; setSize(); computeRawPeaks(); rebuildMaskGrid(); });
  bind('s-amp',     'v-amp',     1, '',   v => { ampVal    = v; });
  bind('s-fade',    'v-fade',    1, '',   v => { fadeVal   = v; });
  bind('s-smooth',  'v-smooth',  0, '',   v => { smoothVal = v; });
  bind('s-jitter',  'v-jitter',  2, '',   v => { jitterVal = v; });
}

// ── Boot ─────────────────────────────────────────────────────────────────────
setSize();
setupToolbar();
window.addEventListener('resize', () => { setSize(); computeRawPeaks(); });
loop();
