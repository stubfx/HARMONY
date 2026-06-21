// Chladni-inspired SVG generator for HARMONY thesis
// Shapes emerge from dot density — never drawn directly.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- Seeded PRNG (Mulberry32) ----
function mkRand(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6D2B79F5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

// ---- Math ----
const sq = x => x * x;
const d2 = (x, y, cx, cy) => Math.sqrt(sq(x - cx) + sq(y - cy));
const gauss = (v, m, s) => Math.exp(-sq(v - m) / (2 * sq(s)));
const ring = (x, y, cx, cy, r, s) => gauss(d2(x, y, cx, cy), r, s);

function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = sq(dx) + sq(dy);
  if (len2 < 1e-9) return d2(px, py, x1, y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return d2(px, py, x1 + t * dx, y1 + t * dy);
}
const lineG = (px, py, x1, y1, x2, y2, s) => gauss(segDist(px, py, x1, y1, x2, y2), 0, s);

// ---- Generator ----
function makeSVG(fn, seed, attempts = 65000) {
  const rand = mkRand(seed);
  const parts = [];
  for (let i = 0; i < attempts; i++) {
    const x = rand() * 800, y = rand() * 800;
    if (rand() < Math.min(1, fn(x, y))) {
      const r = (0.7 + rand() * 0.8).toFixed(2);
      parts.push(`  <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="#3d3d3d"/>`);
    }
  }
  return `<svg viewBox="0 0 800 800" xmlns="http://www.w3.org/2000/svg">\n${parts.join('\n')}\n</svg>\n`;
}

const BG = 0.003;

// ---- Density functions ----
const DEFS = {

  // Introduzione: Conway glider — 5 celle come nodi di Chladni
  '00_introduzione': [101, 72000, (x, y) => {
    const cells = [[380,340],[424,384],[336,428],[380,428],[424,428]];
    const sz = 44, s = 3;
    let sig = 0;
    for (const [cx, cy] of cells) {
      const inX = x > cx && x < cx + sz, inY = y > cy && y < cy + sz;
      if (inX) { sig += gauss(y, cy, s) * 0.7; sig += gauss(y, cy + sz, s) * 0.7; }
      if (inY) { sig += gauss(x, cx, s) * 0.7; sig += gauss(x, cx + sz, s) * 0.7; }
    }
    return BG + Math.min(0.9, sig);
  }],

  // Cap 1 header: cerchio singolo come spazio ambientale
  '01_l-ascolto': [201, 65000, (x, y) =>
    BG + ring(x, y, 400, 400, 308, 12) * 0.72
  ],

  // 1.1: cerchio — la musica come spazio da abitare
  '1.1_la-musica-come-ambiente': [111, 65000, (x, y) =>
    BG + ring(x, y, 400, 400, 300, 11) * 0.75
  ],

  // 1.2: cerchi concentrici che sbiadiscono — il suono che si propaga
  '1.2_ascoltare-invece-di-chiedere': [112, 80000, (x, y) => {
    const d = d2(x, y, 400, 400);
    return BG
      + gauss(d,  40,  8) * 0.72
      + gauss(d, 112,  9) * 0.54
      + gauss(d, 192, 10) * 0.38
      + gauss(d, 278, 11) * 0.23
      + gauss(d, 358, 12) * 0.13;
  }],

  // 1.3: onda sinusoidale — la forma del suono in stato di flow
  '1.3_il-flow': [113, 65000, (x, y) => {
    if (x < 120 || x > 680) return BG;
    const sy = 400 + 75 * Math.sin(2 * Math.PI * (x - 120) / 560);
    return BG + gauss(y, sy, 9) * 0.65;
  }],

  // 1.4: costellazione Lyra — stelle come struttura del cielo
  '1.4_i-punti-nel-cielo': [114, 75000, (x, y) => {
    const stars = [
      [568, 252, 16, 0.88], [508, 312, 7, 0.62], [452, 354, 7, 0.62],
      [385, 445, 9, 0.68],  [428, 490, 8, 0.65], [510, 448, 7, 0.62],
    ];
    const edges = [
      [568,252,508,312],[508,312,452,354],[452,354,385,445],
      [452,354,510,448],[385,445,428,490],[428,490,510,448],
    ];
    let sig = 0;
    for (const [sx, sy, sr, amp] of stars) sig += gauss(d2(x, y, sx, sy), 0, sr) * amp;
    for (const [x1,y1,x2,y2] of edges) sig += lineG(x, y, x1, y1, x2, y2, 4) * 0.38;
    return BG + Math.min(0.95, sig);
  }],

  // Cap 2 header: nodo centrale + cerchi che irradiano
  '02_harmony': [202, 82000, (x, y) => {
    const dd = d2(x, y, 400, 400);
    return BG
      + gauss(dd,  5,  5) * 0.90
      + gauss(dd, 62,  8) * 0.70
      + gauss(dd,135,  9) * 0.52
      + gauss(dd,215, 10) * 0.36
      + gauss(dd,300, 11) * 0.22
      + gauss(dd,375, 12) * 0.12;
  }],

  // 2.1: nuvola organica di punti — il sistema che respira
  '2.1_un-sistema-che-vive': [121, 65000, (x, y) => {
    const ex = (x - 410) / 155, ey = (y - 388) / 115;
    const env = gauss(Math.sqrt(sq(ex) + sq(ey)), 0, 0.45) * 0.48;
    const clusters = [
      [375,352,32],[435,362,28],[385,393,26],[445,382,30],
      [402,418,28],[362,408,24],[452,408,26],[418,432,28],
    ];
    const jitter = clusters.reduce((a, [cx, cy, s]) => a + gauss(d2(x, y, cx, cy), 0, s) * 0.13, 0);
    return BG + env + jitter;
  }],

  // 2.2: un solo punto — la nota come scelta personale
  '2.2_la-nota-come-scelta-personale': [122, 35000, (x, y) =>
    0.001 + gauss(d2(x, y, 435, 372), 0, 13) * 0.82
  ],

  // 2.3: due sorgenti che si sovrappongono — emozione condivisa
  '2.3_lemozione-condivisa': [123, 85000, (x, y) => {
    const d1 = d2(x, y, 300, 400), d2r = d2(x, y, 500, 400);
    return BG
      + gauss(d1,  62, 9) * 0.58 + gauss(d1, 148, 10) * 0.38 + gauss(d1, 236, 11) * 0.21
      + gauss(d2r, 62, 9) * 0.58 + gauss(d2r,148, 10) * 0.38 + gauss(d2r,236, 11) * 0.21;
  }],

  // 2.4: spirale con punto di ingresso — entrare in qualcosa già in moto
  '2.4_entrare-in-qualcosa-gia-in-moto': [124, 68000, (x, y) => {
    const entryX = 155, entryY = 545;
    const entryAngle = Math.atan2(entryY - 400, entryX - 400);
    const entryR = d2(entryX, entryY, 400, 400);
    let sig = gauss(d2(x, y, entryX, entryY), 0, 9) * 0.82;
    const steps = 130;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const angle = entryAngle - t * Math.PI * 2.8;
      const r = entryR * (1 - t * 0.84);
      const sx = 400 + r * Math.cos(angle), sy = 400 + r * Math.sin(angle);
      sig += gauss(d2(x, y, sx, sy), 0, 6) * 0.25;
    }
    return BG + Math.min(0.95, sig);
  }],

  // Cap 3 header: colonna vertebrale + rami come struttura in costruzione
  '03_costruire-nel-buio': [203, 65000, (x, y) => {
    const spine = gauss(x, 400, 7) * (y >= 175 && y <= 625 ? 0.58 : 0);
    const branches = [
      [400,240,560,240],[255,305,400,305],[400,385,530,385],
      [310,455,400,455],[400,530,490,530],[270,580,400,580],
    ].reduce((a, [x1,y1,x2,y2]) => a + lineG(x, y, x1, y1, x2, y2, 7) * 0.50, 0);
    return BG + spine + Math.min(0.55, branches);
  }],

  // 3.1: griglia 4x4 con celle sparse — Conway intermedio
  '3.1_i-mesi-nel-mezzo': [131, 72000, (x, y) => {
    const cells = [
      [316,316],[400,316],[358,358],[400,358],
      [316,400],[442,400],[358,442],[442,442],
    ];
    const sz = 30, s = 2.5;
    let sig = 0;
    for (const [cx, cy] of cells) {
      const inX = x > cx && x < cx + sz, inY = y > cy && y < cy + sz;
      if (inX) { sig += gauss(y, cy, s) * 0.65; sig += gauss(y, cy + sz, s) * 0.65; }
      if (inY) { sig += gauss(x, cx, s) * 0.65; sig += gauss(x, cx + sz, s) * 0.65; }
    }
    return BG + Math.min(0.9, sig);
  }],

  // 3.2: due binari + curva che si stacca
  '3.2_uscire-dai-binari': [132, 65000, (x, y) => {
    const inX = x >= 160 && x <= 680;
    const r1 = inX ? gauss(y, 375, 7) * 0.55 : 0;
    const r2 = inX ? gauss(y, 425, 7) * 0.55 : 0;
    let curve = 0;
    for (let t = 0; t <= 1; t += 0.015) {
      const bx = sq(1-t)*400 + 2*(1-t)*t*440 + sq(t)*558;
      const by = sq(1-t)*375 + 2*(1-t)*t*295 + sq(t)*210;
      curve += gauss(d2(x, y, bx, by), 0, 6) * 0.40;
    }
    return BG + r1 + r2 + Math.min(0.55, curve);
  }],

  // 3.3: puntino piccolo + grande arco — osservatore davanti al vasto
  '3.3_come-un-bambino-che-guarda': [133, 65000, (x, y) =>
    BG + gauss(d2(x, y, 240, 400), 0, 10) * 0.88 + ring(x, y, 490, 400, 242, 11) * 0.65
  ],

  // Cap 4 header: punti connessi — la rete dei partecipanti
  '04_la-riflessione': [204, 65000, (x, y) => {
    const edges = [[335,285,455,258],[455,258,515,348],[515,348,478,462],[295,372,398,422],[398,422,478,462],[348,505,398,422]];
    const stars = [[335,285,4],[455,258,3.5],[515,348,4.5],[295,372,3.5],[398,422,4],[478,462,4],[348,505,3.5],[562,390,3]];
    let sig = 0;
    for (const [x1,y1,x2,y2] of edges) sig += lineG(x, y, x1, y1, x2, y2, 5) * 0.42;
    for (const [sx, sy, sr] of stars) sig += gauss(d2(x, y, sx, sy), 0, sr) * 0.72;
    return BG + Math.min(0.9, sig);
  }],

  // 4.1: tre bande orizzontali — le regole semplici rese visibili
  '4.1_regole-semplici': [141, 60000, (x, y) => {
    const inX = x >= 195 && x <= 605;
    return BG + (inX ? gauss(y,360,7)*0.60 + gauss(y,400,7)*0.60 + gauss(y,440,7)*0.60 : 0);
  }],

  // 4.2: 25 cluster uguali sparsi — noi siamo quei punti
  '4.2_noi-siamo-quei-punti': [142, 65000, (x, y) => {
    const pts = [
      [340,280],[400,262],[460,275],[520,258],
      [348,318],[408,305],[465,292],[522,308],
      [325,355],[382,342],[440,330],[498,345],
      [302,392],[360,378],[418,368],[475,382],[530,368],
      [340,415],[398,405],[455,418],[512,405],
      [318,450],[375,440],[432,452],[490,440],
    ];
    const sig = pts.reduce((a, [px, py]) => a + gauss(d2(x, y, px, py), 0, 11) * 0.34, 0);
    return BG + Math.min(0.85, sig);
  }],

  // 4.3: cerchio debolissimo — la tecnologia che sparisce
  '4.3_lai-che-non-si-vede': [143, 40000, (x, y) =>
    0.0008 + ring(x, y, 400, 400, 222, 13) * 0.11
  ],

  // 4.4: arco 270° aperto — cosa resta aperto
  '4.4_cosa-resta-aperto': [144, 65000, (x, y) => {
    const dd = d2(x, y, 400, 400);
    const angle = Math.atan2(y - 400, x - 400);
    const isOpen = angle > -Math.PI / 2 && angle < 0; // top-right quadrant
    return BG + gauss(dd, 222, 11) * (isOpen ? 0 : 0.65);
  }],

  // Conclusione: linea orizzontale — l'orizzonte che resta
  '05_conclusione': [105, 55000, (x, y) => {
    const inX = x >= 115 && x <= 685;
    return 0.0008 + (inX ? gauss(y, 400, 7) * 0.58 : 0);
  }],
};

// ---- Run ----
let total = 0;
for (const [name, [seed, attempts, fn]] of Object.entries(DEFS)) {
  const svg = makeSVG(fn, seed, attempts);
  const n = (svg.match(/<circle/g) || []).length;
  fs.writeFileSync(path.join(__dirname, `${name}.svg`), svg);
  total += n;
  console.log(`✓  ${name}.svg  (${n} dots)`);
}
console.log(`\n   ${Object.keys(DEFS).length} files — ${total} dots total`);
