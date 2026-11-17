import { create } from "zustand";
import { History } from "@/lib/canvas/history";
import type { RecognitionResult } from "@/lib/recognition";

export type Tool = "brush" | "eraser" | "line" | "rect" | "ellipse" | "fill";

export type Recognition =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; result: RecognitionResult }
  | { status: "error"; message: string };

export const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));

const MAX_RECENT_COLORS = 8;

// Snapshots are large; they live outside reactive state. Only flags are reactive.
const history = new History<ImageData>();

type DrawingState = {
  tool: Tool;
  color: string;
  recentColors: string[];
  size: number;
  opacity: number;
  shapeFilled: boolean;
  fillTolerance: number;
  canUndo: boolean;
  canRedo: boolean;
  isEmpty: boolean;
  recognition: Recognition;

  setTool: (tool: Tool) => void;
  setColor: (color: string) => void;
  addRecentColor: (color: string) => void;
  setSize: (size: number) => void;
  setOpacity: (opacity: number) => void;
  setShapeFilled: (filled: boolean) => void;
  setFillTolerance: (tolerance: number) => void;

  resetHistory: (snapshot: ImageData) => void;
  commitHistory: (snapshot: ImageData, empty: boolean) => void;
  undo: () => ImageData | null;
  redo: () => ImageData | null;

  setRecognition: (r: Recognition) => void;
  recognize: (image: string) => Promise<void>;
};

export const useDrawingStore = create<DrawingState>((set, get) => {
  const flags = () => ({ canUndo: history.canUndo, canRedo: history.canRedo });
  return {
    tool: "brush",
    color: "#111827",
    recentColors: [],
    size: 8,
    opacity: 1,
    shapeFilled: false,
    fillTolerance: 32,
    canUndo: false,
    canRedo: false,
    isEmpty: true,
    recognition: { status: "idle" },

    setTool: (tool) => set({ tool }),
    setColor: (color) => set({ color }),
    addRecentColor: (color) =>
      set((s) => ({
        recentColors: [color, ...s.recentColors.filter((c) => c !== color)].slice(
          0,
          MAX_RECENT_COLORS,
        ),
      })),
    setSize: (size) => set({ size: Math.round(clamp(size, 1, 100)) }),
    setOpacity: (opacity) => set({ opacity: clamp(opacity, 0.05, 1) }),
    setShapeFilled: (shapeFilled) => set({ shapeFilled }),
    setFillTolerance: (t) => set({ fillTolerance: Math.round(clamp(t, 0, 128)) }),

    resetHistory: (snapshot) => {
      history.reset(snapshot, true);
      set({ ...flags(), isEmpty: true });
    },
    commitHistory: (snapshot, empty) => {
      history.commit(snapshot, empty);
      set({ ...flags(), isEmpty: empty });
    },
    undo: () => {
      const entry = history.undo();
      if (!entry) return null;
      set({ ...flags(), isEmpty: entry.empty });
      return entry.snapshot;
    },
    redo: () => {
      const entry = history.redo();
      if (!entry) return null;
      set({ ...flags(), isEmpty: entry.empty });
      return entry.snapshot;
    },

    setRecognition: (recognition) => set({ recognition }),
    recognize: async (image) => {
      if (get().recognition.status === "loading") return;
      set({ recognition: { status: "loading" } });
      try {
        const res = await fetch("/api/recognize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          set({
            recognition: {
              status: "error",
              message: body?.message ?? `Request failed (${res.status}).`,
            },
          });
          return;
        }
        set({ recognition: { status: "success", result: body } });
      } catch {
        set({
          recognition: {
            status: "error",
            message: "Couldn't reach the server. Check your connection and try again.",
          },
        });
      }
    },
  };
});
