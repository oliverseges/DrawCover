"use client";

import { useState, type CSSProperties } from "react";
import { ArrowLeft, ArrowUpRight, Brush, Circle, Eraser, LoaderCircle, Minus, PaintBucket, Play, Redo2, Square, Trash2, Undo2 } from "lucide-react";
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
  const { audioRef, tracks, active, loading: trackLoading, notice, select } = useAlbumPlayer(album);

  async function go() {
    if (loading || drawing.isEmpty) return;
    const image = canvasController.exportDataUrl();
    if (!image) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/drawcover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
      });
      const body = await response.json();
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
            <DrawingCanvas />
          </div>
          <button className="go-button" type="button" onClick={() => void go()} disabled={drawing.isEmpty || loading}>GO</button>
          {loading && <div className="making-status" role="status"><LoaderCircle size={15} className="spin" /> Turning your lines into a record<span className="loading-dots">...</span></div>}
          {error && <p className="studio-error" role="alert">{error}</p>}
        </section>
      ) : (
        <>
          <header className="album-header">
            <button type="button" className="back-button" onClick={() => { audioRef.current?.pause(); setAlbum(null); setError(""); }}><ArrowLeft size={16} /> New drawing</button>
            <span className="wordmark">DRAWCOVER<span className="wordmark-dot" /></span>
            <span className="edition">ONE DRAWING. ONE RECORD.</span>
          </header>
          <section className="album-room" aria-label="Your generated album">
            <div className="art-column">
              <div className="art-frame">
                {/* Generated and local artwork are data URLs, not remote optimized images. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="album-art" src={album.cover.dataUrl!} alt={`Album artwork for ${album.title}`} />
                <span className="art-sticker">DC<br />001</span>
              </div>
              <div className="art-caption"><span>{album.cover.source === "ai" ? "YOUR LINES, REIMAGINED" : "YOUR ORIGINAL LINES, COLOR-REMIXED"}</span><span>VOL. 01 <ArrowUpRight size={12} /></span></div>
              {album.cover.warning && <p className="cover-warning" role="status">AI artwork was unavailable. Your drawing has been color-remixed instead.</p>}
            </div>
            <div className="record-column">
              <div className="record-kicker"><span className="live-dot" /> A RECORD THAT DIDN&apos;T EXIST UNTIL YOU</div>
              <h1>{album.title}</h1>
              <p className="album-subtitle">{album.subtitle}</p>
              <div className="record-details"><span>8 ORIGINAL TRACKS</span><span>~30 SECONDS EACH</span><span className="palette-swatches">{album.palette.map((color) => <i key={color} style={{ backgroundColor: color }} />)}</span></div>
              <ol className="tracklist" aria-label="Tracklist">
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
                      {state?.status === "error" && <p className="track-error" role="alert">{state.message}</p>}
                    </li>
                  );
                })}
              </ol>
              <div className="record-player">
                <div className="now-playing"><span>{trackLoading ? "IN THE STUDIO" : "ON THE TURNTABLE"}</span><strong>{album.tracks[active]?.title}</strong></div>
                <audio ref={audioRef} controls preload="none" aria-label="Album audio player" onError={() => setError("Audio playback failed. Select the track again to reload it.")} />
                {notice && <p className="play-notice" role="status">{notice}</p>}
                {error && <p role="alert" className="track-error">{error}</p>}
              </div>
              <p className="listening-note">Made from your imagination. Short enough to play again.<br />Each new track is created when you press play.</p>
            </div>
          </section>
          <footer className="album-footer"><span>FROM A BLANK PAGE TO SIDE A.</span><span>DRAW / TRANSFORM / LISTEN</span></footer>
        </>
      )}
    </main>
  );
}
