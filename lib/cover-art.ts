export async function stylizeDrawing(image: string, palette: [string, string, string]): Promise<string> {
  const drawing = new Image();
  drawing.src = image;
  await drawing.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1000;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser couldn't create the album artwork.");
  const background = ctx.createLinearGradient(0, 0, 1000, 1000);
  background.addColorStop(0, palette[0]);
  background.addColorStop(1, palette[1]);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 1000, 1000);
  ctx.fillStyle = palette[2];
  ctx.globalAlpha = 0.22;
  ctx.beginPath();
  ctx.arc(700, 300, 360, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  const ink = document.createElement("canvas");
  ink.width = drawing.width;
  ink.height = drawing.height;
  const inkCtx = ink.getContext("2d");
  if (!inkCtx) throw new Error("Your browser couldn't transform the drawing.");
  inkCtx.drawImage(drawing, 0, 0);
  const pixels = inkCtx.getImageData(0, 0, ink.width, ink.height);
  const color = palette[2].match(/[a-f\d]{2}/gi)!.map((part) => parseInt(part, 16));
  for (let i = 0; i < pixels.data.length; i += 4) {
    const brightness = (pixels.data[i] + pixels.data[i + 1] + pixels.data[i + 2]) / 3;
    pixels.data[i + 3] = Math.round(pixels.data[i + 3] * (1 - brightness / 255));
    pixels.data[i] = color[0];
    pixels.data[i + 1] = color[1];
    pixels.data[i + 2] = color[2];
  }
  inkCtx.putImageData(pixels, 0, 0);
  const scale = 820 / Math.max(ink.width, ink.height);
  ctx.shadowColor = palette[2];
  ctx.shadowBlur = 18;
  ctx.drawImage(ink, (1000 - ink.width * scale) / 2, (1000 - ink.height * scale) / 2, ink.width * scale, ink.height * scale);
  return canvas.toDataURL("image/png");
}
