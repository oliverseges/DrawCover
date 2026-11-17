"use client";

import { Play, RotateCcw, Square, Volume2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { soundPlayer } from "@/lib/audio/player";
import { useSoundStore, type SoundPreference } from "@/stores/sound-store";

const STATUS_TEXT = {
  idle: "",
  loading: "Finding the sound…",
  playing: "Playing",
  stopped: "Stopped",
  blocked: "Autoplay was blocked. Press Play to hear it.",
  unavailable: "Audio is unavailable.",
} as const;

const OPTIONS: { value: SoundPreference; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "generated", label: "AI-generated" },
  { value: "recording", label: "Recording" },
  { value: "synth", label: "Synth" },
];

export function SoundPanel({ phrase }: { phrase?: string }) {
  const status = useSoundStore((s) => s.status);
  const source = useSoundStore((s) => s.source);
  const note = useSoundStore((s) => s.note);
  const message = useSoundStore((s) => s.message);
  const preference = useSoundStore((s) => s.preference);
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
          Couldn’t produce any audio. The recognition result is still valid. Try another source below.
        </p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={() => soundPlayer.play()}
          disabled={loading || playing}
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
      <div role="radiogroup" aria-label="Sound source" className="flex flex-wrap gap-1" data-testid="sound-source-select">
        {OPTIONS.map((o) => (
          <Button
            key={o.value}
            size="xs"
            role="radio"
            aria-checked={preference === o.value}
            variant={preference === o.value ? "default" : "outline"}
            onClick={() => soundPlayer.setPreference(o.value)}
          >
            {o.label}
          </Button>
        ))}
      </div>
      {source && (
        <div className="flex flex-col gap-1 text-xs" data-testid="sound-source">
          {source.kind === "generated" && (
            <>
              <Badge variant="secondary" className="w-fit">AI-generated audio</Badge>
              <span className="text-muted-foreground">
                Made by {source.model} via OpenRouter. This is a music model, so it may sound musical rather
                than a pure sound effect.
              </span>
            </>
          )}
          {source.kind === "recording" && (
            <>
              <Badge variant="secondary" className="w-fit">Real recording (Wikimedia Commons)</Badge>
              <span>
                “{source.recording.title}” by {source.recording.credit}, {source.recording.license}.{" "}
                <a href={source.recording.pageUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  Source
                </a>
              </span>
            </>
          )}
          {source.kind === "synth" && (
            <Badge variant="outline" className="w-fit">Synthesized approximation (not a real recording)</Badge>
          )}
          {note && <span className="text-muted-foreground" data-testid="sound-note">{note}</span>}
        </div>
      )}
    </section>
  );
}
