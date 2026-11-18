import { exportCanvasToDataUrl, isBufferEmpty } from "@/lib/canvas/export";
import { soundPlayer } from "@/lib/audio/player";
import { useDrawingStore } from "@/stores/drawing-store";

export const CANVAS_WIDTH = 800;
export const CANVAS_HEIGHT = 600;

let canvas: HTMLCanvasElement | null = null;
let coverDraft: ImageData | null = null;
let preserveDraft = false;

const ctx = () => canvas?.getContext("2d", { willReadFrequently: true }) ?? null;

function restore(snapshot: ImageData | null) {
  if (snapshot) ctx()?.putImageData(snapshot, 0, 0);
}

export const canvasController = {
  attach(el: HTMLCanvasElement | null, preserve = false) {
    if (!el && preserveDraft) coverDraft = ctx()?.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT) ?? coverDraft;
    canvas = el;
    preserveDraft = preserve;
    const c = ctx();
    if (el && c) {
      if (preserve && coverDraft) c.putImageData(coverDraft, 0, 0);
      else useDrawingStore.getState().resetHistory(c.getImageData(0, 0, el.width, el.height));
      if (!preserve) coverDraft = null;
    }
  },

  /** Snapshot the base canvas into history after a drawing operation. */
  commit() {
    const c = ctx();
    if (!canvas || !c) return;
    const snap = c.getImageData(0, 0, canvas.width, canvas.height);
    useDrawingStore.getState().commitHistory(snap, isBufferEmpty(snap.data));
  },

  undo() {
    restore(useDrawingStore.getState().undo());
  },

  redo() {
    restore(useDrawingStore.getState().redo());
  },

  clear() {
    const c = ctx();
    if (!canvas || !c) return;
    c.clearRect(0, 0, canvas.width, canvas.height);
    soundPlayer.stop();
    this.commit();
  },

  exportDataUrl(): string | null {
    return canvas ? exportCanvasToDataUrl(canvas) : null;
  },

  download() {
    const url = this.exportDataUrl();
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = "drawing.png";
    a.click();
  },

  async recognize() {
    const url = this.exportDataUrl();
    if (url) await useDrawingStore.getState().recognize(url);
  },
};
