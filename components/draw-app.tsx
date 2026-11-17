"use client";

import { useEffect } from "react";
import { DrawingCanvas } from "@/components/drawing-canvas";
import { soundPlayer } from "@/lib/audio/player";
import { ResultPanel } from "@/components/result-panel";
import { Toolbar } from "@/components/toolbar/toolbar";
import { useShortcuts } from "@/components/toolbar/use-shortcuts";

export function DrawApp() {
  useShortcuts();
  useEffect(() => {
    void soundPlayer.loadConfig();
    return () => soundPlayer.reset();
  }, []);
  return (
    <main className="flex min-h-dvh flex-col gap-3 p-3 lg:h-dvh lg:overflow-hidden lg:p-4">
      <header className="flex items-baseline gap-3">
        <h1 className="text-lg font-semibold tracking-tight">DrawSound</h1>
        <p className="hidden text-sm text-muted-foreground sm:block">
          Draw anything. See what it is, hear what it sounds like.
        </p>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[15rem_minmax(0,1fr)_20rem] lg:gap-4">
        <Toolbar />
        <div className="min-w-0 lg:min-h-0">
          <DrawingCanvas />
        </div>
        <ResultPanel />
      </div>
    </main>
  );
}
