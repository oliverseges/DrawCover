"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ArrowLeft, Brush, Circle, Eraser, LoaderCircle, Minus, PaintBucket, Pause, Play, Redo2, Square, Trash2, Undo2, Volume2, VolumeX } from "lucide-react";
import { AlbumAmbient, AlbumTracklist } from "@/components/album-effects";
import { AlbumJacket } from "@/components/album-jacket";
import { AlbumWaveform } from "@/components/album-waveform";
import { showGenerationLimit } from "@/components/generation-limit-toast";
import { RecordingStatus } from "@/components/recording-status";
import { generationRequest } from "@/lib/generation-request";
import { DrawingCanvas } from "@/components/drawing-canvas";
import { useAlbumPlayer } from "@/components/use-album-player";
import { useShortcuts } from "@/components/toolbar/use-shortcuts";
import { canvasController } from "@/lib/canvas/controller";
import { stylizeDrawing } from "@/lib/cover-art";
import type { Album, MusicMode } from "@/lib/drawcover";
import { useDrawingStore, type Tool } from "@/stores/drawing-store";
import { CRITICS, CRITIC_IDS, type CriticId } from "@/lib/critics";
import { useCriticVoice } from "@/components/use-critic-voice";
import { CriticSpeech } from "@/components/critic-speech";

const CriticCharacter = dynamic(() => import("@/components/critic-character").then(module => module.CriticCharacter), { ssr: false });

const tools: { id: Tool; label: string; icon: typeof Brush }[] = [
  { id: "brush", label: "Brush", icon: Brush },
  { id: "eraser", label: "Eraser", icon: Eraser },
  { id: "line", label: "Line", icon: Minus },
  { id: "rect", label: "Rectangle", icon: Square },
  { id: "ellipse", label: "Ellipse", icon: Circle },
  { id: "fill", label: "Fill", icon: PaintBucket },
];

function Wordmark() {
  return <span className="wordmark"><span>DRA<span className="wordmark-pair"><span className="wordmark-w">W</span><span className="wordmark-c">C</span></span>OVER</span><span className="wordmark-dot" /></span>;
}

export function DrawCover({ criticMode = false }: { criticMode?: boolean }) {
  useShortcuts();
  const drawing = useDrawingStore();
  const [album, setAlbum] = useState<Album | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [musicMode, setMusicMode] = useState<MusicMode>("instrumental");
  const [criticId, setCriticId] = useState<CriticId>("mara");
  const [leaving, setLeaving] = useState(false);
  const [changingCritic, setChangingCritic] = useState(false);
  const [reviewShown, setReviewShown] = useState(false);
  const [characterReady, setCharacterReady] = useState(false);
  const onCharacterReady = useCallback(() => setCharacterReady(true), []);
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const criticTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const voice = useCriticVoice(criticId, criticMode);
  const { audioRef, tracks, active, loading: trackLoading, notice, select } = useAlbumPlayer(album);
  useEffect(() => () => {
    if (navigationTimer.current) clearTimeout(navigationTimer.current);
    if (criticTimer.current) clearTimeout(criticTimer.current);
  }, []);

  function changeCritic() {
    if (loading || album || changingCritic || leaving) return;
    voice.stop();
    const change = () => {
      setCharacterReady(false);
      setCriticId(CRITIC_IDS[(CRITIC_IDS.indexOf(criticId) + 1) % CRITIC_IDS.length]);
      setChangingCritic(false);
    };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) change();
    else {
      setChangingCritic(true);
      criticTimer.current = setTimeout(change, 360);
    }
  }

  function nextDrawing() {
    audioRef.current?.pause();
    voice.stop();
    setAlbum(null);
    setPlaying(false);
    setError("");
    setReviewShown(false);
    if (criticMode) {
      setCharacterReady(false);
      setCriticId(CRITIC_IDS[(CRITIC_IDS.indexOf(criticId) + 1) % CRITIC_IDS.length]);
    }
  }

  async function go() {
    if (loading || changingCritic || leaving || drawing.isEmpty) return;
    const image = canvasController.exportDataUrl();
    if (!image) return;
    voice.stop();
    setReviewShown(false);
    setLoading(true);
    setError("");
    try {
      const { response, body } = await generationRequest<Album>("/api/drawcover", { image, musicMode, ...(criticMode ? { criticId } : {}) });
      if (showGenerationLimit(response, body)) return;
      if (!response.ok) throw new Error(body.message || "Your record couldn't be made. Please try again.");
      const result: Album = body;
      if (!result.cover.dataUrl) result.cover.dataUrl = await stylizeDrawing(image, result.palette);
      if (criticMode) setCharacterReady(false);
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
  const review = album?.criticReview;
  const greeting = criticId === "mara" ? "A fresh sleeve? Make me curious." : criticId === "jax" ? "Show me a record with something to say." : "One drawing. Let's see the future.";
  const speech = reviewShown && review ? `${review.score}/10. ${review.headline} ${review.text}` : loading
    ? "No peeking. I'm sharpening my pencil."
    : album ? "Your record is on my desk. Ready for the verdict?" : greeting;

  const criticPanel = criticMode ? <aside className={`critic-panel ${album ? "critic-result" : ""}`} aria-label="Your fictional music critic">
        <div className="critic-portrait">
          <CriticCharacter key={criticId} criticId={album?.criticReview?.criticId ?? criticId} palette={album?.palette} onReady={onCharacterReady} leaving={leaving || changingCritic} onChange={changeCritic} changeDisabled={loading || !!album || changingCritic || leaving} speaking={voice.speaking} reaction={reviewShown && album?.criticReview ? album.criticReview.score >= 7 ? "pleased" : "disappointed" : "neutral"} />
          <button type="button" className="critic-sound" aria-label={voice.muted ? "Unmute critic" : "Mute critic"} aria-pressed={!voice.muted} title={voice.muted ? "Enable original character babble" : "Mute character babble"} onClick={voice.toggle}>{voice.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}<span>Sound {voice.muted ? "off" : "on"}</span></button>
          <h2 className="critic-name">{CRITICS[album?.criticReview?.criticId ?? criticId].name}</h2>
        </div>
        <div className="critic-copy">
          {characterReady && !leaving && !changingCritic && <CriticSpeech text={speech} muted={voice.muted || playing} onBabble={() => voice.speak(review && review.score >= 7 ? "pleased" : reviewShown ? "disappointed" : "neutral")} onQuiet={voice.stop} />}
          {album?.criticReview && <>
            {!reviewShown ? <button className="critic-verdict-button" type="button" onClick={() => { audioRef.current?.pause(); setReviewShown(true); }}>Reveal verdict</button> : <section className="critic-review" aria-label="Critic's review">
              <p className="critic-score"><strong>{album.criticReview.score}</strong><span>/10</span></p>
              <h2>{album.criticReview.headline}</h2>
              <details><summary>What won (or lost) them over</summary><p>{album.criticReview.preferences}</p><p>Direction {album.criticReview.breakdown.direction}/4 · Mood {album.criticReview.breakdown.mood}/3 · Palette {album.criticReview.breakdown.palette}/3</p></details>
            </section>}
            {reviewShown && <button className="critic-verdict-button critic-next-round" type="button" onClick={nextDrawing}>Another round</button>}
            <small>Concept judging only. No audio listening.<br />One review included with this album.</small>
          </>}
          {voice.audioError && <p role="status">{voice.audioError}</p>}
        </div>
      </aside> : null;

  return (
    <main className={`drawcover ${album ? "has-album" : ""} ${criticMode ? "critic-mode" : ""} ${leaving ? "critic-leaving" : ""}`} style={theme}>
      {!album && <header className="drawing-header"><h1><Wordmark /></h1></header>}
      {!album && criticPanel}
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
          <div className="record-controls">
            <button className="go-button" type="button" onClick={() => void go()} disabled={drawing.isEmpty || loading || changingCritic || leaving}>PRESS RECORD</button>
            <fieldset className="music-mode" disabled={loading}>
              <legend className="sr-only">Song vocals</legend>
              <div>{(["instrumental", "lyrics"] as const).map(mode => (
                <label key={mode}>
                  <input type="radio" name="music-mode" value={mode} checked={musicMode === mode} onChange={() => setMusicMode(mode)} />
                  <span>{mode === "instrumental" ? "Instrumental" : "Lyrics"}</span>
                </label>
              ))}</div>
            </fieldset>
          </div>
          {loading && <RecordingStatus />}
          {error && <p className="studio-error" role="alert">{error}</p>}
        </section>
      ) : (
        <>
          <AlbumAmbient palette={album.palette} />
          <header className="album-header">
            <button type="button" className="back-button" onClick={nextDrawing}><ArrowLeft size={16} /> {criticMode ? "Another round" : "New drawing"}</button>
            <Wordmark />
            <span className="edition">ONE DRAWING. ONE RECORD.</span>
          </header>
          <section className="album-room" aria-label="Your generated album">
            {criticPanel}
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
                <AlbumWaveform audioRef={audioRef} playing={playing} />
                <audio ref={audioRef} controls preload="none" aria-label="Album audio player" onPlay={() => { voice.stop(); setPlaying(true); setError(""); }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => { setPlaying(false); setError("Audio playback failed. Select the track again to reload it."); }} />
                {notice && <p className="play-notice" role="status">{notice}</p>}
                {error && <p role="alert" className="track-error">{error}</p>}
              </div>
              <p className="listening-note">Made from your imagination. Short enough to play again.<br />Each new track is created when you press play.</p>
            </div>
          </section>
          <footer className="album-footer"><span>FROM A BLANK PAGE TO SIDE A.</span><span>DRAW / TRANSFORM / LISTEN</span></footer>
        </>
      )}
      {!album && <Link className="critic-mode-link" href={criticMode ? "/" : "/play"} aria-disabled={loading || leaving} tabIndex={loading || leaving ? -1 : undefined} onNavigate={event => {
        if (loading || leaving) { event.preventDefault(); return; }
        voice.stop();
        if (criticTimer.current) clearTimeout(criticTimer.current);
        setChangingCritic(false);
        if (!criticMode || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
        event.preventDefault();
        setLeaving(true);
        navigationTimer.current = setTimeout(() => { router.push("/"); setLeaving(false); }, 360);
      }}>{criticMode ? "Normal mode" : "Critic mode"} <span aria-hidden="true">↗</span></Link>}
      <a className="github-link" href="https://github.com/oliverseges/DrawCover" target="_blank" rel="noopener noreferrer" aria-label="View DrawCover on GitHub (opens in a new tab)" title="View DrawCover on GitHub (opens in a new tab)">
        <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
          <path d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656" />
        </svg>
      </a>
    </main>
  );
}
