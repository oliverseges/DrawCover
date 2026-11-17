export type PixelBuffer = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

export type Rgb = readonly [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Scanline flood fill. Fills the contiguous region around (x, y) whose pixels are
 * within `tolerance` (max per-channel difference, RGBA) of the seed pixel, blending
 * `color` over it with `opacity`. Returns false when nothing was changed.
 */
export function floodFill(
  img: PixelBuffer,
  x: number,
  y: number,
  color: Rgb,
  opacity: number,
  tolerance: number,
): boolean {
  const { data, width, height } = img;
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= width || y >= height || opacity <= 0) return false;

  const s = (y * width + x) * 4;
  const sr = data[s], sg = data[s + 1], sb = data[s + 2], sa = data[s + 3];

  const matches = (i: number) =>
    Math.abs(data[i] - sr) <= tolerance &&
    Math.abs(data[i + 1] - sg) <= tolerance &&
    Math.abs(data[i + 2] - sb) <= tolerance &&
    Math.abs(data[i + 3] - sa) <= tolerance;

  const visited = new Uint8Array(width * height);
  const stack: number[] = [x, y];
  const spans: number[] = [];

  const scan = (row: number, from: number, to: number) => {
    let inSpan = false;
    for (let cx = from; cx <= to; cx++) {
      const idx = row * width + cx;
      const ok = !visited[idx] && matches(idx * 4);
      if (ok && !inSpan) {
        stack.push(cx, row);
        inSpan = true;
      } else if (!ok) {
        inSpan = false;
      }
    }
  };

  while (stack.length) {
    const cy = stack.pop()!;
    const cx0 = stack.pop()!;
    if (visited[cy * width + cx0] || !matches((cy * width + cx0) * 4)) continue;
    let left = cx0;
    let right = cx0;
    while (left > 0 && !visited[cy * width + left - 1] && matches((cy * width + left - 1) * 4)) left--;
    while (right < width - 1 && !visited[cy * width + right + 1] && matches((cy * width + right + 1) * 4)) right++;
    for (let cx = left; cx <= right; cx++) visited[cy * width + cx] = 1;
    spans.push(left, right, cy);
    if (cy > 0) scan(cy - 1, left, right);
    if (cy < height - 1) scan(cy + 1, left, right);
  }

  for (let i = 0; i < spans.length; i += 3) {
    const row = spans[i + 2];
    for (let cx = spans[i]; cx <= spans[i + 1]; cx++) {
      const p = (row * width + cx) * 4;
      const da = data[p + 3] / 255;
      const outA = opacity + da * (1 - opacity);
      for (let c = 0; c < 3; c++) {
        data[p + c] = Math.round(
          (color[c] * opacity + data[p + c] * da * (1 - opacity)) / outA,
        );
      }
      data[p + 3] = Math.round(outA * 255);
    }
  }
  return spans.length > 0;
}
