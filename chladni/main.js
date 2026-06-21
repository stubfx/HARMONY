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
const selMode     = document.getElementById('s-mode');
const sliderScatter = document.getElementById('s-scatter');
const vScatter      = document.getElementById('v-scatter');
const sliderJitter  = document.getElementById('s-jitter');
const vJitter       = document.getElementById('v-jitter');
const inWidth     = document.getElementById('s-width');
const inHeight    = document.getElementById('s-height');
const selUnit     = document.getElementById('s-unit');

let audioCtx    = null;
let updateTimer = null;

// ── Chladni mathematics ──────────────────────────────────────────────────────

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

// Chladni plate function at normalised coords (x, y) ∈ [0,1].
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

// Each dot is placed on the nodal line first, then scatter is applied radially —
// pushing it outward in a random direction by up to scatter × (W/30) pixels.
// This mimics stars distributed around constellation lines, not locked to a grid.
function generateDots(modes, W, H, threshold, step, scatter) {
  const dots     = [];
  const maxDrift = scatter * (W / 30); // scale with domain size, not step
  for (let px = 0; px < W; px += step) {
    for (let py = 0; py < H; py += step) {
      const val = chladniValue(px / W, py / H, modes);
      if (Math.abs(val) < threshold) {
        // Tiny base jitter so dots don't sit on a visible grid
        const bx    = px + (Math.random() - 0.5) * step * 0.4;
        const by    = py + (Math.random() - 0.5) * step * 0.4;
        // Radial scatter applied after filtering: direction + distance are independent
        const angle = Math.random() * 6.2832;
        const dist  = Math.random() * maxDrift;
        dots.push({
          x:         bx + Math.cos(angle) * dist,
          y:         by + Math.sin(angle) * dist,
          intensity: 1 - Math.abs(val) / threshold,
          size:      Math.random(),
        });
      }
    }
  }
  return dots;
}

// ── Marching squares ─────────────────────────────────────────────────────────
// Trace nodal lines (Z=0 isocontours) as exact vector segments.
// No regular dot grid → no moiré or registration artifacts in print.

// For each 4-corner cell, which pairs of edges does the Z=0 contour cross?
// Corners: TL=bit0, TR=bit1, BR=bit2, BL=bit3.
// Edges: 0=top(TL↔TR), 1=right(TR↔BR), 2=bottom(BR↔BL), 3=left(BL↔TL).
const EDGE_PAIRS = [
  [],              // 0  all same sign
  [[0,3]],         // 1  TL
  [[0,1]],         // 2  TR
  [[1,3]],         // 3  TL+TR
  [[1,2]],         // 4  BR
  [[0,3],[1,2]],   // 5  TL+BR saddle
  [[0,2]],         // 6  TR+BR
  [[2,3]],         // 7  TL+TR+BR
  [[2,3]],         // 8  BL
  [[0,2]],         // 9  TL+BL
  [[0,1],[2,3]],   // 10 TR+BL saddle
  [[1,2]],         // 11 TL+TR+BL
  [[1,3]],         // 12 BR+BL
  [[0,1]],         // 13 TL+BR+BL
  [[0,3]],         // 14 TR+BR+BL
  [],              // 15 all same sign
];

const EDGE_CORNERS = [[0,1],[1,2],[2,3],[3,0]];

function edgePoint(edge, px, py, v) {
  const [a, b] = EDGE_CORNERS[edge];
  const t = Math.abs(v[a] - v[b]) < 1e-10 ? 0.5 : v[a] / (v[a] - v[b]);
  return [px[a] + (px[b] - px[a]) * t, py[a] + (py[b] - py[a]) * t];
}

// Returns [[x0,y0],[x1,y1]] segments in pixel coords [0..W]×[0..H].
// The Chladni domain normalises both axes to [0,1], so a rectangular W×H
// reveals a larger slice of the plate without stretching individual elements.
function marchingSquares(modes, W, H, gridW, gridH) {
  const segments = [];
  const stride   = gridW + 1;
  const Z        = new Float32Array(stride * (gridH + 1));
  for (let j = 0; j <= gridH; j++) {
    for (let i = 0; i <= gridW; i++) {
      Z[j * stride + i] = chladniValue(i / gridW, j / gridH, modes);
    }
  }
  const cw = W / gridW;
  const ch = H / gridH;
  for (let j = 0; j < gridH; j++) {
    for (let i = 0; i < gridW; i++) {
      const v = [
        Z[ j      * stride + i    ],  // TL
        Z[ j      * stride + i + 1],  // TR
        Z[(j + 1) * stride + i + 1],  // BR
        Z[(j + 1) * stride + i    ],  // BL
      ];
      const caseIdx = (v[0]>0?1:0)|(v[1]>0?2:0)|(v[2]>0?4:0)|(v[3]>0?8:0);
      const edges = EDGE_PAIRS[caseIdx];
      if (!edges.length) continue;
      const px = [i*cw, (i+1)*cw, (i+1)*cw, i*cw    ];
      const py = [j*ch,  j*ch,    (j+1)*ch,  (j+1)*ch];
      for (const [e0, e1] of edges) {
        segments.push([edgePoint(e0, px, py, v), edgePoint(e1, px, py, v)]);
      }
    }
  }
  return segments;
}

// ── Canvas rendering ─────────────────────────────────────────────────────────

// jitter: radius variation factor (0=uniform, 1=max spread like star magnitudes)
function renderDots(dots, jitter) {
  const { width: W, height: H } = canvas;
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, W, H);
  for (const { x, y, intensity, size } of dots) {
    const r = Math.max(0.15, 1.1 * (1 + jitter * (size * 2 - 1)));
    ctx.fillStyle = `rgba(208,208,208,${(0.30 + intensity * 0.70).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 6.2832);
    ctx.fill();
  }
}

function renderLines(segments) {
  const { width: W, height: H } = canvas;
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(208,208,208,0.85)';
  ctx.lineWidth = 0.65;
  ctx.beginPath();
  for (const [[x0, y0], [x1, y1]] of segments) {
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
  }
  ctx.stroke();
}

// ── Audio ────────────────────────────────────────────────────────────────────

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
    osc.type            = 'sine';
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0,                now);
    env.gain.linearRampToValueAtTime(amp * 0.45, now + 0.10);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 5.0);
    osc.connect(env);
    env.connect(master);
    osc.start(now);
    osc.stop(now + 5.5);
  }
}

// ── SVG export ───────────────────────────────────────────────────────────────

const TO_MM = { mm: 1, cm: 10, pt: 0.3528, in: 25.4 };

function exportSVG(modes, threshold) {
  const width   = parseFloat(inWidth.value)  || 14.8;
  const height  = parseFloat(inHeight.value) || 21;
  const unit    = selUnit.value;
  const mode    = selMode.value;
  const BASE    = 800;

  // viewBox aspect ratio matches physical dimensions — no stretching.
  const widthMm  = width  * (TO_MM[unit] ?? 1);
  const heightMm = height * (TO_MM[unit] ?? 1);
  const viewW    = BASE;
  const viewH    = Math.round(BASE * heightMm / widthMm);

  let elements;

  if (mode === 'dots') {
    const step    = parseInt(selDensity.value);
    const scatter = parseFloat(sliderScatter.value);
    const jitter  = parseFloat(sliderJitter.value);
    const baseR   = Math.max(0.4, Math.min(4, 160 / widthMm));
    const dots    = generateDots(modes, viewW, viewH, threshold, step, scatter);
    elements      = dots.map(({ x, y, size }) => {
      const r = Math.max(0.1, baseR * (1 + jitter * (size * 2 - 1))).toFixed(2);
      return `  <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="#3d3d3d"/>`;
    });
  } else {
    // Marching squares: true vector contours, print-safe.
    const GRID  = { '5': 150, '3': 300, '2': 500 }[selDensity.value] ?? 300;
    const gridW = GRID;
    const gridH = Math.round(GRID * viewH / viewW);
    // Target ≈ 0.12mm physical stroke width.
    const sw    = Math.max(0.3, 0.12 / (widthMm / viewW)).toFixed(2);
    const segs  = marchingSquares(modes, viewW, viewH, gridW, gridH);
    if (!segs.length) {
      elements = [];
    } else {
      const d = segs.map(([[x0,y0],[x1,y1]]) =>
        `M${x0.toFixed(1)},${y0.toFixed(1)} L${x1.toFixed(1)},${y1.toFixed(1)}`
      ).join(' ');
      elements = [
        `  <path d="${d}" stroke="#3d3d3d" stroke-width="${sw}" stroke-linecap="round" fill="none"/>`,
      ];
    }
  }

  const svg = [
    `<svg width="${width}${unit}" height="${height}${unit}" viewBox="0 0 ${viewW} ${viewH}" xmlns="http://www.w3.org/2000/svg">`,
    ...elements,
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
  const mode      = selMode.value;

  if (!text) {
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, size, size);
    return;
  }

  const modes = textToModes(text);

  if (mode === 'dots') {
    const scatter = parseFloat(sliderScatter.value);
    const jitter  = parseFloat(sliderJitter.value);
    renderDots(generateDots(modes, size, size, threshold, 3, scatter), jitter);
  } else {
    // Canvas preview: 200-cell grid keeps updates snappy.
    renderLines(marchingSquares(modes, size, size, 200, 200));
  }
}

function scheduleUpdate() {
  clearTimeout(updateTimer);
  updateTimer = setTimeout(update, 60);
}

function resize() {
  const s = Math.min(window.innerWidth, window.innerHeight - 160, 680);
  canvas.width = canvas.height = Math.max(s, 280);
  update();
}

// ── Events ───────────────────────────────────────────────────────────────────

input.addEventListener('input', scheduleUpdate);
selMode.addEventListener('change', scheduleUpdate);

sliderThr.addEventListener('input', () => {
  vThr.textContent = parseFloat(sliderThr.value).toFixed(2);
  scheduleUpdate();
});

sliderScatter.addEventListener('input', () => {
  vScatter.textContent = parseFloat(sliderScatter.value).toFixed(2);
  scheduleUpdate();
});

sliderJitter.addEventListener('input', () => {
  vJitter.textContent = parseFloat(sliderJitter.value).toFixed(2);
  scheduleUpdate();
});

btnPlay.addEventListener('click', () => {
  const modes = textToModes(input.value.trim());
  if (modes.length) playAudio(modes);
});

btnExport.addEventListener('click', () => {
  const text = input.value.trim();
  if (!text) return;
  exportSVG(textToModes(text), parseFloat(sliderThr.value));
});

window.addEventListener('resize', resize);

// ── Init ─────────────────────────────────────────────────────────────────────

input.value = 'HARMONY';
resize();
