import type { Album } from "@/lib/drawcover";

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function oneLine(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return text;
  let shortened = text;
  while (shortened && ctx.measureText(`${shortened}...`).width > width) shortened = shortened.slice(0, -1);
  return `${shortened}...`;
}

function contentNote(ctx: CanvasRenderingContext2D, x: number, y: number, width: number) {
  ctx.fillStyle = "#eeeae0";
  ctx.fillRect(x, y, width, width * .44);
  ctx.fillStyle = "#13171b";
  ctx.fillRect(x + 4, y + 4, width - 8, width * .12);
  ctx.textAlign = "center";
  ctx.font = `700 ${width * .071}px sans-serif`;
  ctx.fillStyle = "#fff";
  ctx.fillText("CONTENT NOTE", x + width / 2, y + width * .095);
  ctx.fillStyle = "#13171b";
  ctx.font = `900 ${width * .095}px sans-serif`;
  ctx.fillText("INSTRUMENTAL", x + width / 2, y + width * .29);
  ctx.font = `600 ${width * .055}px sans-serif`;
  ctx.fillText("NO LYRICS REQUESTED", x + width / 2, y + width * .39);
  ctx.textAlign = "left";
}

export async function albumFaces(album: Album): Promise<[HTMLCanvasElement, HTMLCanvasElement]> {
  const image = new Image();
  image.src = album.cover.dataUrl!;
  await image.decode();
  await document.fonts.ready;
  const front = document.createElement("canvas");
  const back = document.createElement("canvas");
  front.width = back.width = front.height = back.height = 1024;
  const ctx = front.getContext("2d");
  const rear = back.getContext("2d");
  if (!ctx || !rear) throw new Error("Album print textures couldn't be created.");
  ctx.drawImage(image, 0, 0, 1024, 1024);
  const shade = ctx.createLinearGradient(0, 0, 0, 1024);
  shade.addColorStop(0, "#00000020");
  shade.addColorStop(.35, "#00000000");
  shade.addColorStop(1, "#000000e0");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, 1024, 1024);
  ctx.fillStyle = "#fff";
  ctx.font = "500 22px sans-serif";
  ctx.fillText(oneLine(ctx, (album.artist || "DrawCover Sessions").toUpperCase(), 840), 80, 90);
  let fontSize = 110;
  let title: string[];
  do {
    ctx.font = `700 ${fontSize}px sans-serif`;
    title = wrap(ctx, album.title, 850);
    if (title.length <= 3 && title.every((line) => ctx.measureText(line).width <= 850)) break;
    fontSize -= 4;
  } while (fontSize > 34);
  title.slice(0, 3).forEach((line, index) => ctx.fillText(line, 76, 820 - (Math.min(title.length, 3) - 1 - index) * fontSize * .98));
  ctx.font = "500 13px monospace";
  ctx.fillText("AN ORIGINAL RECORD / DRAWN BY YOU", 80, 942);
  ctx.fillText("DC / 001", 840, 90);
  contentNote(ctx, 744, 874, 200);

  rear.fillStyle = album.palette[0];
  rear.fillRect(0, 0, 1024, 1024);
  rear.globalAlpha = .32;
  rear.drawImage(image, 0, 0, 1024, 1024);
  rear.globalAlpha = 1;
  const backShade = rear.createLinearGradient(0, 0, 1024, 1024);
  backShade.addColorStop(0, "#080c13a8");
  backShade.addColorStop(1, "#080c13e8");
  rear.fillStyle = backShade;
  rear.fillRect(0, 0, 1024, 1024);
  rear.fillStyle = "#dce4df";
  rear.font = "500 14px monospace";
  rear.fillText("SIDE A / THE COMPLETE RECORD", 80, 85);
  rear.font = "600 48px sans-serif";
  rear.fillStyle = "#fff";
  wrap(rear, album.title, 850).slice(0, 2).forEach((line, index) => rear.fillText(line, 78, 152 + index * 50));
  rear.font = "400 20px sans-serif";
  rear.fillText(oneLine(rear, album.artist || "DrawCover Sessions", 850), 80, 238);
  album.tracks.forEach((track, index) => {
    const y = 325 + index * 64;
    rear.fillStyle = "#ffffff90";
    rear.font = "400 16px monospace";
    rear.fillText(String(index + 1).padStart(2, "0"), 80, y);
    rear.fillText("0:30", 886, y);
    rear.fillStyle = "#fff";
    rear.font = "400 24px sans-serif";
    rear.fillText(oneLine(rear, track.title, 700), 135, y);
    rear.fillStyle = "#ffffff25";
    rear.fillRect(80, y + 18, 864, 1);
  });
  rear.fillStyle = "#ffffffb0";
  rear.font = "700 20px sans-serif";
  rear.fillText("DRAWCOVER", 80, 907);
  rear.font = "400 10px monospace";
  rear.fillText("\u00a9 & \u2117 2026 DRAWCOVER RECORDS / FICTIONAL RELEASE", 80, 938);
  contentNote(rear, 565, 879, 170);
  rear.fillStyle = "#eeeae0";
  for (let index = 0, x = 800; index < 35; index++) {
    const width = 1 + (index * 7 % 4);
    rear.fillRect(x, 892, width, 45);
    x += width + 1;
  }
  return [front, back];
}
