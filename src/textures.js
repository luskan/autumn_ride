import * as THREE from 'three';
import { ROAD } from './config.js';
import { mulberry32 } from './util.js';
import { SIGN, SIGN_COLS, SIGN_ROWS } from './road-signs.js';

const rnd = mulberry32(777);

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, { srgb = true, anisotropy = 1, repeat = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

// Canvas transparency is black, which bleeds dark fringes into alpha-tested
// textures once mipmapped. Rebuild as a DataTexture whose transparent texels
// carry the average opaque color instead.
function bleedTexture(c, anisotropy = 1) {
  const { width: w, height: h } = c;
  const d = c.getContext('2d').getImageData(0, 0, w, h).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] > 128) {
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
      n++;
    }
  }
  r /= n || 1;
  g /= n || 1;
  b /= n || 1;
  const out = new Uint8Array(d.length);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4; // DataTexture rows start at the bottom
    const dst = y * w * 4;
    for (let x = 0; x < w * 4; x += 4) {
      const t = d[src + x + 3] / 255;
      out[dst + x] = d[src + x] * t + r * (1 - t);
      out[dst + x + 1] = d[src + x + 1] * t + g * (1 - t);
      out[dst + x + 2] = d[src + x + 2] * t + b * (1 - t);
      out[dst + x + 3] = d[src + x + 3];
    }
  }
  const tex = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

function speckle(g, x, y, w, h, count, colors, rMin, rMax, alpha = 1) {
  g.globalAlpha = alpha;
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[i % colors.length];
    const r = rMin + rnd() * (rMax - rMin);
    g.fillRect(x + rnd() * w, y + rnd() * h, r, r);
  }
  g.globalAlpha = 1;
}

// Road surface: x = across the road (-half..half), y = along the road (one dash period)
export function makeRoadTexture(anisotropy) {
  const W = 1024, H = 1024;
  const [c, g] = canvas(W, H);
  const ux = (u) => ((u + ROAD.half) / (2 * ROAD.half)) * W;

  g.fillStyle = '#8b8272';
  g.fillRect(0, 0, W, H);
  speckle(g, 0, 0, W, H, 14000, ['#a59b88', '#746c5f', '#b8ad99', '#655e53', '#9a8f7b'], 1, 3);

  const a0 = ux(-ROAD.asphalt), a1 = ux(ROAD.asphalt);
  g.fillStyle = '#5b5c60';
  g.fillRect(a0, 0, a1 - a0, H);
  for (let y = 0; y < H; y += 3) {
    g.fillRect(a0 - rnd() * 6, y, 6, 3);
    g.fillRect(a1, y, rnd() * 6, 3);
  }
  speckle(g, a0, 0, a1 - a0, H, 42000, ['#67686c', '#4f5054', '#727377', '#45464a', '#5f6064'], 0.8, 2);

  // darker, polished wheel tracks
  for (const lc of [-ROAD.laneCenter, ROAD.laneCenter]) {
    for (const o of [-0.82, 0.82]) {
      const x = ux(lc + o);
      const grad = g.createLinearGradient(x - 28, 0, x + 28, 0);
      grad.addColorStop(0, 'rgba(28,28,32,0)');
      grad.addColorStop(0.5, 'rgba(28,28,32,0.2)');
      grad.addColorStop(1, 'rgba(28,28,32,0)');
      g.fillStyle = grad;
      g.fillRect(x - 28, 0, 56, H);
    }
  }

  const band = (u0, u1, color, y0 = 0, y1 = H) => {
    g.fillStyle = color;
    g.fillRect(ux(u0), y0, ux(u1) - ux(u0), y1 - y0);
  };
  const white = '#eceae2';
  band(-ROAD.edgeLine - 0.16, -ROAD.edgeLine, white);
  band(ROAD.edgeLine, ROAD.edgeLine + 0.16, white);
  // Center lines are generated from RoadRules, independently of this repeating asphalt.
  // paint wear
  speckle(g, 0, 0, W, H, 9000, ['#5b5c60', '#6a6b6f'], 0.8, 1.6, 0.35);

  return toTexture(c, { anisotropy, repeat: true });
}

// Grain multiplied over terrain vertex colors (kept close to white)
export function makeGroundDetailTexture() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#efe8da';
  g.fillRect(0, 0, 256, 256);
  g.lineCap = 'round';
  const cols = ['#d9ccb2', '#fffaf0', '#c9b896', '#e6dac0', '#bfae8c'];
  for (let i = 0; i < 2600; i++) {
    g.strokeStyle = cols[i % cols.length];
    g.globalAlpha = 0.35 + rnd() * 0.5;
    g.lineWidth = 0.8 + rnd() * 1.4;
    const x = rnd() * 256, y = rnd() * 256, a = rnd() * Math.PI * 2, l = 2 + rnd() * 7;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  g.globalAlpha = 1;
  return toTexture(c, { repeat: true });
}

// Dry grass tuft with alpha; variant 1 has small wild flowers
export function makeGrassTexture(variant) {
  const W = 256, H = 256;
  const [c, g] = canvas(W, H);
  const cols = ['#ecc86c', '#dcae50', '#f4dc96', '#cf9f46', '#f0d27e', '#c2923f'];
  g.lineCap = 'round';
  for (let i = 0; i < 125; i++) {
    const x0 = W / 2 + (rnd() + rnd() + rnd() - 1.5) * 90;
    const h = 90 + rnd() * 150;
    const lean = (rnd() - 0.5) * 110 + (x0 - W / 2) * 0.5;
    const grad = g.createLinearGradient(0, H, 0, H - h);
    const col = cols[i % cols.length];
    grad.addColorStop(0, '#9a7a3c');
    grad.addColorStop(0.3, col);
    grad.addColorStop(1, col);
    g.strokeStyle = grad;
    g.lineWidth = 1.5 + rnd() * 2.5;
    g.beginPath();
    g.moveTo(x0, H);
    g.quadraticCurveTo(x0 + lean * 0.2, H - h * 0.6, x0 + lean, H - h);
    g.stroke();
    if (rnd() < 0.18) {
      // seed head
      g.fillStyle = '#f0d690';
      g.beginPath();
      g.ellipse(x0 + lean, H - h, 3, 9, Math.atan2(lean, h) * 0.8, 0, Math.PI * 2);
      g.fill();
    }
  }
  if (variant === 1) {
    for (let i = 0; i < 26; i++) {
      const x = 40 + rnd() * 176, y = 40 + rnd() * 120;
      g.strokeStyle = '#7a6a30';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (rnd() - 0.5) * 20, H);
      g.stroke();
      g.fillStyle = rnd() < 0.75 ? '#fbf6ea' : '#c9a6d8';
      for (let k = 0; k < 6; k++) {
        g.beginPath();
        g.arc(x + (rnd() - 0.5) * 12, y + (rnd() - 0.5) * 10, 3 + rnd() * 2.5, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
  return bleedTexture(c, 4);
}

// Maple-like leaf, white so instance colors give the hue
export function makeLeafTexture() {
  const [c, g] = canvas(64, 64);
  g.translate(32, 34);
  g.fillStyle = '#ffffff';
  g.beginPath();
  for (let i = 0; i <= 80; i++) {
    const a = (i / 80) * Math.PI * 2;
    const r = 13 + 13 * Math.pow(Math.abs(Math.cos(a * 2.5)), 0.6);
    const x = Math.sin(a) * r, y = -Math.cos(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.fill();
  g.strokeStyle = 'rgba(120,70,30,0.6)';
  g.lineWidth = 1.5;
  for (const a of [0, 1.25, -1.25, 2.5, -2.5]) {
    g.beginPath();
    g.moveTo(0, 6);
    g.lineTo(Math.sin(a) * 22, -Math.cos(a) * 22);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(0, 6);
  g.lineTo(0, 28);
  g.stroke();
  return bleedTexture(c);
}

export function makeBlobShadowTexture() {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return toTexture(c, { srgb: false });
}

export function makeSparkTexture() {
  const [c, g] = canvas(32, 32);
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,220,150,0.9)');
  grad.addColorStop(1, 'rgba(255,160,60,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return toTexture(c);
}

// Optional real logo: put src/assets/truck-logo.(png|jpg|webp|svg) next to the sources and rebuild.
const customLogo = Object.values(
  import.meta.glob('./assets/truck-logo.{png,jpg,jpeg,webp,svg}', { eager: true, query: '?url', import: 'default' }),
)[0];

// "AutoMapa" wordmark with a map pin above a strip of road
function drawWordmark(g, W, H) {
  const accent = '#e8501e';
  let size = 170;
  const font = (px) => `bold ${px}px "Trebuchet MS", "Segoe UI", Arial, sans-serif`;
  g.font = font(size);
  const pin = 130;
  const gapX = 34;
  let textW = g.measureText('AutoMapa').width;
  const maxW = W - 80 - pin - gapX;
  if (textW > maxW) {
    size *= maxW / textW;
    g.font = font(size);
    textW = g.measureText('AutoMapa').width;
  }
  const x0 = (W - (pin + gapX + textW)) / 2;
  const cy = H * 0.42;

  // pin
  const px = x0 + pin / 2, r = pin * 0.42;
  g.fillStyle = accent;
  g.beginPath();
  g.arc(px, cy - r * 0.35, r, Math.PI * 0.82, Math.PI * 0.18);
  g.lineTo(px, cy + r * 1.75);
  g.closePath();
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(px, cy - r * 0.35, r * 0.42, 0, Math.PI * 2);
  g.fill();

  // wordmark
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  const tx = x0 + pin + gapX;
  g.fillStyle = '#243142';
  g.fillText('Auto', tx, cy);
  g.fillStyle = accent;
  g.fillText('Mapa', tx + g.measureText('Auto').width, cy);

  // road strip with a dashed center line
  const ry = H * 0.8, rh = H * 0.1;
  g.fillStyle = '#2d3138';
  g.fillRect(0, ry, W, rh);
  g.fillStyle = '#f6c344';
  for (let x = 20; x < W; x += 90) g.fillRect(x, ry + rh / 2 - 3, 50, 6);
}

export function makeTruckLogoTexture(anisotropy) {
  const W = 1024, H = 386; // same aspect as the cargo box side panel
  const [c, g] = canvas(W, H);
  const panel = () => {
    const grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#e9ebee');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
  };
  panel();
  drawWordmark(g, W, H);
  const tex = toTexture(c, { anisotropy });
  if (customLogo) {
    const img = new Image();
    img.onload = () => {
      panel();
      const iw = img.naturalWidth || W, ih = img.naturalHeight || H;
      const k = Math.min((W * 0.86) / iw, (H * 0.8) / ih);
      g.drawImage(img, (W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k);
      tex.needsUpdate = true;
    };
    img.src = customLogo;
  }
  return tex;
}

// EU-style number plate (520 x 114 mm); long texts are narrowed to fit the plate.
// Heavy, outlined glyphs so the text stays readable when the plate is small on screen.
export function makePlateTexture(text) {
  const W = 1024, H = 224, eu = 130;
  const [c, g] = canvas(W, H);
  g.fillStyle = '#f7f7f2';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#1d3f9a';
  g.fillRect(0, 0, eu, H);
  g.fillStyle = '#ffd400';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath();
    g.arc(eu / 2 + Math.cos(a) * 36, 70 + Math.sin(a) * 36, 7, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#ffffff';
  g.font = 'bold 64px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillText('PL', eu / 2, 196);
  g.font = 'bold 210px "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
  g.textBaseline = 'middle';
  const maxW = W - eu - 60;
  const k = Math.min(1, maxW / g.measureText(text).width);
  g.save();
  g.translate(eu + (W - eu) / 2, H / 2 + 8);
  g.scale(k, 1);
  g.fillStyle = '#000000';
  g.strokeStyle = '#000000';
  g.lineWidth = 12;
  g.lineJoin = 'round';
  g.strokeText(text, 0, 0);
  g.fillText(text, 0, 0);
  g.restore();
  g.strokeStyle = '#000000';
  g.lineWidth = 10;
  g.strokeRect(5, 5, W - 10, H - 10);
  return toTexture(c, { anisotropy: 16 });
}

// ---- road sign atlas: 4x5 cells of 256 px ----

function trianglePath(g, cx, cy, side, radius) {
  const h = (side * Math.sqrt(3)) / 2;
  const pts = [[cx, cy - (h * 2) / 3], [cx + side / 2, cy + h / 3], [cx - side / 2, cy + h / 3]];
  g.beginPath();
  for (let i = 0; i < 3; i++) {
    const p = pts[i], n = pts[(i + 1) % 3];
    const m = [(p[0] + n[0]) / 2, (p[1] + n[1]) / 2];
    if (i === 0) g.moveTo(m[0], m[1]);
    g.arcTo(n[0], n[1], pts[(i + 2) % 3][0], pts[(i + 2) % 3][1], radius);
  }
  g.closePath();
}

function warningSign(g, x, y, drawSymbol) {
  const cx = x + 128, cy = y + 150;
  g.fillStyle = '#ffffff';
  trianglePath(g, cx, cy, 250, 22);
  g.fill();
  g.fillStyle = '#d2161e';
  trianglePath(g, cx, cy, 240, 20);
  g.fill();
  g.fillStyle = '#f7c600';
  trianglePath(g, cx, cy, 170, 12);
  g.fill();
  g.save();
  g.translate(cx, cy + 10);
  drawSymbol(g);
  g.restore();
}

function curveArrow(g, dir) {
  g.scale(dir, 1);
  g.strokeStyle = '#111';
  g.lineWidth = 11;
  g.lineCap = 'butt';
  g.beginPath();
  g.moveTo(-8, 38);
  g.lineTo(-8, -2);
  g.quadraticCurveTo(-8, -26, 16, -30);
  g.stroke();
  g.fillStyle = '#111';
  g.beginPath();
  g.moveTo(34, -32);
  g.lineTo(12, -46);
  g.lineTo(12, -16);
  g.closePath();
  g.fill();
}

function deer(g) {
  g.fillStyle = '#111';
  g.scale(0.95, 0.95);
  g.beginPath();
  // body leaping to the left
  g.ellipse(4, 6, 24, 10, -0.25, 0, Math.PI * 2);
  g.fill();
  g.lineCap = 'round';
  g.strokeStyle = '#111';
  g.lineWidth = 5;
  const leg = (x0, y0, x1, y1, x2, y2) => {
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
  };
  leg(-14, 10, -30, 16, -40, 10); // front legs stretched forward
  leg(-12, 12, -26, 24, -36, 24);
  leg(22, 8, 32, 22, 44, 30); // hind legs
  leg(20, 12, 28, 26, 36, 36);
  // neck + head
  g.lineWidth = 8;
  g.beginPath();
  g.moveTo(-14, 0);
  g.lineTo(-24, -18);
  g.stroke();
  g.beginPath();
  g.ellipse(-30, -22, 9, 5, 0.5, 0, Math.PI * 2);
  g.fill();
  // antlers
  g.lineWidth = 3;
  leg(-24, -26, -20, -40, -12, -46);
  leg(-21, -36, -28, -44, -30, -50);
  // tail
  g.lineWidth = 4;
  leg(26, 0, 32, -6, 34, -8);
}

function limitSign(g, x, y, text) {
  const cx = x + 128, cy = y + 128;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(cx, cy, 124, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#d2161e';
  g.beginPath();
  g.arc(cx, cy, 118, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(cx, cy, 90, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#111';
  g.font = 'bold 100px "Arial Narrow", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, cx, cy + 6);
}

function chevrons(g, x, y, dir) {
  g.fillStyle = '#d2161e';
  g.fillRect(x + 28, y + 8, 200, 240);
  g.fillStyle = '#ffffff';
  g.save();
  g.translate(x + 128, y + 128);
  g.scale(dir, 1);
  for (const ox of [-62, 0, 62]) {
    g.beginPath();
    g.moveTo(ox - 26, -80);
    g.lineTo(ox + 22, 0);
    g.lineTo(ox - 26, 80);
    g.lineTo(ox - 2, 80);
    g.lineTo(ox + 46, 0);
    g.lineTo(ox - 2, -80);
    g.closePath();
    g.fill();
  }
  g.restore();
}

function overtakingSign(g, x, y, end = false) {
  g.save();
  g.translate(x + 128, y + 128);
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(0, 0, 124, 0, Math.PI * 2); g.fill();
  g.fillStyle = end ? '#a3a3a3' : '#d2161e';
  g.beginPath(); g.arc(0, 0, 118, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(0, 0, end ? 111 : 91, 0, Math.PI * 2); g.fill();
  const car = (cx, color) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(cx - 24, 24); g.lineTo(cx - 24, -8); g.lineTo(cx - 16, -37);
    g.lineTo(cx + 16, -37); g.lineTo(cx + 24, -8); g.lineTo(cx + 24, 24); g.closePath(); g.fill();
    g.fillRect(cx - 21, 20, 10, 13); g.fillRect(cx + 11, 20, 10, 13);
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(cx - 13, -29); g.lineTo(cx + 13, -29);
    g.lineTo(cx + 17, -12); g.lineTo(cx - 17, -12); g.closePath(); g.fill();
    g.fillRect(cx - 16, 5, 8, 5); g.fillRect(cx + 8, 5, 8, 5);
  };
  car(-37, end ? '#929292' : '#d2161e'); car(37, end ? '#929292' : '#171717');
  if (end) {
    g.beginPath(); g.arc(0, 0, 112, 0, Math.PI * 2); g.clip();
    g.strokeStyle = '#3d3d3d'; g.lineWidth = 5;
    for (const shift of [-36, -18, 0, 18, 36]) {
      g.beginPath(); g.moveTo(-130, 130 + shift); g.lineTo(130, -130 + shift); g.stroke();
    }
  }
  g.restore();
}

function distanceSign(g, x, y, rows) {
  const w = 512, h = 256;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.roundRect(x + 6, y + 18, w - 12, h - 36, 18);
  g.fill();
  g.fillStyle = '#16753a';
  g.beginPath();
  g.roundRect(x + 13, y + 25, w - 26, h - 50, 13);
  g.fill();
  g.fillStyle = '#ffffff';
  g.font = 'bold 50px "Arial Narrow", Arial, sans-serif';
  g.textBaseline = 'middle';
  rows.forEach(([name, km], i) => {
    const ry = y + 70 + i * 58;
    g.textAlign = 'left';
    g.fillText(name, x + 40, ry);
    g.textAlign = 'right';
    g.fillText(String(km), x + w - 40, ry);
  });
}

export function makeSignAtlas(anisotropy) {
  const S = 256;
  const [c, g] = canvas(S * SIGN_COLS, S * SIGN_ROWS);
  const at = (cell) => [cell[0] * S, cell[1] * S];

  limitSign(g, ...at(SIGN.limit50), '50');
  limitSign(g, ...at(SIGN.limit70), '70');
  limitSign(g, ...at(SIGN.limit90), '90');
  warningSign(g, ...at(SIGN.curveRight), (gg) => curveArrow(gg, 1));
  warningSign(g, ...at(SIGN.curveLeft), (gg) => curveArrow(gg, -1));
  warningSign(g, ...at(SIGN.deer), deer);
  chevrons(g, ...at(SIGN.chevronRight), 1);
  chevrons(g, ...at(SIGN.chevronLeft), -1);
  overtakingSign(g, ...at(SIGN.noOvertaking));
  overtakingSign(g, ...at(SIGN.endOvertaking), true);

  // backs of signs
  let [x, y] = at(SIGN.backCircle);
  g.fillStyle = '#8e949a';
  g.beginPath();
  g.arc(x + 128, y + 128, 124, 0, Math.PI * 2);
  g.fill();
  [x, y] = at(SIGN.backTriangle);
  trianglePath(g, x + 128, y + 150, 250, 22);
  g.fill();
  [x, y] = at(SIGN.backRect);
  g.fillRect(x + 28, y + 8, 200, 240);
  // the wide sign back is stretched 2:1 onto the quad, so it mirrors the front margins
  [x, y] = at(SIGN.backWide);
  g.fillRect(x + 3, y + 18, 250, 220);

  distanceSign(g, ...at(SIGN.distA), [['Gorlice', 12], ['Nowy Sącz', 38], ['Kraków', 112]]);
  distanceSign(g, ...at(SIGN.distB), [['Biecz', 7], ['Jasło', 29], ['Krosno', 54]]);

  return bleedTexture(c, anisotropy);
}
