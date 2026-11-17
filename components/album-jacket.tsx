"use client";

import { lazy, Suspense, useState, useSyncExternalStore } from "react";
import { ArrowUpRight, RotateCw } from "lucide-react";
import { CoverReveal } from "@/components/album-effects";
import type { Album } from "@/lib/drawcover";

const PhysicalAlbum = lazy(() => import("@/components/physical-album"));
function subscribeMotion(onChange: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
const allowsMotion = () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function ContentNote() {
  return <span className="content-note" aria-label="Content note: instrumental music, no lyrics requested. Not an official age certification."><span>CONTENT NOTE</span><strong>INSTRUMENTAL</strong><small>NO LYRICS REQUESTED</small></span>;
}

export function AlbumJacket({ album }: { album: Album }) {
  const [flipped, setFlipped] = useState(false);
  const [threeReady, setThreeReady] = useState(false);
  const threeEnabled = useSyncExternalStore(subscribeMotion, allowsMotion, () => false);
  const threeActive = threeEnabled && threeReady;

  return (
    <div className="art-column">
      <div className="album-jacket" data-flipped={flipped} data-renderer={threeActive ? "three" : "2d"} role="button" tabIndex={0} aria-pressed={flipped} aria-label={`Flip album artwork for ${album.title} to ${flipped ? "front" : "back"} cover`} onClick={() => setFlipped((old) => !old)} onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setFlipped((old) => !old); }
      }}>
        <div className="physical-layer" data-ready={threeActive} aria-hidden="true">
          {threeEnabled && <Suspense fallback={null}><PhysicalAlbum album={album} flipped={flipped} onReady={setThreeReady} /></Suspense>}
        </div>
        <div className="jacket-tilt" data-hidden={threeActive} aria-hidden="true">
        <div className="jacket-rotator">
          <div className="jacket-face jacket-front" aria-hidden={flipped} inert={flipped}>
            <div className="art-frame">
              <CoverReveal background={album.palette[0]} animate={!threeActive}>
                <div className="front-cover-composition">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="album-art" src={album.cover.dataUrl!} alt="" />
                  <span className="cover-front-type">
                    <span className="cover-artist">{album.artist || "DrawCover Sessions"}</span>
                    <span className="cover-front-title">{album.title}</span>
                    <span className="cover-front-edition">AN ORIGINAL RECORD / DRAWN BY YOU</span>
                  </span>
                  <ContentNote />
                  </div>
              </CoverReveal>
              <span className="art-sticker" aria-hidden="true">DC / 001</span>
            </div>
          </div>
          <div className="jacket-face jacket-back" aria-hidden={!flipped} inert={!flipped}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="back-artwork" src={album.cover.dataUrl!} alt="" />
            <div className="back-cover-print">
              <div className="back-cover-heading"><span>SIDE A / THE COMPLETE RECORD</span><p>{album.title}</p><small>{album.artist || "DrawCover Sessions"}</small></div>
              <ol className="back-cover-tracks" aria-label="Back cover tracklist">
                {album.tracks.map((track, index) => (
                  <li key={index}>
                    <span>{String(index + 1).padStart(2, "0")}</span><strong>{track.title}</strong><span>0:30</span>
                  </li>
                ))}
              </ol>
              <div className="back-cover-imprint"><span>DRAWCOVER<br />IMAGINATION, PRESSED INTO SOUND.<br />{"\u00a9 & \u2117 2026 DRAWCOVER RECORDS"}<br />FICTIONAL RELEASE</span><ContentNote /><span className="cover-barcode" aria-hidden="true" /></div>
            </div>
            </div>
          </div>
        </div>
      </div>
      <div className="jacket-controls">
        <span className="jacket-side">{flipped ? "BACK COVER / TRACK EDITION" : "FRONT COVER / ORIGINAL EDITION"}</span>
        <span className="flip-hint" aria-hidden="true"><RotateCw size={12} />CLICK / TAP TO FLIP</span>
      </div>
      <div className="art-caption"><span>{album.cover.source === "ai" ? "YOUR LINES, REIMAGINED" : "YOUR ORIGINAL LINES, COLOR-REMIXED"}</span><span>VOL. 01 <ArrowUpRight size={12} /></span></div>
      {album.cover.warning && <p className="cover-warning" role="status">AI artwork was unavailable. Your drawing has been color-remixed instead.</p>}
    </div>
  );
}
