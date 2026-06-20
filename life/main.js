const CELL          = 8;
const STROKE_RADIUS = 3;   // cell radius around each path point
const SEED_DENSITY  = 0.42;
const MAX_STEPS     = 600;

// ---------- Grid ----------
const canvas = document.getElementById('grid');
const ctx    = canvas.getContext('2d');
let W = 0, H = 0;
let cells, next;

function initGrid() {
  W = Math.floor(canvas.width  / CELL);
  H = Math.floor(canvas.height / CELL);
  cells = new Uint8Array(W * H);
  next  = new Uint8Array(W * H);
}

// ---------- GoL ----------
function gridHash() {
  let h = 0;
  for (let i = 0; i < cells.length; i++) h = (Math.imul(h, 31) + cells[i]) | 0;
  return h;
}

function golStep() {
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      let n = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < H && nc >= 0 && nc < W) n += cells[nr * W + nc];
        }
      }
      const a = cells[r * W + c];
      next[r * W + c] = (a && n === 2) || n === 3 ? 1 : 0;
    }
  }
  const t = cells; cells = next; next = t;
}

function runUntilStable() {
  let prevH = -1, streak = 0;
  for (let i = 0; i < MAX_STEPS; i++) {
    golStep();
    const h = gridHash();
    if (h === prevH) { if (++streak >= 2) break; }
    else { streak = 0; prevH = h; }
  }
}

// ---------- Path → seed → GoL ----------
function processPath(pts) {
  if (pts.length < 2) return;

  // Walk the path and collect every grid cell within STROKE_RADIUS of the stroke
  const marked = new Set();
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i], p1 = pts[i + 1];
    const dist  = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const steps = Math.max(1, Math.ceil(dist / (CELL * 0.5)));
    for (let t = 0; t <= steps; t++) {
      const fx = p0.x + (p1.x - p0.x) * t / steps;
      const fy = p0.y + (p1.y - p0.y) * t / steps;
      const cc = Math.floor(fx / CELL);
      const cr = Math.floor(fy / CELL);
      for (let dr = -STROKE_RADIUS; dr <= STROKE_RADIUS; dr++) {
        for (let dc = -STROKE_RADIUS; dc <= STROKE_RADIUS; dc++) {
          if (dr * dr + dc * dc > STROKE_RADIUS * STROKE_RADIUS) continue;
          const nr = cr + dr, nc = cc + dc;
          if (nr >= 0 && nr < H && nc >= 0 && nc < W) marked.add(nr * W + nc);
        }
      }
    }
  }

  // Seed marked cells with deterministic random (keyed to path start + end)
  const fp = pts[0], lp = pts[pts.length - 1];
  let s = (
    (Math.floor(fp.x) * 374761393) ^
    (Math.floor(fp.y) * 1003973)   ^
    (Math.floor(lp.x) * 668265263) ^
    (Math.floor(lp.y) * 374761399)
  ) >>> 0;

  for (const idx of marked) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    if (s / 0x100000000 < SEED_DENSITY) cells[idx] = 1;
  }

  runUntilStable();
}

// ---------- Interaction ----------
let playing    = false;
let drawing    = false;
let pathPoints = [];

function onDrawStart(x, y) {
  drawing    = true;
  pathPoints = [{ x, y }];
}

function onDrawMove(x, y) {
  if (!drawing) return;
  const last = pathPoints[pathPoints.length - 1];
  // Throttle: add point only if moved at least half a cell
  if (Math.hypot(x - last.x, y - last.y) > CELL * 0.5) pathPoints.push({ x, y });
}

function onDrawEnd(x, y) {
  if (!drawing) return;
  drawing = false;
  pathPoints.push({ x, y });
  processPath(pathPoints);
  pathPoints = [];
}

function setupPointer() {
  canvas.addEventListener('mousedown',  e => { e.preventDefault(); onDrawStart(e.clientX, e.clientY); });
  canvas.addEventListener('mousemove',  e => onDrawMove(e.clientX, e.clientY));
  canvas.addEventListener('mouseup',    e => onDrawEnd(e.clientX, e.clientY));
  canvas.addEventListener('mouseleave', () => {
    if (!drawing) return;
    const last = pathPoints[pathPoints.length - 1];
    if (last) onDrawEnd(last.x, last.y);
    else { drawing = false; pathPoints = []; }
  });

  canvas.addEventListener('touchstart', e => { e.preventDefault(); const t = e.touches[0];        onDrawStart(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener('touchmove',  e => { e.preventDefault(); const t = e.touches[0];        onDrawMove(t.clientX,  t.clientY); }, { passive: false });
  canvas.addEventListener('touchend',   e => { const t = e.changedTouches[0]; onDrawEnd(t.clientX, t.clientY); },                       { passive: false });
}

// ---------- Toolbar ----------
function setupToolbar() {
  document.getElementById('btn-step').addEventListener('click', () => { golStep(); });

  const btnPlay = document.getElementById('btn-play');
  btnPlay.addEventListener('click', () => {
    playing = !playing;
    btnPlay.textContent = playing ? 'pause' : 'play';
    btnPlay.classList.toggle('active', playing);
  });

  document.getElementById('btn-clear').addEventListener('click', () => {
    cells.fill(0);
    if (playing) {
      playing = false;
      const b = document.getElementById('btn-play');
      b.textContent = 'play';
      b.classList.remove('active');
    }
  });
}

// ---------- Render ----------
function render() {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Grid lines — single batched path
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.lineWidth   = 0.5;
  for (let c = 0; c <= W; c++) { ctx.moveTo(c * CELL, 0); ctx.lineTo(c * CELL, H * CELL); }
  for (let r = 0; r <= H; r++) { ctx.moveTo(0, r * CELL); ctx.lineTo(W * CELL, r * CELL); }
  ctx.stroke();

  // Live cells
  ctx.fillStyle = '#111';
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (cells[r * W + c]) ctx.fillRect(c * CELL + 1, r * CELL + 1, CELL - 1, CELL - 1);
    }
  }

  // Live stroke preview: thin line that shows the path being drawn
  if (drawing && pathPoints.length > 1) {
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0,0,0,0.22)';
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.moveTo(pathPoints[0].x, pathPoints[0].y);
    for (let i = 1; i < pathPoints.length; i++) ctx.lineTo(pathPoints[i].x, pathPoints[i].y);
    ctx.stroke();
  }
}

// ---------- Loop ----------
function loop() {
  requestAnimationFrame(loop);
  if (playing) golStep();
  render();
}

// ---------- Boot ----------
canvas.width  = window.innerWidth;
canvas.height = window.innerHeight;
initGrid();
setupPointer();
setupToolbar();
window.addEventListener('resize', () => {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  initGrid();
});
loop();
