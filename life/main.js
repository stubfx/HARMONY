const CELL = 8; // px per cell

const MORSE = {
  A:'.-',    B:'-...', C:'-.-.', D:'-..',  E:'.',
  F:'..-.',  G:'--.',  H:'....', I:'..',   J:'.---',
  K:'-.-',   L:'.-..', M:'--',   N:'-.',   O:'---',
  P:'.--.',  Q:'--.-', R:'.-.',  S:'...',  T:'-',
  U:'..-',   V:'...-', W:'.--',  X:'-..-', Y:'-.--',
  Z:'--..',
  '0':'-----','1':'.----','2':'..---','3':'...--','4':'....-',
  '5':'.....','6':'-....','7':'--...','8':'---..','9':'----.',
};

// Block (2×2) — encodes Morse dot. Minimal GoL still life.
const BLOCK   = [[0,0],[0,1],[1,0],[1,1]];
// Beehive (4-wide × 3-tall) — encodes Morse dash. Next simplest still life.
const BEEHIVE = [[0,1],[0,2],[1,0],[1,3],[2,1],[2,2]];

// 2 empty cols between any two symbols guarantees no mutual interference.
// (1 col buffer + 1 col exclusion zone for each still life edge.)
const SYM_GAP = 2;

function symW(s) { return s === '.' ? 2 : 4; }
function symH(s) { return s === '.' ? 2 : 3; }

function morseWidth(seq) {
  let w = 0;
  for (let i = 0; i < seq.length; i++) {
    if (i > 0) w += SYM_GAP;
    w += symW(seq[i]);
  }
  return w;
}

function morseHeight(seq) {
  return seq.includes('-') ? 3 : 2;
}

// ---------- Grid state ----------
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

function placePattern(pattern, row, col) {
  for (const [dr, dc] of pattern) {
    const r = row + dr, c = col + dc;
    if (r >= 0 && r < H && c >= 0 && c < W) cells[r * W + c] = 1;
  }
}

// Write one character as a Morse sequence of still lifes at (baseRow, baseCol).
function writeChar(ch, baseRow, baseCol) {
  const seq = MORSE[ch.toUpperCase()];
  if (!seq) return;
  let col = baseCol;
  for (let i = 0; i < seq.length; i++) {
    if (i > 0) col += SYM_GAP;
    placePattern(seq[i] === '.' ? BLOCK : BEEHIVE, baseRow, col);
    col += symW(seq[i]);
  }
}

// ---------- Interaction state ----------
let playing     = false;
let runSteps    = 0;
let stable      = 0; // consecutive stable frames counter
let message     = 'HARMONY';
let msgIdx      = 0;
let drawing     = false;
let ds = null, dc_ = null; // drag start / current (cell coords)

// ---------- Encode ----------
function placeNextChar(r0, c0, r1, c1) {
  if (!message.length) return;
  const ch = message[msgIdx];
  msgIdx = (msgIdx + 1) % message.length;

  if (ch === ' ') { updateQueue(); return; }

  const seq = MORSE[ch.toUpperCase()];
  if (!seq) { updateQueue(); return; }

  const pw = morseWidth(seq);
  const ph = morseHeight(seq);
  const rw = Math.max(1, r1 - r0 + 1);
  const cw = Math.max(1, c1 - c0 + 1);

  // Center pattern within rectangle; if rect too small place at top-left + 1 margin
  const startR = r0 + Math.max(0, Math.floor((rw - ph) / 2));
  const startC = c0 + Math.max(0, Math.floor((cw - pw) / 2));

  writeChar(ch, startR, startC);
  updateQueue();

  // Trigger auto-run to let surrounding noise settle
  runSteps = 300;
  stable   = 0;
}

// ---------- Toolbar ----------
function updateQueue() {
  const el = document.getElementById('char-queue');
  if (!message) { el.textContent = '—'; return; }
  el.innerHTML = message.split('').map((ch, i) => {
    const active = i === msgIdx % message.length;
    return `<span${active ? ' class="next"' : ''}>${ch === ' ' ? '&nbsp;' : ch}</span>`;
  }).join('');
}

function setupToolbar() {
  const inp = document.getElementById('msg-input');
  inp.addEventListener('input', () => {
    message = inp.value.toUpperCase();
    msgIdx  = 0;
    updateQueue();
  });

  document.getElementById('btn-step').addEventListener('click', () => {
    golStep(); render();
  });

  const btnPlay = document.getElementById('btn-play');
  btnPlay.addEventListener('click', () => {
    playing = !playing;
    btnPlay.textContent = playing ? 'pause' : 'play';
    btnPlay.classList.toggle('active', playing);
  });

  document.getElementById('btn-clear').addEventListener('click', () => {
    cells.fill(0);
    msgIdx   = 0;
    runSteps = 0;
    stable   = 0;
    updateQueue();
  });
}

// ---------- Mouse / Touch ----------
function cellAt(x, y) {
  const b = canvas.getBoundingClientRect();
  return {
    c: Math.max(0, Math.min(W - 1, Math.floor((x - b.left) / CELL))),
    r: Math.max(0, Math.min(H - 1, Math.floor((y - b.top)  / CELL))),
  };
}

function onDragStart(x, y) {
  drawing = true;
  ds  = cellAt(x, y);
  dc_ = { ...ds };
}

function onDragMove(x, y) {
  if (drawing) dc_ = cellAt(x, y);
}

function onDragEnd(x, y) {
  if (!drawing) return;
  drawing = false;
  const end = cellAt(x, y);
  const r0 = Math.min(ds.r, end.r), r1 = Math.max(ds.r, end.r);
  const c0 = Math.min(ds.c, end.c), c1 = Math.max(ds.c, end.c);
  ds = dc_ = null;
  placeNextChar(r0, c0, r1, c1);
}

function setupPointer() {
  canvas.addEventListener('mousedown',  e => { e.preventDefault(); onDragStart(e.clientX, e.clientY); });
  canvas.addEventListener('mousemove',  e => onDragMove(e.clientX, e.clientY));
  canvas.addEventListener('mouseup',    e => onDragEnd(e.clientX, e.clientY));
  canvas.addEventListener('mouseleave', () => { drawing = false; ds = dc_ = null; });

  canvas.addEventListener('touchstart', e => { e.preventDefault(); const t = e.touches[0]; onDragStart(t.clientX, t.clientY); }, { passive: false });
  canvas.addEventListener('touchmove',  e => { e.preventDefault(); const t = e.touches[0]; onDragMove(t.clientX, t.clientY);  }, { passive: false });
  canvas.addEventListener('touchend',   e => { const t = e.changedTouches[0]; onDragEnd(t.clientX, t.clientY); },                { passive: false });
}

// ---------- Render ----------
function render() {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Grid lines — single path for performance
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(0,0,0,0.07)';
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

  // Drag preview
  if (drawing && ds && dc_) {
    const c0 = Math.min(ds.c, dc_.c), c1 = Math.max(ds.c, dc_.c);
    const r0 = Math.min(ds.r, dc_.r), r1 = Math.max(ds.r, dc_.r);
    ctx.fillStyle   = 'rgba(0,0,0,0.08)';
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
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

  if (playing || runSteps > 0) {
    const h0 = gridHash();
    golStep();
    if (runSteps > 0) {
      runSteps--;
      const h1 = gridHash();
      if (h0 === h1) {
        if (++stable >= 2) { runSteps = 0; stable = 0; } // still life detected — stop early
      } else {
        stable = 0;
      }
    }
  }

  render();
}

// ---------- Boot ----------
canvas.width  = window.innerWidth;
canvas.height = window.innerHeight;
initGrid();
setupPointer();
setupToolbar();
updateQueue();
window.addEventListener('resize', () => {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  initGrid();
});
loop();
