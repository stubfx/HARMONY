const CELL = 8;

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

// Seed rectangle with deterministic random noise and run GoL silently until stable.
// The stable pattern stays roughly within the rectangle's bounds and shape.
function seedAndRun(r0, c0, r1, c1) {
  // Deterministic LCG seed from rectangle coordinates
  let s = ((r0 * 374761393) ^ (c0 * 1003973) ^ (r1 * 668265263) ^ (c1 * 374761399)) >>> 0;

  const density = 0.38;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      if (s / 0x100000000 < density) cells[r * W + c] = 1;
    }
  }

  // Run silently until stable (still life detected) or 600 steps max
  let prevH = -1, streak = 0;
  for (let i = 0; i < 600; i++) {
    golStep();
    const h = gridHash();
    if (h === prevH) { if (++streak >= 2) break; }
    else { streak = 0; prevH = h; }
  }
}

// ---------- Interaction ----------
let playing = false;
let drawing = false;
let ds = null, dc_ = null;

function cellAt(x, y) {
  const b = canvas.getBoundingClientRect();
  return {
    c: Math.max(0, Math.min(W - 1, Math.floor((x - b.left) / CELL))),
    r: Math.max(0, Math.min(H - 1, Math.floor((y - b.top)  / CELL))),
  };
}

function onDragStart(x, y) { drawing = true; ds = cellAt(x, y); dc_ = { ...ds }; }
function onDragMove(x, y)  { if (drawing) dc_ = cellAt(x, y); }
function onDragEnd(x, y) {
  if (!drawing) return;
  drawing = false;
  const end = cellAt(x, y);
  const r0 = Math.min(ds.r, end.r), r1 = Math.max(ds.r, end.r);
  const c0 = Math.min(ds.c, end.c), c1 = Math.max(ds.c, end.c);
  ds = dc_ = null;
  // Require at least a 3×3 rect to produce meaningful GoL
  if (r1 - r0 >= 2 && c1 - c0 >= 2) seedAndRun(r0, c0, r1, c1);
}

function setupPointer() {
  canvas.addEventListener('mousedown',  e => { e.preventDefault(); onDragStart(e.clientX, e.clientY); });
  canvas.addEventListener('mousemove',  e => onDragMove(e.clientX, e.clientY));
  canvas.addEventListener('mouseup',    e => onDragEnd(e.clientX, e.clientY));
  canvas.addEventListener('mouseleave', () => { drawing = false; ds = dc_ = null; });

  canvas.addEventListener('touchstart', e => { e.preventDefault(); const t = e.touches[0];        onDragStart(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener('touchmove',  e => { e.preventDefault(); const t = e.touches[0];        onDragMove(t.clientX,  t.clientY); }, { passive: false });
  canvas.addEventListener('touchend',   e => { const t = e.changedTouches[0]; onDragEnd(t.clientX, t.clientY); },                       { passive: false });
}

// ---------- Toolbar ----------
function setupToolbar() {
  document.getElementById('btn-step').addEventListener('click', () => { golStep(); render(); });

  const btnPlay = document.getElementById('btn-play');
  btnPlay.addEventListener('click', () => {
    playing = !playing;
    btnPlay.textContent = playing ? 'pause' : 'play';
    btnPlay.classList.toggle('active', playing);
  });

  document.getElementById('btn-clear').addEventListener('click', () => {
    cells.fill(0);
    if (playing) { playing = false; document.getElementById('btn-play').textContent = 'play'; document.getElementById('btn-play').classList.remove('active'); }
  });
}

// ---------- Render ----------
function render() {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Grid lines — single batched path
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.lineWidth = 0.5;
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

  // Drag preview
  if (drawing && ds && dc_) {
    const c0 = Math.min(ds.c, dc_.c), c1 = Math.max(ds.c, dc_.c);
    const r0 = Math.min(ds.r, dc_.r), r1 = Math.max(ds.r, dc_.r);
    ctx.fillStyle   = 'rgba(0,0,0,0.07)';
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth   = 1;
    const rx = c0 * CELL, ry = r0 * CELL;
    const rw = (c1 - c0 + 1) * CELL, rh = (r1 - r0 + 1) * CELL;
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1);
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
