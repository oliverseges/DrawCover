export const MAX_EXPORT_SIDE = 1024;

/** Blends every pixel over opaque white, in place. */
export function compositeOnWhite(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    data[i] = Math.round(data[i] * a + 255 * (1 - a));
    data[i + 1] = Math.round(data[i + 1] * a + 255 * (1 - a));
    data[i + 2] = Math.round(data[i + 2] * a + 255 * (1 - a));
    data[i + 3] = 255;
  }
}

export function isBufferEmpty(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return false;
  return true;
}

export function exportCanvasToDataUrl(source: HTMLCanvasElement): string {
  const ctx = source.getContext("2d")!;
  const img = ctx.getImageData(0, 0, source.width, source.height);
  compositeOnWhite(img.data);
  const flat = document.createElement("canvas");
  flat.width = source.width;
  flat.height = source.height;
  flat.getContext("2d")!.putImageData(img, 0, 0);

  const scale = Math.min(1, MAX_EXPORT_SIDE / Math.max(source.width, source.height));
  if (scale === 1) return flat.toDataURL("image/png");
  const out = document.createElement("canvas");
  out.width = Math.round(source.width * scale);
  out.height = Math.round(source.height * scale);
  out.getContext("2d")!.drawImage(flat, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}
