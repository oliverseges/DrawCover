"use client";

import { useState, type CSSProperties } from "react";
import { ArrowLeft, Brush, Circle, Eraser, LoaderCircle, Minus, PaintBucket, Pause, Play, Redo2, Square, Trash2, Undo2 } from "lucide-react";
import { AlbumAmbient, AlbumTracklist } from "@/components/album-effects";
import { AlbumJacket } from "@/components/album-jacket";
import { showGenerationLimit } from "@/components/generation-limit-toast";
import { RecordingStatus } from "@/components/recording-status";
import { generationRequest } from "@/lib/generation-request";
import { DrawingCanvas } from "@/components/drawing-canvas";
import { useAlbumPlayer } from "@/components/use-album-player";
import { useShortcuts } from "@/components/toolbar/use-shortcuts";
import { canvasController } from "@/lib/canvas/controller";
import { stylizeDrawing } from "@/lib/cover-art";
import type { Album } from "@/lib/drawcover";
import { useDrawingStore, type Tool } from "@/stores/drawing-store";

const tools: { id: Tool; label: string; icon: typeof Brush }[] = [
  { id: "brush", label: "Brush", icon: Brush },
  { id: "eraser", label: "Eraser", icon: Eraser },
  { id: "line", label: "Line", icon: Minus },
  { id: "rect", label: "Rectangle", icon: Square },
  { id: "ellipse", label: "Ellipse", icon: Circle },
  { id: "fill", label: "Fill", icon: PaintBucket },
];

export function DrawCover() {
  useShortcuts();
  const drawing = useDrawingStore();
  const [album, setAlbum] = useState<Album | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const { audioRef, tracks, active, loading: trackLoading, notice, select } = useAlbumPlayer(album);

  async function go() {
    if (loading || drawing.isEmpty) return;
    const image = canvasController.exportDataUrl();
    if (!image) return;
    setLoading(true);
    setError("");
    try {
      const { response, body } = await generationRequest<Album>("/api/drawcover", { image });
      if (showGenerationLimit(response, body)) return;
      if (!response.ok) throw new Error(body.message || "Your record couldn't be made. Please try again.");
      const result: Album = body;
      if (!result.cover.dataUrl) result.cover.dataUrl = await stylizeDrawing(image, result.palette);
      setAlbum(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't reach the studio. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const theme = album ? {
    "--album-a": album.palette[0],
    "--album-b": album.palette[1],
    "--album-c": album.palette[2],
  } as CSSProperties : undefined;

  return (
    <main className={`drawcover ${album ? "has-album" : ""}`} style={theme}>
      {!album ? (
        <section className="drawing-room" aria-label="Draw your record">
          <div className="cover-toolbar" aria-label="Drawing tools" role="toolbar">
            <div className="tool-group">
              {tools.map(({ id, label, icon: Icon }) => (
                <button key={id} type="button" aria-label={label} title={label} aria-pressed={drawing.tool === id} onClick={() => drawing.setTool(id)} disabled={loading}><Icon size={18} /></button>
              ))}
            </div>
            <div className="tool-group tool-settings">
              <input aria-label="Ink color" type="color" value={drawing.color} onChange={(e) => drawing.setColor(e.target.value)} disabled={loading} />
              <input aria-label="Brush size" type="range" min="1" max="60" value={drawing.size} onChange={(e) => drawing.setSize(Number(e.target.value))} disabled={loading} />
              <button type="button" aria-label="Undo" title="Undo" onClick={() => canvasController.undo()} disabled={!drawing.canUndo || loading}><Undo2 size={17} /></button>
              <button type="button" aria-label="Redo" title="Redo" onClick={() => canvasController.redo()} disabled={!drawing.canRedo || loading}><Redo2 size={17} /></button>
              <button type="button" aria-label="Clear drawing" title="Clear drawing" onClick={() => canvasController.clear()} disabled={drawing.isEmpty || loading}><Trash2 size={17} /></button>
            </div>
          </div>
          <div className={`cover-canvas ${loading ? "is-making" : ""}`} inert={loading}>
            <DrawingCanvas layout="cover" />
          </div>
          <button className="go-button" type="button" onClick={() => void go()} disabled={drawing.isEmpty || loading}>PRESS RECORD</button>
          {loading && <RecordingStatus />}
          {error && <p className="studio-error" role="alert">{error}</p>}
        </section>
      ) : (
        <>
          <AlbumAmbient palette={album.palette} />
          <header className="album-header">
            <button type="button" className="back-button" onClick={() => { audioRef.current?.pause(); setAlbum(null); setPlaying(false); setError(""); }}><ArrowLeft size={16} /> New drawing</button>
            <span className="wordmark">DRAWCOVER<span className="wordmark-dot" /></span>
            <span className="edition">ONE DRAWING. ONE RECORD.</span>
          </header>
          <section className="album-room" aria-label="Your generated album">
            <AlbumJacket key={album.id} album={album} />
            <div className="record-column">
              <div className="record-kicker"><span className="live-dot" /> A RECORD THAT DIDN&apos;T EXIST UNTIL YOU</div>
              <h1>{album.title}</h1>
              <p className="album-subtitle">{album.subtitle}</p>
              <div className="record-details"><span>8 ORIGINAL TRACKS</span><span>~30 SECONDS EACH</span><span className="palette-swatches">{album.palette.map((color) => <i key={color} style={{ backgroundColor: color }} />)}</span></div>
              <AlbumTracklist>
              <ol className="tracklist" aria-label="Tracklist" data-playing={playing}>
                {album.tracks.map((track, index) => {
                  const state = tracks[index];
                  const isActive = active === index;
                  return (
                    <li key={`${index}-${track.title}`} className={isActive ? "active-track" : ""}>
                      <button type="button" className="track-button" disabled={trackLoading} aria-label={`Play track ${index + 1}: ${track.title}`} aria-current={isActive ? "true" : undefined} onClick={() => void select(index)}>
                        <span className="track-number">{state?.status === "loading" ? <LoaderCircle size={16} className="spin" /> : isActive && state?.status === "ready" ? <span className="equalizer"><i /><i /><i /></span> : String(index + 1).padStart(2, "0")}</span>
                        <span className="track-title">{track.title}</span>
                        <span className="track-state">{state?.status === "loading" ? "MAKING" : state?.status === "error" ? "RETRY" : state?.status === "ready" ? "0:30" : <Play size={13} />}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              </AlbumTracklist>
              {tracks[active]?.status === "error" && <p className="track-error" role="alert">{tracks[active].message}</p>}
              <div className="record-player glass-surface" data-playing={playing}>
                <div className="player-heading">
                  <div className="mini-record" aria-hidden="true"><i /></div>
                  <div className="now-playing"><span>{trackLoading ? "IN THE STUDIO" : playing ? "NOW PLAYING" : "ON THE TURNTABLE"}</span><strong>{album.tracks[active]?.title}</strong></div>
                  <button type="button" className="player-toggle" aria-label={playing ? "Pause track" : "Play current track"} disabled={trackLoading || tracks[active]?.status !== "ready"} onClick={() => {
                    const audio = audioRef.current;
                    if (!audio) return;
                    if (!audio.paused) audio.pause();
                    else void audio.play().catch(() => setError("Audio couldn't play. Use the player controls to try again."));
                  }}>{trackLoading ? <LoaderCircle size={19} className="spin" /> : playing ? <Pause size={19} /> : <Play size={19} />}</button>
                </div>
                <div className="player-waveform" aria-hidden="true">{Array.from({ length: 36 }, (_, index) => <i key={index} style={{ "--bar-index": index, "--bar-height": `${18 + ((index * 17 + 7) % 38)}px` } as CSSProperties} />)}</div>
                <audio ref={audioRef} controls preload="none" aria-label="Album audio player" onPlay={() => { setPlaying(true); setError(""); }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => { setPlaying(false); setError("Audio playback failed. Select the track again to reload it."); }} />
                {notice && <p className="play-notice" role="status">{notice}</p>}
                {error && <p role="alert" className="track-error">{error}</p>}
              </div>
              <p className="listening-note">Made from your imagination. Short enough to play again.<br />Each new track is created when you press play.</p>
            </div>
          </section>
          <footer className="album-footer"><span>FROM A BLANK PAGE TO SIDE A.</span><span>DRAW / TRANSFORM / LISTEN</span></footer>
        </>
      )}
      <a className="github-link" href="https://github.com/oliverseges/DrawCover" target="_blank" rel="noopener noreferrer" aria-label="View DrawCover on GitHub (opens in a new tab)" title="View DrawCover on GitHub (opens in a new tab)">
        <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
          <path d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656" />
        </svg>
      </a>
    </main>
  );
}
