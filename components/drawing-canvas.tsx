"use client";

import { useCallback, useEffect, useRef } from "react";
import { canvasController, CANVAS_HEIGHT, CANVAS_WIDTH } from "@/lib/canvas/controller";
import { floodFill, hexToRgb } from "@/lib/canvas/flood-fill";
import { useDrawingStore } from "@/stores/drawing-store";

type Point = { x: number; y: number };

function strokePath(ctx: CanvasRenderingContext2D, pts: Point[]) {
  ctx.beginPath();
  if (pts.length === 1) {
    ctx.arc(pts[0].x, pts[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

export function DrawingCanvas({ layout = "workspace" }: { layout?: "workspace" | "cover" }) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const drawing = useRef<{ start: Point; points: Point[]; moved: boolean } | null>(null);
  const tool = useDrawingStore((s) => s.tool);
  const opacity = useDrawingStore((s) => s.opacity);
  const size = useDrawingStore((s) => s.size);

  useEffect(() => {
    canvasController.attach(baseRef.current);
    return () => canvasController.attach(null);
  }, []);

  const toPoint = useCallback((e: { clientX: number; clientY: number }): Point => {
    const rect = baseRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_WIDTH,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_HEIGHT,
    };
  }, []);

  const clearOverlay = () =>
    overlayRef.current!.getContext("2d")!.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  const renderOverlay = useCallback(() => {
    const d = drawing.current;
    if (!d) return;
    const { tool, color, size, shapeFilled } = useDrawingStore.getState();
    const ctx = overlayRef.current!.getContext("2d")!;
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = size;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    const a = d.start;
    const b = d.points[d.points.length - 1];
    if (tool === "brush") {
      strokePath(ctx, d.points);
    } else if (tool === "line") {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else if (tool === "rect") {
      if (shapeFilled) ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      else ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    } else if (tool === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(
        (a.x + b.x) / 2,
        (a.y + b.y) / 2,
        Math.abs(b.x - a.x) / 2,
        Math.abs(b.y - a.y) / 2,
        0,
        0,
        Math.PI * 2,
      );
      if (shapeFilled) ctx.fill();
      else ctx.stroke();
    }
  }, []);

  const eraseSegment = (from: Point, to: Point) => {
    const { size, opacity } = useDrawingStore.getState();
    const ctx = baseRef.current!.getContext("2d", { willReadFrequently: true })!;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = opacity;
    ctx.lineCap = "round";
    ctx.lineWidth = size;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    const p = toPoint(e);
    const state = useDrawingStore.getState();
    if (state.tool === "fill") {
      const ctx = baseRef.current!.getContext("2d", { willReadFrequently: true })!;
      const img = ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      if (floodFill(img, p.x, p.y, hexToRgb(state.color), state.opacity, state.fillTolerance)) {
        ctx.putImageData(img, 0, 0);
        state.addRecentColor(state.color);
        canvasController.commit();
      }
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = { start: p, points: [p], moved: false };
    if (state.tool === "eraser") eraseSegment(p, p);
    else renderOverlay();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const cursor = cursorRef.current;
    if (cursor) {
      const rect = baseRef.current!.getBoundingClientRect();
      cursor.style.transform = `translate(${e.clientX - rect.left}px, ${e.clientY - rect.top}px) translate(-50%, -50%)`;
    }
    const d = drawing.current;
    if (!d) return;
    const native = e.nativeEvent;
    const events = native.getCoalescedEvents?.() ?? [];
    const list = events.length ? events : [native];
    for (const ev of list) {
      const p = toPoint(ev);
      const prev = d.points[d.points.length - 1];
      d.moved = true;
      if (useDrawingStore.getState().tool === "eraser") eraseSegment(prev, p);
      d.points.push(p);
    }
    if (useDrawingStore.getState().tool !== "eraser") renderOverlay();
  };

  const finish = (e: React.PointerEvent) => {
    const d = drawing.current;
    if (!d) return;
    drawing.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    const state = useDrawingStore.getState();
    if (state.tool !== "eraser") {
      const ctx = baseRef.current!.getContext("2d", { willReadFrequently: true })!;
      ctx.save();
      ctx.globalAlpha = state.opacity;
      ctx.drawImage(overlayRef.current!, 0, 0);
      ctx.restore();
      clearOverlay();
      state.addRecentColor(state.color);
    }
    canvasController.commit();
  };

  const showBrushCursor = tool === "brush" || tool === "eraser";

  return (
    <div className={layout === "cover" ? "w-full" : "flex aspect-[4/3] max-h-[70dvh] min-h-0 w-full items-center justify-center [container-type:size] lg:aspect-auto lg:max-h-none lg:h-full"}>
    <div
      className="relative overflow-hidden rounded-lg border bg-white shadow-sm"
      style={{
        aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`,
        width: layout === "cover" ? "100%" : `min(100cqw, calc(100cqh * ${CANVAS_WIDTH / CANVAS_HEIGHT}))`,
      }}
    >
      <canvas
        ref={baseRef}
        data-testid="drawing-canvas"
        aria-label="Drawing canvas"
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="absolute inset-0 h-full w-full touch-none"
        style={{ cursor: showBrushCursor ? "none" : "crosshair" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onPointerLeave={() => {
          if (cursorRef.current) cursorRef.current.style.opacity = "0";
        }}
        onPointerEnter={() => {
          if (cursorRef.current) cursorRef.current.style.opacity = "1";
        }}
      />
      <canvas
        ref={overlayRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ opacity }}
      />
      {showBrushCursor && (
        <div
          ref={cursorRef}
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 rounded-full border border-black/70 opacity-0 mix-blend-difference outline outline-1 outline-white/70"
          style={{ width: `${(size / CANVAS_WIDTH) * 100}%`, aspectRatio: "1" }}
        />
      )}
    </div>
    </div>
  );
}
