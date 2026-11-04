// Image clean-up before text recognition: grey → black/white, then remove table rules (long
// horizontal or vertical runs of dark pixels) that the recogniser would read as | ] _ characters.
export function cleanForOcr(gray: Uint8ClampedArray | Uint8Array, w: number, h: number, minRun = Math.round(w / 25)): Uint8ClampedArray {
  // Otsu threshold
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = gray.length - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; thr = t; }
  }
  const dark = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) dark[i] = gray[i] <= thr ? 1 : 0;
  const erase = new Uint8Array(w * h);
  // horizontal rules
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!dark[y * w + x]) { x++; continue; }
      let e = x; while (e < w && dark[y * w + e]) e++;
      if (e - x >= minRun) for (let k = x; k < e; k++) erase[y * w + k] = 1;
      x = e;
    }
  }
  // vertical rules (a little shorter: rows of a table are tall)
  const minV = Math.round(minRun * 0.8);
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (!dark[y * w + x]) { y++; continue; }
      let e = y; while (e < h && dark[e * w + x]) e++;
      if (e - y >= minV) for (let k = y; k < e; k++) erase[k * w + x] = 1;
      y = e;
    }
  }
  // widen the erased rules by one pixel (anti-aliased edges)
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const near = erase[i] || (x > 0 && erase[i - 1]) || (x < w - 1 && erase[i + 1]) || (y > 0 && erase[i - w]) || (y < h - 1 && erase[i + w]);
    out[i] = dark[i] && !near ? 0 : 255;
  }
  return out;
}
