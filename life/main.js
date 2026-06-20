// Conway's Game of Life

// ── Parameters ────────────────────────────────────────────────────────────────
let CELL  = 5;
let speed = 10; // steps per second

// ── Canvas ────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('grid');
const ctx    = canvas.getContext('2d');
let W = 0, H = 0;
let grid = null;
let next = null;

function setSize() {
  const prevW = W, prevH = H;
  const prevGrid = grid;

  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  W = Math.floor(canvas.width  / CELL);
  H = Math.floor(canvas.height / CELL);
  grid = new Uint8Array(W * H);
  next = new Uint8Array(W * H);

  // Preserve existing cells when resizing
  if (prevGrid && prevW > 0) {
    const cW = Math.min(W, prevW), cH = Math.min(H, prevH);
    for (let r = 0; r < cH; r++)
      for (let c = 0; c < cW; c++)
        grid[r * W + c] = prevGrid[r * prevW + c];
  }
}

// ── GoL logic ─────────────────────────────────────────────────────────────────
function stepGoL() {
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      let n = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          n += grid[((r + dr + H) % H) * W + ((c + dc + W) % W)];
        }
      }
      const alive = grid[r * W + c];
      next[r * W + c] = alive ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0);
    }
  }
  const tmp = grid; grid = next; next = tmp;
}

function randomize() {
  for (let i = 0; i < grid.length; i++) grid[i] = Math.random() < 0.3 ? 1 : 0;
}

function clearGrid() {
  grid.fill(0);
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (grid[r * W + c]) {
        ctx.fillRect(c * CELL + 1, r * CELL + 1, CELL - 1, CELL - 1);
      }
    }
  }
}

// ── Loop ─────────────────────────────────────────────────────────────────────
let running    = false;
let lastStep   = 0;
let rafId      = null;

function loop(ts) {
  rafId = requestAnimationFrame(loop);
  if (running && ts - lastStep >= 1000 / speed) {
    stepGoL();
    lastStep = ts;
  }
  render();
}

// ── Mouse drawing ─────────────────────────────────────────────────────────────
let drawMode  = null; // 1 = draw, 0 = erase
let lastDrawC = -1, lastDrawR = -1;

function cellAt(x, y) {
  return { c: Math.floor(x / CELL), r: Math.floor(y / CELL) };
}

function paintCell(x, y) {
  const { c, r } = cellAt(x, y);
  if (c < 0 || c >= W || r < 0 || r >= H) return;
  if (c === lastDrawC && r === lastDrawR) return;
  lastDrawC = c; lastDrawR = r;
  grid[r * W + c] = drawMode;
}

canvas.addEventListener('mousedown', e => {
  const { c, r } = cellAt(e.clientX, e.clientY);
  if (c < 0 || c >= W || r < 0 || r >= H) return;
  drawMode = grid[r * W + c] ? 0 : 1;
  lastDrawC = -1; lastDrawR = -1;
  paintCell(e.clientX, e.clientY);
});

canvas.addEventListener('mousemove', e => {
  if (drawMode === null) return;
  paintCell(e.clientX, e.clientY);
});

window.addEventListener('mouseup', () => { drawMode = null; });

// Touch support
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  const t = e.touches[0];
  const { c, r } = cellAt(t.clientX, t.clientY);
  if (c < 0 || c >= W || r < 0 || r >= H) return;
  drawMode = grid[r * W + c] ? 0 : 1;
  lastDrawC = -1; lastDrawR = -1;
  paintCell(t.clientX, t.clientY);
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (drawMode === null) return;
  paintCell(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: false });

window.addEventListener('touchend', () => { drawMode = null; });

// ── Toolbar ───────────────────────────────────────────────────────────────────
function syncPlayBtn() {
  const b = document.getElementById('btn-play');
  b.textContent = running ? 'pause' : 'play';
  b.classList.toggle('active', running);
}

function setupToolbar() {
  document.getElementById('btn-random').addEventListener('click', randomize);
  document.getElementById('btn-clear').addEventListener('click', clearGrid);
  document.getElementById('btn-step').addEventListener('click', () => {
    if (!running) stepGoL();
  });
  document.getElementById('btn-play').addEventListener('click', () => {
    running = !running;
    syncPlayBtn();
  });

  function bind(sid, vid, decimals, unit, cb) {
    const sl = document.getElementById(sid);
    const vl = document.getElementById(vid);
    sl.addEventListener('input', () => {
      const v = +sl.value;
      vl.textContent = v.toFixed(decimals) + (unit || '');
      cb(v);
    });
    vl.textContent = (+sl.value).toFixed(decimals) + (unit || '');
    cb(+sl.value);
  }

  bind('s-density', 'v-density', 0, 'px',  v => { CELL = v; setSize(); });
  bind('s-speed',   'v-speed',   0, 'fps', v => { speed = v; });
}

// ── Boot ─────────────────────────────────────────────────────────────────────
setSize();
setupToolbar();
window.addEventListener('resize', setSize);
requestAnimationFrame(loop);
