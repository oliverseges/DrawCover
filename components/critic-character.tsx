"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import styles from "./critic-character.module.css";

// The project's wildcard Tailwind/Turbopack CSS rule currently emits this file
// as plain CSS with an empty module map. Unique, component-scoped raw names
// keep that pipeline working; normal CSS-module builds use the hashed exports.
const css = {
  character: styles.drawcoverCriticCharacter ?? "drawcoverCriticCharacter",
  entrance: styles.drawcoverCriticEntrance ?? "drawcoverCriticEntrance",
  stage: styles.drawcoverCriticStage ?? "drawcoverCriticStage",
  canvasHost: styles.drawcoverCriticCanvasHost ?? "drawcoverCriticCanvasHost",
  change: styles.drawcoverCriticChange ?? "drawcoverCriticChange",
  unavailable: styles.drawcoverCriticUnavailable ?? "drawcoverCriticUnavailable",
};

type CriticId = "mara" | "jax" | "nova";
type Reaction = "pleased" | "neutral" | "disappointed";
type Controls = { speaking: boolean; reaction: Reaction; leaving: boolean };
type Point = [number, number, number];
type Resources = {
  geometries: Set<THREE.BufferGeometry>;
  materials: Set<THREE.Material>;
};
type Rig = ReturnType<typeof buildCritic>;

const portraits = {
  mara: {
    name: "Mara",
    coat: "#c27b40",
    accent: "#73b5a7",
    hair: "#49332d",
    description: "Round glasses, swept hair, a warm ochre jacket and a vinyl record; one hand rests by the chin.",
  },
  jax: {
    name: "Jax",
    coat: "#30323d",
    accent: "#ef786d",
    hair: "#353040",
    description: "Spiky hair, a patched dark jacket, red sneakers, a folded music zine and a small guitar pick.",
  },
  nova: {
    name: "Nova",
    coat: "#929dbb",
    accent: "#81f0de",
    hair: "#65548d",
    description: "A violet swept bob, large headphones, a silver jacket with mint trim and a small pad controller.",
  },
} as const;

/** Original, hand-built toy figures. All dimensions are local scene units. */
function buildCritic(id: CriticId, resources: Resources) {
  const palette = portraits[id];
  const root = new THREE.Group();
  root.name = id;
  const head = new THREE.Group();
  head.position.y = 2.98;
  head.name = "head";
  root.add(head);

  function material(color: string, metalness = 0, roughness = 0.65) {
    const result = new THREE.MeshStandardMaterial({ color, metalness, roughness });
    resources.materials.add(result);
    return result;
  }

  const skin = material("#dfb69b");
  const hair = material(palette.hair);
  const coat = material(palette.coat, id === "nova" ? 0.55 : 0.04);
  const accent = material(palette.accent, id === "nova" ? 0.25 : 0);
  const ink = material("#252735");
  const cream = material("#f5e8ce");
  const sole = material("#d8d2c8");
  const metal = material("#b9becb", 0.7, 0.3);
  const trousers = material(id === "mara" ? "#565b4c" : id === "jax" ? "#434452" : "#343a56");
  const sphere = new THREE.SphereGeometry(1, 24, 16);
  const feet: THREE.Mesh[] = [];
  resources.geometries.add(sphere);

  function mesh(
    geometry: THREE.BufferGeometry,
    surface: THREE.Material,
    position: Point,
    scale: Point = [1, 1, 1],
    parent: THREE.Object3D = root,
  ) {
    resources.geometries.add(geometry);
    const result = new THREE.Mesh(geometry, surface);
    result.position.set(...position);
    result.scale.set(...scale);
    result.castShadow = true;
    parent.add(result);
    return result;
  }

  function oval(surface: THREE.Material, position: Point, scale: Point, parent: THREE.Object3D = root) {
    return mesh(sphere, surface, position, scale, parent);
  }

  function link(a: Point, b: Point, radius: number, surface: THREE.Material, parent: THREE.Object3D = root) {
    const start = new THREE.Vector3(...a);
    const end = new THREE.Vector3(...b);
    const delta = end.clone().sub(start);
    const part = mesh(
      new THREE.CapsuleGeometry(radius, Math.max(0.005, delta.length() - radius * 2), 5, 12),
      surface,
      start.clone().add(end).multiplyScalar(0.5).toArray() as Point,
      [1, 1, 1],
      parent,
    );
    part.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    return part;
  }

  function patch(points: [number, number][], surface: THREE.Material, position: Point, parent: THREE.Object3D = root) {
    const shape = new THREE.Shape();
    points.forEach(([x, y], index) => {
      if (index === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    });
    shape.closePath();
    return mesh(
      new THREE.ExtrudeGeometry(shape, { depth: 0.035, bevelEnabled: true, bevelSize: 0.018, bevelThickness: 0.018, bevelSegments: 2, steps: 1 }),
      surface, position, [1, 1, 1], parent,
    );
  }

  // Rounded tailored jacket: a continuous shoulder-to-hip silhouette, not a box.
  const profile = [
    [0.28, 0], [0.35, 0.035], [0.38, 0.14], [0.36, 0.5],
    [0.43, 0.88], [0.42, 0.99], [0.31, 1.1], [0.19, 1.16],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  mesh(new THREE.LatheGeometry(profile, 32), coat, [0, 1.25, 0], [1, 1, 0.78]);
  oval(accent, [0, 1.96, 0.265], [0.24, 0.43, 0.065]);
  link([0, 2.31, 0], [0, 2.57, 0], 0.15, skin);
  // Lapels, center seam, pockets and cuffs give the clothing a readable construction.
  patch([[-0.3, 0.14], [-0.12, 0.22], [-0.02, -0.3], [-0.23, -0.1]], id === "jax" ? ink : cream, [0, 2.16, 0.28]);
  patch([[0.3, 0.14], [0.12, 0.22], [0.02, -0.3], [0.23, -0.1]], id === "jax" ? ink : cream, [0, 2.16, 0.28]);
  link([0, 1.34, 0.3], [0, 1.85, 0.33], 0.013, metal);
  for (const side of [-1, 1]) {
    link([side * 0.19, 1.53, 0.31], [side * 0.31, 1.59, 0.27], 0.018, accent);
    const footX = side * (id === "jax" ? 0.32 : 0.23);
    link([side * 0.2, 1.35, 0], [footX, 0.33, 0.015], 0.17, trousers);
    const shoe = oval(id === "jax" ? accent : ink, [footX, 0.18, 0.12], [0.215, 0.17, 0.34]);
    shoe.rotation.y = side * -0.13;
    feet.push(oval(sole, [footX, 0.075, 0.14], [0.22, 0.065, 0.34]));
    link([footX - 0.1, 0.28, 0.29], [footX + 0.1, 0.28, 0.29], 0.018, cream);
  }

  oval(skin, [0, 0, 0], [0.51, 0.59, 0.46], head);
  for (const side of [-1, 1]) {
    oval(skin, [side * 0.49, -0.035, 0], [0.11, 0.16, 0.12], head);
    oval(material("#bf8779"), [side * 0.54, -0.035, 0.055], [0.035, 0.07, 0.025], head);
  }
  oval(skin, [0, -0.065, 0.459], [0.09, 0.105, 0.095], head);
  const eyes = new THREE.Group();
  eyes.name = "eyes";
  head.add(eyes);
  for (const side of [-1, 1]) {
    oval(ink, [side * 0.175, 0.035, 0.431], [0.045, 0.067, 0.026], eyes);
    oval(cream, [side * 0.175 - 0.009, 0.057, 0.453], [0.013, 0.018, 0.009], eyes);
    link([side * 0.11, 0.18, 0.43], [side * 0.25, 0.19, 0.4], 0.025, hair, head);
  }
  const restingMouth = mesh(new THREE.TorusGeometry(0.105, 0.018, 8, 24, Math.PI), ink, [0, -0.19, 0.439], [1, 1, 1], head);
  restingMouth.name = "resting-mouth";
  const talkingMouth = oval(ink, [0, -0.22, 0.447], [0.095, 0.025, 0.025], head);
  talkingMouth.name = "talking-mouth";

  oval(hair, [0, 0.32, -0.045], [0.525, 0.32, 0.46], head);
  if (id === "mara") {
    const sweep = oval(hair, [-0.12, 0.34, 0.26], [0.43, 0.23, 0.24], head);
    sweep.rotation.z = 0.24;
    oval(hair, [-0.45, 0.11, -0.035], [0.105, 0.34, 0.27], head);
    oval(hair, [0.43, 0.18, -0.07], [0.12, 0.26, 0.3], head);
    oval(hair, [0.27, 0.25, -0.43], [0.26, 0.25, 0.2], head);
    for (const side of [-1, 1]) {
      mesh(new THREE.TorusGeometry(0.16, 0.022, 8, 32), metal, [side * 0.18, 0.025, 0.47], [1, 0.92, 1], head);
    }
    link([-0.025, 0.035, 0.49], [0.025, 0.035, 0.49], 0.018, metal, head);
    // Knotted scarf and one softly folded end.
    oval(accent, [0, 2.39, 0.08], [0.24, 0.11, 0.22]);
    patch([[-0.12, 0.04], [0.08, 0.03], [0.13, -0.43], [-0.02, -0.39]], accent, [0.04, 2.35, 0.29]);
  } else if (id === "jax") {
    for (let i = 0; i < 7; i++) {
      const x = (i - 3) * 0.13;
      const spike = mesh(new THREE.ConeGeometry(0.135, 0.36 + (i % 3) * 0.07, 5), hair, [x, 0.54 - Math.abs(x) * 0.22, 0.04], [1, 1, 0.95], head);
      spike.rotation.z = -x * 0.9;
      spike.rotation.x = 0.12;
    }
    oval(hair, [-0.45, 0.15, 0], [0.09, 0.25, 0.3], head);
    // Hand-sewn patches: abstract marks, no real band logos.
    patch([[-0.09, -0.1], [0.09, -0.1], [0.09, 0.1], [-0.09, 0.1]], accent, [-0.25, 1.88, 0.31]);
    link([-0.29, 1.84, 0.365], [-0.21, 1.92, 0.365], 0.014, cream);
    link([-0.29, 1.92, 0.365], [-0.21, 1.84, 0.365], 0.014, cream);
    patch([[-0.08, -0.045], [0.08, -0.045], [0.08, 0.045], [-0.08, 0.045]], cream, [0.26, 1.7, 0.32]);
    for (let i = 0; i < 3; i++) oval(metal, [0.26 + i * 0.045, 2.19 - i * 0.06, 0.36], [0.025, 0.025, 0.02]);
  } else {
    const fringe = oval(hair, [-0.18, 0.29, 0.29], [0.39, 0.23, 0.2], head);
    fringe.rotation.z = 0.3;
    oval(hair, [0.43, -0.04, -0.09], [0.14, 0.43, 0.33], head);
    oval(hair, [-0.43, 0.05, -0.12], [0.13, 0.34, 0.3], head);
    mesh(new THREE.TorusGeometry(0.565, 0.065, 10, 40, Math.PI), ink, [0, 0.04, -0.04], [1, 1, 1], head);
    for (const side of [-1, 1]) {
      oval(ink, [side * 0.535, 0.015, 0], [0.125, 0.235, 0.22], head);
      oval(metal, [side * 0.61, 0.015, 0.025], [0.075, 0.18, 0.17], head);
      const ring = mesh(new THREE.TorusGeometry(0.12, 0.022, 8, 24), accent, [side * 0.67, 0.015, 0.025], [1, 1, 1], head);
      ring.rotation.y = Math.PI / 2;
      link([side * 0.29, 1.33, 0.2], [side * 0.38, 2.14, 0.22], 0.025, accent);
    }
  }

  function arm(shoulder: Point, elbow: Point, hand: Point) {
    const pivot = new THREE.Group();
    pivot.position.set(...shoulder);
    root.add(pivot);
    const localElbow = elbow.map((v, i) => v - shoulder[i]) as Point;
    const localHand = hand.map((v, i) => v - shoulder[i]) as Point;
    link([0, 0, 0], localElbow, 0.145, coat, pivot);
    link(localElbow, localHand, 0.12, coat, pivot);
    oval(accent, localHand, [0.13, 0.105, 0.13], pivot);
    const mitten = oval(skin, [localHand[0], localHand[1] + 0.045, localHand[2] + 0.07], [0.115, 0.14, 0.105], pivot);
    mitten.rotation.z = shoulder[0] < 0 ? -0.25 : 0.25;
    oval(skin, [localHand[0] + (shoulder[0] < 0 ? 0.085 : -0.085), localHand[1] + 0.03, localHand[2] + 0.1], [0.06, 0.075, 0.06], pivot);
    return pivot;
  }

  const leftArm = id === "mara"
    ? arm([-0.4, 2.23, 0], [-0.65, 1.85, 0.02], [-0.67, 1.52, 0.34])
    : id === "jax"
      ? arm([-0.4, 2.23, 0], [-0.7, 1.9, 0.06], [-0.69, 1.86, 0.41])
      : arm([-0.4, 2.23, 0], [-0.62, 1.89, 0.13], [-0.35, 1.96, 0.63]);
  const rightArm = id === "mara"
    ? arm([0.4, 2.23, 0], [0.68, 2.06, 0.1], [0.35, 2.65, 0.43])
    : id === "jax"
      ? arm([0.4, 2.23, 0], [0.72, 2.13, 0.1], [0.82, 2.52, 0.32])
      : arm([0.4, 2.23, 0], [0.62, 1.94, 0.11], [0.35, 2.1, 0.59]);
  leftArm.name = "left-arm";
  rightArm.name = "right-arm";
  const prop = new THREE.Group();
  prop.name = "prop";
  // Props are attached to a hand's pivot so a gesture never leaves them floating.
  leftArm.add(prop);
  prop.position.set(-leftArm.position.x, -leftArm.position.y, -leftArm.position.z);
  if (id === "mara") {
    const record = mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.035, 48), ink, [-0.69, 1.5, 0.5], [1, 1, 1], prop);
    record.rotation.x = Math.PI / 2;
    for (const radius of [0.21, 0.28, 0.35, 0.39]) {
      mesh(new THREE.TorusGeometry(radius, 0.006, 6, 48), material("#55515c"), [-0.69, 1.5, 0.523], [1, 1, 1], prop);
    }
    const label = mesh(new THREE.CircleGeometry(0.14, 32), accent, [-0.69, 1.5, 0.525], [1, 1, 1], prop);
    label.name = "vinyl-label";
    oval(cream, [-0.69, 1.5, 0.53], [0.024, 0.024, 0.006], prop);
  } else if (id === "jax") {
    const zine = mesh(new THREE.BoxGeometry(0.43, 0.56, 0.07), cream, [-0.7, 1.76, 0.52], [1, 1, 1], prop);
    zine.name = "music-zine";
    link([-0.89, 1.5, 0.565], [-0.89, 2.02, 0.565], 0.012, ink, prop);
    patch([[-0.13, 0.1], [0.13, 0.14], [0.09, -0.1], [-0.11, -0.07]], accent, [-0.68, 1.8, 0.56], prop);
    for (let i = 0; i < 3; i++) link([-0.82, 1.62 + i * 0.045, 0.565], [-0.58, 1.62 + i * 0.045, 0.565], 0.009, ink, prop);
    const pick = patch([[-0.09, 0.06], [0.09, 0.06], [0, -0.13]], accent, [0.82 - rightArm.position.x, 2.66 - rightArm.position.y, 0.44], rightArm);
    pick.name = "guitar-pick";
  } else {
    const controller = mesh(new THREE.BoxGeometry(0.83, 0.15, 0.36), ink, [0, 1.91, 0.69], [1, 1, 1], prop);
    controller.name = "pad-controller";
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 4; col++) {
        mesh(new THREE.BoxGeometry(0.125, 0.025, 0.1), (row + col) % 3 === 0 ? cream : accent, [-0.28 + col * 0.18, 2, 0.61 + row * 0.15], [1, 1, 1], prop);
      }
    }
  }
  return { root, head, eyes, restingMouth, talkingMouth, leftArm, rightArm, feet };
}

/** Bounds of actual visible mesh vertices in normalized camera coordinates.
 * Projecting a world-space AABB instead adds empty corners around rotated
 * silhouettes, especially the record/pick, and produces an off-center actor.
 */
function projectActorBounds(root: THREE.Object3D, camera: THREE.Camera) {
  root.updateWorldMatrix(true, true);
  camera.updateMatrixWorld();
  const viewProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const matrix = new THREE.Matrix4();
  const vertex = new THREE.Vector3();
  const point = new THREE.Vector2();
  const bounds = new THREE.Box2();
  root.traverseVisible((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const positions = object.geometry.getAttribute("position");
    matrix.multiplyMatrices(viewProjection, object.matrixWorld);
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i).applyMatrix4(matrix);
      bounds.expandByPoint(point.set(vertex.x, vertex.y));
    }
  });
  return bounds;
}

function poseCritic(rig: Rig, id: CriticId, controls: Controls, seconds: number, animate: boolean) {
  const { speaking, reaction } = controls;
  const pleased = reaction === "pleased";
  const disappointed = reaction === "disappointed";
  const t = animate ? seconds : 0;
  const breathe = animate ? Math.sin(t * 1.8) : 0;
  rig.root.position.y = breathe * 0.012;
  rig.root.rotation.set(0, -0.14 + (animate ? Math.sin(t * 0.65) * 0.025 : 0), (id === "jax" ? -0.045 : 0) + (pleased ? -0.025 : disappointed ? 0.025 : 0));
  rig.head.rotation.set(
    (disappointed ? 0.14 : pleased ? -0.05 : 0.015) + (animate && speaking ? Math.sin(t * 8) * 0.022 : breathe * 0.009),
    animate ? Math.sin(t * 0.8) * 0.025 : 0,
    (pleased ? -0.08 : disappointed ? 0.065 : -0.018) + (animate && speaking ? Math.sin(t * 5) * 0.018 : 0),
  );
  // A brief, deterministic blink; no timers or random hydration differences.
  const blinkPhase = t % 4.7;
  rig.eyes.scale.y = animate && blinkPhase > 4.5 ? Math.max(0.08, Math.abs(blinkPhase - 4.6) * 10) : 1;
  rig.restingMouth.visible = !speaking;
  rig.restingMouth.rotation.z = disappointed ? 0 : Math.PI;
  rig.restingMouth.scale.y = reaction === "neutral" ? 0.25 : 0.7;
  rig.talkingMouth.visible = speaking;
  rig.talkingMouth.scale.y = speaking ? (animate ? 0.035 + Math.abs(Math.sin(t * 19)) * 0.065 : 0.045) : 0.025;
  rig.leftArm.rotation.z = (pleased ? -0.055 : disappointed ? 0.045 : 0) + breathe * 0.009;
  rig.rightArm.rotation.z = (pleased ? 0.075 : disappointed ? -0.045 : 0) + (animate && speaking ? Math.sin(t * 6) * 0.028 : breathe * -0.009);
}

/**
 * Presentation only. Keep mounted during `leaving` for the 360ms exit.
 * The parent owns selection, reactions, audio, mode changes and positioning.
 */
export function CriticCharacter({
  criticId,
  leaving = false,
  onChange,
  changeDisabled = false,
  className,
  speaking = false,
  reaction = "neutral",
  palette,
  onReady,
}: {
  criticId: CriticId;
  leaving?: boolean;
  onChange: () => void;
  changeDisabled?: boolean;
  className?: string;
  speaking?: boolean;
  reaction?: Reaction;
  palette?: readonly [string, string, string];
  /** Once per critic, after a rendered model or visible unavailable fallback. */
  onReady?: () => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const unavailableRef = useRef<HTMLParagraphElement>(null);
  const controls = useRef<Controls>({ speaking, reaction, leaving });
  const wakeRef = useRef<(() => void) | null>(null);
  const onReadyRef = useRef(onReady);
  const readyCriticRef = useRef<CriticId | null>(null);
  const portrait = portraits[criticId];
  // Compare color values, not the parent's tuple identity, to avoid rebuilding
  // WebGL resources for every speaking/reaction render.
  const paletteA = palette?.[0];
  const paletteB = palette?.[1];
  const paletteC = palette?.[2];

  useEffect(() => {
    controls.current = { speaking, reaction, leaving };
    wakeRef.current?.();
  }, [speaking, reaction, leaving]);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    const host = canvasHostRef.current;
    const stage = stageRef.current;
    const unavailable = unavailableRef.current;
    if (!host || !stage || !unavailable) return;
    stage.hidden = false;
    unavailable.hidden = true;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    const resources: Resources = { geometries: new Set(), materials: new Set() };
    let renderer: THREE.WebGLRenderer | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let intersectionObserver: IntersectionObserver | undefined;
    let motion: MediaQueryList | undefined;
    let disposed = false;
    let failed = false;
    let visible = typeof IntersectionObserver === "undefined";
    let frameId = 0;
    let lastPaint = -Infinity;
    let dirty = true;
    let rig: Rig;
    let scene: THREE.Scene;
    let camera: THREE.OrthographicCamera;
    let ground: THREE.Mesh;
    const feetCenter = new THREE.Vector3();
    const footPosition = new THREE.Vector3();

    function reportReady() {
      if (readyCriticRef.current === criticId) return;
      readyCriticRef.current = criticId;
      onReadyRef.current?.();
    }

    function release() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      motion?.removeEventListener("change", wake);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("resize", wake);
      canvas.removeEventListener("webglcontextlost", contextLost);
      resources.geometries.forEach((geometry) => geometry.dispose());
      resources.materials.forEach((surface) => surface.dispose());
      renderer?.dispose();
      // Each setup owns a fresh canvas; Strict Mode never reuses a lost context.
      renderer?.forceContextLoss();
      canvas.remove();
      stage!.dataset.rendered = "false";
      if (wakeRef.current === wake) wakeRef.current = null;
    }

    function fail() {
      if (failed || disposed) return;
      failed = true;
      console.warn("DrawCover critic: 3D preview unavailable.");
      release();
      stage!.hidden = true;
      unavailable!.hidden = false;
      reportReady();
    }

    function contextLost(event: Event) {
      event.preventDefault();
      fail();
    }

    function frame(now: number) {
      frameId = 0;
      if (disposed || document.hidden || !visible || !renderer) return;
      const animate = !motion?.matches && !controls.current.leaving;
      // Cap actual GPU work at 30fps; reduced motion renders only on demand.
      if (dirty || now - lastPaint >= 1000 / 30) {
        try {
          const width = Math.max(1, host!.clientWidth);
          const height = Math.max(1, host!.clientHeight);
          const halfHeight = 2.1;
          const halfWidth = halfHeight * width / height;
          camera.left = -halfWidth;
          camera.right = halfWidth;
          camera.top = halfHeight;
          camera.bottom = -halfHeight;
          camera.updateProjectionMatrix();
          const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
          if (renderer.getPixelRatio() !== dpr) renderer.setPixelRatio(dpr);
          const size = renderer.getSize(new THREE.Vector2());
          if (size.x !== width || size.y !== height) renderer.setSize(width, height, false);
          poseCritic(rig, criticId, controls.current, now / 1000, animate);
          const actorBounds = projectActorBounds(rig.root, camera);
          const center = actorBounds.getCenter(new THREE.Vector2());
          // Shift the orthographic view, not the model/pose. Include all props,
          // but never the contact shadow, when centering the full silhouette.
          const offsetX = center.x * halfWidth;
          const offsetY = center.y * halfHeight;
          camera.left += offsetX;
          camera.right += offsetX;
          camera.top += offsetY;
          camera.bottom += offsetY;
          camera.updateProjectionMatrix();
          feetCenter.set(0, 0, 0);
          for (const foot of rig.feet) feetCenter.add(foot.getWorldPosition(footPosition));
          feetCenter.divideScalar(rig.feet.length);
          ground.position.set(feetCenter.x, 0.004, feetCenter.z);
          if (dirty) {
            const bounds = projectActorBounds(rig.head, camera);
            // Reserve the entire 44px touch target above the hair. Reposition
            // only on state/size changes, never chase the breathing animation.
            stage!.parentElement?.style.setProperty("--critic-head-y", `${Math.max(0, stage!.offsetTop + (1 - bounds.max.y) * height / 2 - 46)}px`);
          }
          renderer.render(scene, camera);
          // Measured vertical opening in model units, sampled only after a
          // successful render. This is the mesh transform, not speaking state.
          canvas.dataset.mouthOpen = (rig.talkingMouth.visible ? rig.talkingMouth.scale.y * 2 : 0).toFixed(4);
          stage!.dataset.rendered = "true";
          lastPaint = now;
          dirty = false;
        } catch {
          fail();
          return;
        }
        reportReady();
      }
      if (animate) frameId = requestAnimationFrame(frame);
    }

    function wake() {
      cancelAnimationFrame(frameId);
      frameId = 0;
      dirty = true;
      if (!disposed && !document.hidden && visible) frameId = requestAnimationFrame(frame);
    }

    try {
      const context = canvas.getContext("webgl2", { alpha: true, antialias: true, powerPreference: "low-power" });
      if (!context || context.isContextLost()) {
        fail();
        return release;
      }
      renderer = new THREE.WebGLRenderer({ canvas, context, alpha: true, antialias: true });
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      const themed = paletteA !== undefined;
      renderer.toneMappingExposure = themed ? 1.06 : 1.18;
      scene = new THREE.Scene();
      camera = new THREE.OrthographicCamera(-2, 2, 2.19, -2.19, 0.1, 30);
      camera.position.set(0, 3.2, 8);
      camera.lookAt(0, 1.94, 0);
      camera.updateMatrixWorld();
      rig = buildCritic(criticId, resources);
      scene.add(rig.root);
      const ambientTint = new THREE.Color("#f4f1ff");
      const groundTint = new THREE.Color("#8d8390");
      const fillTint = new THREE.Color("#b5d7ee");
      const contactTint = new THREE.Color(themed ? "#74809d" : "#302a38");
      if (themed) {
        ambientTint.lerp(new THREE.Color(paletteA), 0.18);
        groundTint.lerp(new THREE.Color(paletteC), 0.25);
        fillTint.lerp(new THREE.Color(paletteB), 0.3);
        contactTint.lerp(new THREE.Color(paletteC), 0.3);
      }
      scene.add(new THREE.HemisphereLight(ambientTint, groundTint, themed ? 2.1 : 2.6));
      // Neutral key preserves outfit/prop clues; only ambient/fill are tinted.
      const key = new THREE.DirectionalLight("#fff1da", themed ? 3.2 : 3.5);
      key.position.set(-3, 6, 5);
      scene.add(key);
      const rim = new THREE.DirectionalLight(fillTint, themed ? 1.35 : 1.8);
      rim.position.set(3, 3, -3);
      scene.add(rim);
      // Original radial vertex-alpha contact shadow: compact, centered under
      // the feet and fully transparent at its edge. No cast-shadow trail,
      // textures, opaque ground rectangle or shadow-map render targets.
      const groundGeometry = new THREE.RingGeometry(0, 1, 48, 8);
      const positions = groundGeometry.getAttribute("position");
      const colors = new Float32Array(positions.count * 4);
      for (let i = 0; i < positions.count; i++) {
        const radiusSquared = positions.getX(i) ** 2 + positions.getY(i) ** 2;
        colors.set([1, 1, 1, Math.max(0, 1 - radiusSquared) ** 3], i * 4);
      }
      groundGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 4));
      const groundMaterial = new THREE.MeshBasicMaterial({
        color: contactTint, vertexColors: true, transparent: true,
        opacity: themed ? 0.22 : 0.18, depthWrite: false, toneMapped: false,
      });
      resources.geometries.add(groundGeometry);
      resources.materials.add(groundMaterial);
      ground = new THREE.Mesh(groundGeometry, groundMaterial);
      ground.name = "contact-shadow";
      ground.rotation.x = -Math.PI / 2;
      ground.scale.set(0.8, 0.44, 1);
      scene.add(ground);
      host.append(canvas);
      motion = window.matchMedia("(prefers-reduced-motion: reduce)");
      motion.addEventListener("change", wake);
      canvas.addEventListener("webglcontextlost", contextLost);
      document.addEventListener("visibilitychange", wake);
      window.addEventListener("resize", wake, { passive: true });
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(wake);
        resizeObserver.observe(host);
      }
      if (typeof IntersectionObserver !== "undefined") {
        intersectionObserver = new IntersectionObserver((entries) => {
          visible = entries[entries.length - 1]?.isIntersecting ?? false;
          wake();
        });
        intersectionObserver.observe(host);
      }
      wakeRef.current = wake;
      wake();
    } catch {
      fail();
    }
    return release;
  }, [criticId, paletteA, paletteB, paletteC]);

  return (
    <div
      className={[css.character, className].filter(Boolean).join(" ")}
      data-leaving={leaving}
      data-speaking={speaking}
      data-reaction={reaction}
      data-palette={!!palette}
      aria-hidden={leaving || undefined}
    >
      <div key={criticId} className={css.entrance}>
        <button
          type="button"
          className={css.change}
          aria-label="Change critic"
          title="Change critic"
          onClick={onChange}
          disabled={changeDisabled || leaving}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 7v5h-5M4 17v-5h5" />
            <path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17" />
          </svg>
        </button>
        <div
          ref={stageRef}
          className={css.stage}
          role="img"
          aria-label={`${portrait.name}, a fictional music critic. ${portrait.description}${speaking ? " Speaking." : ""}`}
        >
          <div ref={canvasHostRef} className={css.canvasHost} aria-hidden="true" />
        </div>
        <p ref={unavailableRef} className={css.unavailable} role="status" hidden>3D preview unavailable.</p>
      </div>
    </div>
  );
}
