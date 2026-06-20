const CELL    = 8;
const SPACING = 10; // cells between candidate positions

// ── GoL pattern library ──────────────────────────────────────────────────────
// 12 classic patterns: still lifes, oscillators, one spaceship.
// Coords are [row, col] offsets from top-left.
const PATTERNS = [
  { name:'block',   cells:[[0,0],[0,1],[1,0],[1,1]] },
  { name:'beehive', cells:[[0,1],[0,2],[1,0],[1,3],[2,1],[2,2]] },
  { name:'loaf',    cells:[[0,1],[0,2],[1,0],[1,3],[2,1],[2,3],[3,2]] },
  { name:'boat',    cells:[[0,0],[0,1],[1,0],[1,2],[2,1]] },
  { name:'tub',     cells:[[0,1],[1,0],[1,2],[2,1]] },
  { name:'ship',    cells:[[0,0],[0,1],[1,0],[1,2],[2,1],[2,2]] },
  { name:'pond',    cells:[[0,1],[0,2],[1,0],[1,3],[2,0],[2,3],[3,1],[3,2]] },
  { name:'blinker', cells:[[0,0],[0,1],[0,2]] },
  { name:'toad',    cells:[[0,1],[0,2],[0,3],[1,0],[1,1],[1,2]] },
  { name:'beacon',  cells:[[0,0],[0,1],[1,0],[2,3],[3,2],[3,3]] },
  { name:'glider',  cells:[[0,1],[1,2],[2,0],[2,1],[2,2]] },
  { name:'lwss',    cells:[[0,1],[0,4],[1,0],[2,0],[2,4],[3,0],[3,1],[3,2],[3,3]] },
];

// Weighted draw pool: still lifes × 3, oscillators × 2, glider × 1.
// LWSS excluded from pool (too large, creates chaos at close spacing).
const POOL = [
  0,0,0, 1,1,1, 2,2, 3,3, 4,4, 5,5, 6,
  7,7,7, 8,8, 9,9,
  10,
].map(i => PATTERNS[i]);

// ── Formula presets — copied verbatim from src/sim.js PRESETS ────────────────
// Variables available: x, y, t, cx, cy, PI, TWO_PI
// Formula is evaluated at each candidate grid position;
// its output v is mapped via (cos(v)+1)/2 → [0,1] as a placement probability.
// This reproduces the same wave / cell / grid density structure
// that the simulation creates for particles.
const PRESETS = [
  { label:'cells',              dir:'sin(x * 0.006) * cos(y * 0.006) * TWO_PI' },
  { label:'fine grid',          dir:'sin(x * 0.012) * cos(y * 0.012) * TWO_PI' },
  { label:'grid',               dir:'sin(x * 0.008) * cos(y * 0.008) * TWO_PI' },
  { label:'lines',              dir:'sin(x * 0.006) * PI' },
  { label:'lines (horizontal)', dir:'sin(y * 0.006) * PI' },
  { label:'diagonal',           dir:'sin((x + y) * 0.006) * TWO_PI' },
  { label:'waves + weather',    dir:'sin(x * 0.006 + t * 0.4) * PI' },
  { label:'spiral',             dir:'atan2(y - cy, x - cx) + t * 0.3' },
  { label:'vortex',             dir:'atan2(y - cy, x - cx) + PI * 0.5' },
  { label:'radial pulse',       dir:'atan2(y-cy,x-cx) + sin(length(vec2(x-cx,y-cy))*0.012 - t*1.5)*PI' },
  { label:'turbulence',         dir:'sin(x * 0.009 + sin(y * 0.006 + t)) * TWO_PI' },
];

// Translate WGSL formula string → compiled JS function.
function makeFormulaFn(str) {
  const js = str
    // length(vec2(a,b)) → Math.hypot(a,b)
    .replace(/length\s*\(\s*vec2\s*\(([^,]+),\s*([^)]+)\)\s*\)/g, 'Math.hypot($1,$2)')
    .replace(/\batan2\b/g, 'Math.atan2')
    .replace(/\bsin\b/g,   'Math.sin')
    .replace(/\bcos\b/g,   'Math.cos');
  // PI and TWO_PI injected as locals so the formula strings need no changes
  return new Function('x','y','t','cx','cy',
    `const PI=Math.PI,TWO_PI=2*Math.PI; return ${js};`);
}

// ── Grid ─────────────────────────────────────────────────────────────────────
const canvas = document.getElementById('grid');
const ctx    = canvas.getContext('2d');
let W=0, H=0, cells, next;

function initGrid() {
  W = Math.floor(canvas.width  / CELL);
  H = Math.floor(canvas.height / CELL);
  cells = new Uint8Array(W * H);
  next  = new Uint8Array(W * H);
}

// ── GoL ──────────────────────────────────────────────────────────────────────
function golStep() {
  for (let r=0; r<H; r++) {
    for (let c=0; c<W; c++) {
      let n=0;
      for (let dr=-1; dr<=1; dr++) {
        for (let dc=-1; dc<=1; dc++) {
          if (dr===0 && dc===0) continue;
          const nr=r+dr, nc=c+dc;
          if (nr>=0 && nr<H && nc>=0 && nc<W) n += cells[nr*W+nc];
        }
      }
      const a = cells[r*W+c];
      next[r*W+c] = (a && n===2) || n===3 ? 1 : 0;
    }
  }
  const t=cells; cells=next; next=t;
}

// ── Distribute ───────────────────────────────────────────────────────────────
let currentFn = makeFormulaFn(PRESETS[0].dir);

function distribute() {
  cells.fill(0);
  const cx = (W/2)*CELL, cy = (H/2)*CELL;

  for (let gr=SPACING; gr<H-SPACING; gr+=SPACING) {
    for (let gc=SPACING; gc<W-SPACING; gc+=SPACING) {
      let v;
      try { v = currentFn(gc*CELL, gr*CELL, 0, cx, cy); }
      catch { continue; }

      // (cos(v)+1)/2 maps the formula's wave structure to a [0,1] probability.
      // Peaks where v=0,±2π (formula "zero-crossings" for heading),
      // troughs where v=±π — same density variation the simulation shows visually.
      const prob = (Math.cos(v) + 1) / 2;
      if (Math.random() < prob * 0.82) {
        const pat = POOL[Math.floor(Math.random() * POOL.length)];
        placePattern(pat, gr, gc);
      }
    }
  }
}

function placePattern(pat, baseR, baseC) {
  for (const [dr,dc] of pat.cells) {
    const r=baseR+dr, c=baseC+dc;
    if (r>=0 && r<H && c>=0 && c<W) cells[r*W+c]=1;
  }
}

// ── Toolbar ───────────────────────────────────────────────────────────────────
let playing = false;

function setupToolbar() {
  const sel = document.getElementById('formula-select');
  PRESETS.forEach((p,i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = p.label;
    sel.appendChild(opt);
  });

  sel.addEventListener('change', () => {
    currentFn = makeFormulaFn(PRESETS[+sel.value].dir);
  });

  document.getElementById('btn-gen').addEventListener('click', distribute);

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
      btnPlay.textContent = 'play';
      document.getElementById('btn-play').classList.remove('active');
    }
  });
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.beginPath();
  ctx.strokeStyle = 'rgba(0,0,0,0.06)';
  ctx.lineWidth   = 0.5;
  for (let c=0; c<=W; c++) { ctx.moveTo(c*CELL,0); ctx.lineTo(c*CELL,H*CELL); }
  for (let r=0; r<=H; r++) { ctx.moveTo(0,r*CELL); ctx.lineTo(W*CELL,r*CELL); }
  ctx.stroke();

  ctx.fillStyle = '#111';
  for (let r=0; r<H; r++)
    for (let c=0; c<W; c++)
      if (cells[r*W+c]) ctx.fillRect(c*CELL+1, r*CELL+1, CELL-1, CELL-1);
}

// ── Loop ─────────────────────────────────────────────────────────────────────
function loop() {
  requestAnimationFrame(loop);
  if (playing) golStep();
  render();
}

// ── Boot ─────────────────────────────────────────────────────────────────────
canvas.width  = window.innerWidth;
canvas.height = window.innerHeight;
initGrid();
setupToolbar();
distribute();
window.addEventListener('resize', () => {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  initGrid();
  distribute();
});
loop();
