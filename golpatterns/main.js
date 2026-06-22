// GoL Pattern Editor — draw cells, export to SVG (each cell = 0.5×0.5 cm)

let CELL = 24;

const canvas = document.getElementById('grid');
const ctx    = canvas.getContext('2d');
let W = 0, H = 0;
let grid = null;

function setSize() {
  const prevW = W, prevH = H;
  const prevGrid = grid;

  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  W = Math.floor(canvas.width  / CELL);
  H = Math.floor(canvas.height / CELL);
  grid = new Uint8Array(W * H);

  if (prevGrid && prevW > 0) {
    const cW = Math.min(W, prevW), cH = Math.min(H, prevH);
    for (let r = 0; r < cH; r++)
      for (let c = 0; c < cW; c++)
        grid[r * W + c] = prevGrid[r * prevW + c];
  }
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // grid lines
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 0.5;
  for (let c = 0; c <= W; c++) {
    ctx.beginPath();
    ctx.moveTo(c * CELL, 0);
    ctx.lineTo(c * CELL, H * CELL);
    ctx.stroke();
  }
  for (let r = 0; r <= H; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * CELL);
    ctx.lineTo(W * CELL, r * CELL);
    ctx.stroke();
  }

  // live cells
  ctx.fillStyle = '#111';
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      if (grid[r * W + c]) {
        ctx.fillRect(c * CELL + 1, r * CELL + 1, CELL - 1, CELL - 1);
      }
    }
  }
}

requestAnimationFrame(function loop() {
  render();
  requestAnimationFrame(loop);
});

// ── Drawing ───────────────────────────────────────────────────────────────────
let drawMode  = null;
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

// ── SVG Export ────────────────────────────────────────────────────────────────
function exportSVG() {
  const live = [];
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++)
      if (grid[r * W + c]) live.push({ c, r });

  if (live.length === 0) return;

  const minC = Math.min(...live.map(p => p.c));
  const maxC = Math.max(...live.map(p => p.c));
  const minR = Math.min(...live.map(p => p.r));
  const maxR = Math.max(...live.map(p => p.r));

  const cols = maxC - minC + 1;
  const rows = maxR - minR + 1;

  // viewBox uses integer cell units; width/height in cm (each unit = 0.5cm)
  const wCm = (cols * 0.5).toFixed(2);
  const hCm = (rows * 0.5).toFixed(2);

  let rects = '';
  for (const { c, r } of live) {
    const x = c - minC;
    const y = r - minR;
    rects += `  <rect x="${x}" y="${y}" width="1" height="1"/>\n`;
  }

  const svg =
`<svg xmlns="http://www.w3.org/2000/svg" width="${wCm}cm" height="${hCm}cm" viewBox="0 0 ${cols} ${rows}">
  <g fill="#111">
${rects}  </g>
</svg>`;

  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'pattern.svg';
  a.click();
  URL.revokeObjectURL(url);
}

// ── Toolbar ───────────────────────────────────────────────────────────────────
document.getElementById('btn-clear').addEventListener('click', () => grid.fill(0));
document.getElementById('btn-export').addEventListener('click', exportSVG);

const sl = document.getElementById('s-density');
const vl = document.getElementById('v-density');
sl.addEventListener('input', () => {
  CELL = +sl.value;
  vl.textContent = CELL + 'px';
  setSize();
});
vl.textContent = CELL + 'px';

// ── Boot ─────────────────────────────────────────────────────────────────────
setSize();
window.addEventListener('resize', setSize);
