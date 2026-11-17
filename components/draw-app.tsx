"use client";

import { DrawingCanvas } from "@/components/drawing-canvas";
import { ResultPanel } from "@/components/result-panel";
import { Toolbar } from "@/components/toolbar/toolbar";
import { useShortcuts } from "@/components/toolbar/use-shortcuts";

export function DrawApp() {
  useShortcuts();
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-4 lg:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">DrawSound</h1>
        <p className="text-sm text-muted-foreground">
          Draw anything and let Gemini guess what it is.
        </p>
      </header>
      <div className="flex flex-1 flex-col gap-4 lg:flex-row lg:items-start">
        <Toolbar />
        <div className="min-w-0 flex-1">
          <DrawingCanvas />
        </div>
        <ResultPanel />
      </div>
    </main>
  );
}
