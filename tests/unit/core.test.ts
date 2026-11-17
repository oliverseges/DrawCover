import { beforeEach, describe, expect, it } from "vitest";
import { compositeOnWhite } from "@/lib/canvas/export";
import { floodFill } from "@/lib/canvas/flood-fill";
import { History } from "@/lib/canvas/history";
import { useDrawingStore } from "@/stores/drawing-store";

function makeBuffer(w: number, h: number) {
  return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
}

function setPx(b: ReturnType<typeof makeBuffer>, x: number, y: number, rgba: number[]) {
  b.data.set(rgba, (y * b.width + x) * 4);
}

const px = (b: ReturnType<typeof makeBuffer>, x: number, y: number) =>
  Array.from(b.data.slice((y * b.width + x) * 4, (y * b.width + x) * 4 + 4));

describe("drawing store", () => {
  beforeEach(() => {
    useDrawingStore.setState({ size: 8, opacity: 1, fillTolerance: 32 });
  });

  it("clamps size, opacity and tolerance", () => {
    const s = useDrawingStore.getState();
    s.setSize(500);
    expect(useDrawingStore.getState().size).toBe(100);
    s.setSize(-3);
    expect(useDrawingStore.getState().size).toBe(1);
    s.setOpacity(0);
    expect(useDrawingStore.getState().opacity).toBe(0.05);
    s.setFillTolerance(999);
    expect(useDrawingStore.getState().fillTolerance).toBe(128);
  });

  it("tracks undo/redo flags and isEmpty", () => {
    const s = useDrawingStore.getState();
    const snap = (n: number) => ({ n }) as unknown as ImageData;
    s.resetHistory(snap(0));
    expect(useDrawingStore.getState()).toMatchObject({ canUndo: false, canRedo: false, isEmpty: true });
    s.commitHistory(snap(1), false);
    expect(useDrawingStore.getState()).toMatchObject({ canUndo: true, canRedo: false, isEmpty: false });
    expect(s.undo()).toEqual({ n: 0 });
    expect(useDrawingStore.getState()).toMatchObject({ canUndo: false, canRedo: true, isEmpty: true });
    expect(s.redo()).toEqual({ n: 1 });
    // clear is a commit of an empty state, so it can be undone
    s.commitHistory(snap(2), true);
    expect(s.undo()).toEqual({ n: 1 });
    expect(useDrawingStore.getState().isEmpty).toBe(false);
  });
});

describe("History", () => {
  it("keeps at most 30 undo steps", () => {
    const h = new History<number>();
    h.reset(0);
    for (let i = 1; i <= 40; i++) h.commit(i, false);
    let steps = 0;
    while (h.undo()) steps++;
    expect(steps).toBe(30);
  });

  it("drops redo entries on new commit", () => {
    const h = new History<number>();
    h.reset(0);
    h.commit(1, false);
    h.undo();
    h.commit(2, false);
    expect(h.canRedo).toBe(false);
  });
});

describe("floodFill", () => {
  it("fills inside a closed square without leaking", () => {
    const b = makeBuffer(20, 20);
    for (let i = 5; i <= 14; i++) {
      for (const [x, y] of [[i, 5], [i, 14], [5, i], [14, i]]) setPx(b, x, y, [0, 0, 0, 255]);
    }
    expect(floodFill(b, 10, 10, [255, 0, 0], 1, 0)).toBe(true);
    expect(px(b, 10, 10)).toEqual([255, 0, 0, 255]);
    expect(px(b, 6, 6)).toEqual([255, 0, 0, 255]);
    expect(px(b, 2, 2)).toEqual([0, 0, 0, 0]);
    expect(px(b, 5, 5)).toEqual([0, 0, 0, 255]);
  });

  it("respects tolerance", () => {
    const mk = () => {
      const b = makeBuffer(4, 1);
      for (let x = 0; x < 4; x++) setPx(b, x, 0, [100, 100, 100, 255]);
      setPx(b, 2, 0, [110, 100, 100, 255]);
      setPx(b, 3, 0, [100, 100, 100, 255]);
      return b;
    };
    const strict = mk();
    floodFill(strict, 0, 0, [0, 255, 0], 1, 5);
    expect(px(strict, 3, 0)).toEqual([100, 100, 100, 255]);
    const loose = mk();
    floodFill(loose, 0, 0, [0, 255, 0], 1, 20);
    expect(px(loose, 3, 0)).toEqual([0, 255, 0, 255]);
  });

  it("fills a 2000x2000 canvas in under 300ms", () => {
    const b = makeBuffer(2000, 2000);
    const t = performance.now();
    floodFill(b, 1000, 1000, [1, 2, 3], 1, 0);
    expect(performance.now() - t).toBeLessThan(300);
    expect(px(b, 1999, 1999)).toEqual([1, 2, 3, 255]);
  });
});

describe("export", () => {
  it("turns transparent pixels white", () => {
    const d = new Uint8ClampedArray([0, 0, 0, 0, 10, 20, 30, 255]);
    compositeOnWhite(d);
    expect(Array.from(d)).toEqual([255, 255, 255, 255, 10, 20, 30, 255]);
  });
});
