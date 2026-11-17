"use client";

import { useEffect } from "react";
import { canvasController } from "@/lib/canvas/controller";
import { useDrawingStore, type Tool } from "@/stores/drawing-store";

const KEYS: Record<string, Tool> = {
  b: "brush",
  e: "eraser",
  l: "line",
  r: "rect",
  o: "ellipse",
  f: "fill",
};

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (k === "z" && !e.shiftKey) canvasController.undo();
        else if (k === "y" || (k === "z" && e.shiftKey)) canvasController.redo();
        else return;
        e.preventDefault();
        return;
      }
      if (e.altKey) return;
      if (KEYS[k]) useDrawingStore.getState().setTool(KEYS[k]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
