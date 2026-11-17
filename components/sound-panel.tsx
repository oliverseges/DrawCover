"use client";

import { Play, RotateCcw, Square, Volume2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { soundPlayer } from "@/lib/audio/player";
import { useSoundStore } from "@/stores/sound-store";

const STATUS_TEXT = {
  idle: "",
  loading: "Finding the sound…",
  playing: "Playing",
  stopped: "Stopped",
  blocked: "Autoplay was blocked. Press Play to hear it.",
  unavailable: "Audio is unavailable.",
} as const;

export function SoundPanel({ phrase }: { phrase?: string }) {
  const status = useSoundStore((s) => s.status);
  const source = useSoundStore((s) => s.source);
  const message = useSoundStore((s) => s.message);
  if (status === "idle") return null;

  const loading = status === "loading";
  const playing = status === "playing";
  const replay = status === "stopped";

  return (
    <section
      aria-label="Sound"
      data-testid="sound-panel"
      className="flex flex-col gap-2 rounded-lg border p-3"
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <Volume2 className="size-4" aria-hidden />
        Sound{phrase ? `: ${phrase}` : ""}
      </div>
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground" data-testid="sound-status">
        {message ?? STATUS_TEXT[status]}
      </p>
      {status === "unavailable" && (
        <p role="alert" className="text-xs text-destructive" data-testid="sound-error">
          Couldn’t produce any audio. The recognition result is still valid.
        </p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => soundPlayer.play()}
          disabled={loading || playing || !source}
          aria-label={replay ? "Replay sound" : "Play sound"}
        >
          {replay ? <RotateCcw /> : <Play />}
          {replay ? "Replay" : "Play"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => soundPlayer.stop()}
          disabled={!(playing || loading)}
          aria-label="Stop sound"
        >
          <Square />
          Stop
        </Button>
      </div>
      {source?.kind === "recording" && (
        <div className="flex flex-col gap-1 text-xs" data-testid="sound-source">
          <Badge variant="secondary" className="w-fit">Real recording (Wikimedia Commons)</Badge>
          <span>
            “{source.recording.title}” by {source.recording.credit}, {source.recording.license}.{" "}
            <a
              href={source.recording.pageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Source
            </a>
          </span>
        </div>
      )}
      {source?.kind === "synth" && (
        <div className="flex flex-col gap-1 text-xs" data-testid="sound-source">
          <Badge variant="outline" className="w-fit">Synthesized approximation (not a real recording)</Badge>
          <span className="text-muted-foreground">{source.reason}</span>
        </div>
      )}
    </section>
  );
}
