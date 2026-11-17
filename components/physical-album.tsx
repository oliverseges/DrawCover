"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { albumFaces } from "@/lib/album-textures";
import type { Album } from "@/lib/drawcover";

export default function PhysicalAlbum({ album, flipped, onReady }: { album: Album; flipped: boolean; onReady: (ready: boolean) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flippedRef = useRef(flipped);

  useEffect(() => { flippedRef.current = flipped; }, [flipped]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.closest<HTMLElement>(".album-jacket");
    if (!canvas || !host) return;
    const context = canvas.getContext("webgl2", { alpha: true, antialias: true, powerPreference: "low-power" });
    if (!context || context.isContextLost() || !context.getContextAttributes()) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: true });
    } catch (error) {
      console.warn("3D album preview unavailable:", error instanceof Error ? error.message : "WebGL initialization failed.");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, .1, 30);
    camera.position.z = 5.7;
    const geometry = new THREE.BoxGeometry(3.2, 3.2, .055);
    const edge = new THREE.MeshStandardMaterial({ color: album.palette[0], roughness: .5, metalness: .15 });
    const front = new THREE.MeshBasicMaterial({ color: "#fff" });
    const back = new THREE.MeshBasicMaterial({ color: "#fff" });
    const jacket = new THREE.Mesh(geometry, [edge, edge, edge, edge, front, back]);
    jacket.rotation.z = -.025;
    scene.add(jacket);
    scene.add(new THREE.AmbientLight("#fff", 2));
    const light = new THREE.DirectionalLight("#fff", 3);
    light.position.set(-3, 5, 6);
    scene.add(light);
    let destroyed = false;
    let textures: THREE.CanvasTexture[] = [];
    let frameId = 0;
    let readyTimer = 0;
    let visible = true;
    let previous = 0;
    let elapsed = 0;
    const pointer = { x: 0, y: 0 };

    function resize() {
      const size = Math.max(1, Math.min(host!.clientWidth, 700));
      renderer.setSize(size, size, false);
    }
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);

    function frame(now: number) {
      frameId = 0;
      if (destroyed || document.hidden || !visible) return;
      const delta = Math.min((now - previous) / 1000, .05);
      previous = now;
      elapsed += delta;
      const smoothing = 1 - Math.exp(-delta * 9);
      const target = (flippedRef.current ? Math.PI : 0) + pointer.x * .09 + Math.sin(elapsed * .45) * .012;
      jacket.rotation.y += (target - jacket.rotation.y) * smoothing;
      jacket.rotation.x += (pointer.y * -.07 + Math.sin(elapsed * .38) * .009 - jacket.rotation.x) * smoothing;
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(frame);
    }
    function start() {
      if (!frameId && !destroyed && !document.hidden && visible) {
        previous = performance.now();
        frameId = requestAnimationFrame(frame);
      }
    }
    function pointerMove(event: PointerEvent) {
      const rect = host!.getBoundingClientRect();
      pointer.x = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1));
      pointer.y = Math.max(-1, Math.min(1, (event.clientY - rect.top) / rect.height * 2 - 1));
    }
    function pointerLeave() { pointer.x = pointer.y = 0; }
    function contextLost(event: Event) {
      event.preventDefault();
      destroyed = true;
      cancelAnimationFrame(frameId);
      onReady(false);
    }
    const intersection = new IntersectionObserver((entries) => {
      visible = entries[entries.length - 1]?.isIntersecting ?? true;
      if (visible) start();
    });
    intersection.observe(host);
    host.addEventListener("pointermove", pointerMove, { passive: true });
    host.addEventListener("pointerleave", pointerLeave, { passive: true });
    document.addEventListener("visibilitychange", start);
    canvas.addEventListener("webglcontextlost", contextLost);
    void albumFaces(album).then((faces) => {
      if (destroyed) return;
      textures = faces.map((face) => {
        const texture = new THREE.CanvasTexture(face);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        return texture;
      });
      front.map = textures[0];
      back.map = textures[1];
      front.needsUpdate = back.needsUpdate = true;
      start();
      readyTimer = window.setTimeout(() => { if (!destroyed) onReady(true); }, 1600);
    }).catch((error: unknown) => {
      if (!destroyed) {
        console.warn("3D album preview unavailable:", error instanceof Error ? error.message : "Texture generation failed.");
        onReady(false);
      }
    });
    return () => {
      destroyed = true;
      cancelAnimationFrame(frameId);
      window.clearTimeout(readyTimer);
      resizeObserver.disconnect();
      intersection.disconnect();
      host.removeEventListener("pointermove", pointerMove);
      host.removeEventListener("pointerleave", pointerLeave);
      document.removeEventListener("visibilitychange", start);
      canvas.removeEventListener("webglcontextlost", contextLost);
      geometry.dispose();
      edge.dispose();
      front.dispose();
      back.dispose();
      textures.forEach((texture) => texture.dispose());
      renderer.dispose();
      onReady(false);
    };
  }, [album, onReady]);

  return <canvas ref={canvasRef} className="physical-album-canvas" aria-hidden="true" />;
}
