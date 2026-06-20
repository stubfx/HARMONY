// RGB image → CMYK TIFF converter (FOGRA39-ready)

const canvas = document.getElementById('grid');
const ctx    = canvas.getContext('2d');

let imageBitmap = null;
let iccData     = null;
let currentName = '';

// ── Canvas / preview ──────────────────────────────────────────────────────────
function setSize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  drawPreview();
}

function drawPreview() {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!imageBitmap) return;
  const scale = Math.min(canvas.width / imageBitmap.width, canvas.height / imageBitmap.height);
  const w = imageBitmap.width  * scale;
  const h = imageBitmap.height * scale;
  ctx.drawImage(imageBitmap, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
}

// ── Load image ────────────────────────────────────────────────────────────────
async function loadImage(file) {
  currentName = file.name.replace(/\.[^.]+$/, '');
  imageBitmap = await createImageBitmap(file);
  document.getElementById('file-name').textContent = file.name;
  document.getElementById('btn-export').disabled = false;
  drawPreview();
}

// ── ICC profile ───────────────────────────────────────────────────────────────
async function loadICC(file) {
  iccData = new Uint8Array(await file.arrayBuffer());
  document.getElementById('icc-name').textContent = file.name;
  document.getElementById('btn-clear-icc').hidden = false;
}

function clearICC() {
  iccData = null;
  document.getElementById('icc-name').textContent = '—';
  document.getElementById('btn-clear-icc').hidden = true;
}

// ── RGB → CMYK ────────────────────────────────────────────────────────────────
// Naive conversion + FOGRA39 TAC limit (330 %)
function rgbToCMYK(r, g, b) {
  const R = r / 255, G = g / 255, B = b / 255;
  const K = 1 - Math.max(R, G, B);
  if (K > 254 / 255) return [0, 0, 0, 255]; // pure black
  const d = 1 - K;
  const C = (1 - R - K) / d;
  const M = (1 - G - K) / d;
  const Y = (1 - B - K) / d;
  // Scale all channels if TAC > 330 %
  const tac   = C + M + Y + K;        // normalised [0..4], 1.0 = 100 %
  const scale = tac > 3.3 ? 3.3 / tac : 1;
  return [
    Math.round(C * scale * 255),
    Math.round(M * scale * 255),
    Math.round(Y * scale * 255),
    Math.round(K * scale * 255),
  ];
}

// ── TIFF encoder ──────────────────────────────────────────────────────────────
// Without ICC (14 entries):
//   header(8) + IFD(174) + BPS(8) + XRes(8) + YRes(8) = 206 → image
// With ICC (15 entries):
//   header(8) + IFD(186) + BPS(8) + XRes(8) + YRes(8) + ICC(N) → image
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

  u8(0x49); u8(0x49); u16(42); u32(8); // header

  u16(nEnt);
  ent(256, 4, 1, w);
  ent(257, 4, 1, h);
  ent(258, 3, 4, bpsOff);              // BitsPerSample → [8,8,8,8]
  ent(259, 3, 1, 1);                   // Compression: none
  ent(262, 3, 1, 5);                   // PhotometricInterpretation: CMYK
  ent(273, 4, 1, imgOff);              // StripOffsets
  ent(277, 3, 1, 4);                   // SamplesPerPixel
  ent(278, 4, 1, h);                   // RowsPerStrip
  ent(279, 4, 1, imgSz);              // StripByteCounts
  ent(282, 5, 1, xResOff);            // XResolution → 300/1
  ent(283, 5, 1, yResOff);            // YResolution → 300/1
  ent(284, 3, 1, 1);                   // PlanarConfiguration: chunky
  ent(296, 3, 1, 2);                   // ResolutionUnit: inch
  ent(332, 3, 1, 1);                   // InkSet: CMYK
  if (hasICC) ent(34675, 1, icc.length, iccOff); // ICCProfile
  u32(0);

  p = bpsOff; u16(8); u16(8); u16(8); u16(8);
  p = xResOff; u32(300); u32(1);
  p = yResOff; u32(300); u32(1);
  if (hasICC) new Uint8Array(buf, iccOff, icc.length).set(icc);
  new Uint8Array(buf, imgOff).set(cmykData);
  return buf;
}

// ── Export ────────────────────────────────────────────────────────────────────
function exportCMYK() {
  const defName = currentName || 'image';
  const name    = prompt('Export filename (without extension):', defName);
  if (name === null) return;

  // Render image at native resolution
  const iw = imageBitmap.width, ih = imageBitmap.height;
  const oc   = new OffscreenCanvas(iw, ih);
  const octx = oc.getContext('2d');
  octx.drawImage(imageBitmap, 0, 0, iw, ih);
  const px = octx.getImageData(0, 0, iw, ih).data; // RGBA

  const cmyk = new Uint8Array(iw * ih * 4);
  for (let i = 0; i < iw * ih; i++) {
    const [C, M, Y, K] = rgbToCMYK(px[i*4], px[i*4+1], px[i*4+2]);
    cmyk[i*4]   = C;
    cmyk[i*4+1] = M;
    cmyk[i*4+2] = Y;
    cmyk[i*4+3] = K;
  }

  const buf  = buildTIFF(iw, ih, cmyk, iccData);
  const blob = new Blob([buf], { type: 'image/tiff' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url,
    download: (name || defName).replace(/\.tiff?$/i, '') + '.tiff',
  });
  a.click();
  URL.revokeObjectURL(url);
}

// ── Toolbar ───────────────────────────────────────────────────────────────────
document.getElementById('file-input').addEventListener('change', e => {
  const f = e.target.files[0]; if (f) loadImage(f);
});
document.getElementById('icc-input').addEventListener('change', e => {
  const f = e.target.files[0]; if (f) loadICC(f);
});
document.getElementById('btn-clear-icc').addEventListener('click', clearICC);
document.getElementById('btn-export').addEventListener('click', exportCMYK);

// ── Boot ─────────────────────────────────────────────────────────────────────
setSize();
window.addEventListener('resize', setSize);
