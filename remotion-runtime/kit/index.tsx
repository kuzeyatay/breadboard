// The engine's component library: the reusable pieces a shot is built from.
// Everything here is a pure function of the frame, so any frame can be
// rendered on its own, in any order, and come out the same.

import React, { useEffect, useLayoutEffect, useRef } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

export { THREE };

// ---------------------------------------------------------------- timing

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const easeOut = Easing.bezier(0.16, 1, 0.3, 1);
export const easeIn = Easing.in(Easing.cubic);
export const easeInOut = Easing.inOut(Easing.cubic);

/** 0 before `from`, 1 after `to`, eased in between. */
export const ramp = (t: number, from: number, to: number, easing: (n: number) => number = easeOut) =>
  interpolate(t, [from, to], [0, 1], { ...clamp, easing });
/** 1 at the moment `at`, then decaying: the kick of something landing. */
export const hit = (t: number, at: number, decay = 9) => (t < at ? 0 : Math.exp(-decay * (t - at)));
/** 1 on every beat from `first`, falling away before the next. */
export const pulse = (t: number, first: number, beat: number, decay = 7) =>
  t < first ? 0 : Math.exp(-decay * ((t - first) % beat));
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;
/** A repeatable random number in [0, 1) for item `i`. */
export const rand = (i: number, salt = 0) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Seconds on the current sequence's clock. */
export const useTime = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return frame / fps;
};

// ---------------------------------------------------------------- 3D stage

export interface StageContext {
  THREE: typeof THREE;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  width: number;
  height: number;
}
/** Builds the scene once and returns the function that poses it for a time. */
export type StageBuild = (context: StageContext) => (time: number) => void;

interface StageState {
  update: (time: number) => void;
  render: () => void;
  dispose: () => void;
}

/**
 * A three.js scene rendered for the current frame, with optional bloom.
 * `build` runs once; the function it returns is called with the time of every
 * frame and must set the whole scene from that time alone.
 */
export const Stage3D: React.FC<{
  build: StageBuild;
  /** Seconds to pose the scene at. Defaults to the sequence clock. */
  time?: number;
  bloom?: { strength?: number; radius?: number; threshold?: number } | false;
  background?: string;
  fov?: number;
  exposure?: number;
  /** Draw over whatever is behind the canvas instead of a background colour. Turns bloom off. */
  transparent?: boolean;
  style?: React.CSSProperties;
}> = ({ build, time, bloom, background = "#000000", fov = 45, exposure = 1, transparent = false, style }) => {
  const clock = useTime();
  const { width, height } = useVideoConfig();
  const canvas = useRef<HTMLCanvasElement>(null);
  const state = useRef<StageState | null>(null);
  const at = time ?? clock;

  useLayoutEffect(() => {
    if (!state.current && canvas.current) {
      const renderer = new THREE.WebGLRenderer({ canvas: canvas.current, antialias: true, alpha: transparent, preserveDrawingBuffer: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(width, height, false);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = exposure;
      const scene = new THREE.Scene();
      if (transparent) renderer.setClearColor(0x000000, 0);
      else scene.background = new THREE.Color(background);
      const camera = new THREE.PerspectiveCamera(fov, width / height, 0.05, 500);
      camera.position.set(0, 0, 6);
      const update = build({ THREE, scene, camera, renderer, width, height });
      let render = () => renderer.render(scene, camera);
      if (bloom && !transparent) {
        const composer = new EffectComposer(renderer);
        composer.setPixelRatio(window.devicePixelRatio);
        composer.setSize(width, height);
        composer.addPass(new RenderPass(scene, camera));
        composer.addPass(
          new UnrealBloomPass(new THREE.Vector2(width, height), bloom.strength ?? 0.9, bloom.radius ?? 0.6, bloom.threshold ?? 0.2),
        );
        composer.addPass(new OutputPass());
        render = () => composer.render();
      }
      state.current = { update, render, dispose: () => renderer.dispose() };
    }
    state.current?.update(at);
    state.current?.render();
  });
  useEffect(() => () => state.current?.dispose(), []);

  return <canvas ref={canvas} width={width} height={height} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", ...style }} />;
};

/** Place the camera on a sphere around `target` and look at it. Angles in radians. */
export function orbit(
  camera: THREE.PerspectiveCamera,
  radius: number,
  azimuth: number,
  elevation: number,
  target: [number, number, number] = [0, 0, 0],
) {
  camera.position.set(
    target[0] + radius * Math.cos(elevation) * Math.sin(azimuth),
    target[1] + radius * Math.sin(elevation),
    target[2] + radius * Math.cos(elevation) * Math.cos(azimuth),
  );
  camera.lookAt(target[0], target[1], target[2]);
}

// ---------------------------------------------------------------- particles

export interface GlowPoints {
  points: THREE.Points;
  /** xyz per point. Write, then call `commit()`. */
  position: Float32Array;
  /** rgb per point, 0 to 1 and above for brighter-than-white. */
  color: Float32Array;
  /** One size multiplier per point. */
  scale: Float32Array;
  /** Send the arrays to the GPU, drawing the first `count` points. */
  commit: (count?: number) => void;
}

/**
 * Soft points. In "glow" mode they add up like light: thousands overlapping
 * build ribbons, clouds and glowing shapes, especially under bloom, so keep
 * each colour dim (0.02 to 0.2). In "ink" mode they are opaque dots of their
 * own colour, for dark marks on a light ground.
 */
export function glowPoints(context: StageContext, count: number, size = 0.05, mode: "glow" | "ink" = "glow"): GlowPoints {
  const geometry = new THREE.BufferGeometry();
  const position = new Float32Array(count * 3);
  const color = new Float32Array(count * 3).fill(1);
  const scale = new Float32Array(count).fill(1);
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(color, 3));
  geometry.setAttribute("scale", new THREE.BufferAttribute(scale, 1));
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: mode === "glow" ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uSize: { value: size * context.height * context.renderer.getPixelRatio() } },
    vertexShader: `
      attribute vec3 color;
      attribute float scale;
      uniform float uSize;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = uSize * scale / max(0.05, -view.z);
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `
      const bool INK = ${mode === "ink"};
      varying vec3 vColor;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = INK ? vec4(vColor, a) : vec4(vColor * a * a, 1.0);
      }`,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  context.scene.add(points);
  return {
    points,
    position,
    color,
    scale,
    commit: (drawn = count) => {
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
      geometry.attributes.scale.needsUpdate = true;
      geometry.setDrawRange(0, Math.max(0, Math.min(count, Math.floor(drawn))));
    },
  };
}

const lorenzCache = new Map<string, Float32Array>();
/** A Lorenz attractor trajectory, centred on the origin, about 50 units across. */
export function lorenz(count: number, start: [number, number, number] = [0.1, 0, 0], dt = 0.006): Float32Array {
  const key = `${count}:${start.join(",")}:${dt}`;
  const cached = lorenzCache.get(key);
  if (cached) return cached;
  const path = new Float32Array(count * 3);
  let [x, y, z] = start;
  for (let i = -400; i < count; i += 1) {
    const dx = 10 * (y - x);
    const dy = x * (28 - z) - y;
    const dz = x * y - (8 / 3) * z;
    x += dx * dt;
    y += dy * dt;
    z += dz * dt;
    if (i >= 0) path.set([x, z - 25, y], i * 3);
  }
  lorenzCache.set(key, path);
  return path;
}

/**
 * Points scattered inside whatever `draw` paints on a canvas: a logo, a word,
 * any shape. Returns xy pairs with y up, x in [-aspect, aspect] and y in [-1, 1].
 */
export function pointsFromCanvas(
  width: number,
  height: number,
  draw: (context: CanvasRenderingContext2D) => void,
  count: number,
  seed = 1,
): Float32Array {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  draw(context);
  const pixels = context.getImageData(0, 0, width, height).data;
  const filled: number[] = [];
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 128) filled.push((i - 3) / 4);
  const result = new Float32Array(count * 2);
  if (!filled.length) return result;
  for (let i = 0; i < count; i += 1) {
    const pixel = filled[Math.floor(rand(i, seed) * filled.length)];
    const px = (pixel % width) + rand(i, seed + 1);
    const py = Math.floor(pixel / width) + rand(i, seed + 2);
    result[i * 2] = ((px / width) * 2 - 1) * (width / height);
    result[i * 2 + 1] = 1 - (py / height) * 2;
  }
  return result;
}

/** A smooth, swirling vector field: where a drifting particle is pushed. */
export function flow(x: number, y: number, z: number, t: number): [number, number, number] {
  return [
    Math.sin(y * 1.3 + t * 0.7) + Math.cos(z * 1.7 - t * 0.5),
    Math.sin(z * 1.1 + t * 0.6) + Math.cos(x * 1.5 + t * 0.4),
    Math.sin(x * 1.2 - t * 0.8) + Math.cos(y * 1.6 + t * 0.3),
  ];
}

// ---------------------------------------------------------------- 2D layers

/** A line that rises from behind a mask, and can leave upward. */
export const Rise: React.FC<{ t: number; at: number; leave?: number; children: React.ReactNode }> = ({ t, at, leave, children }) => {
  const y = (1 - ramp(t, at, at + 0.5)) * 110 - (leave === undefined ? 0 : ramp(t, leave, leave + 0.3, easeIn) * 110);
  return (
    <div style={{ overflow: "hidden", padding: "0.12em 0.06em", margin: "-0.12em -0.06em" }}>
      <div style={{ translate: `0px ${y}%` }}>{children}</div>
    </div>
  );
};

/** A word whose letters come up one after another. */
export const Letters: React.FC<{ t: number; at: number; word: string; step?: number }> = ({ t, at, word, step = 0.03 }) => (
  <div style={{ display: "flex", overflow: "hidden", padding: "0.12em 0.06em", margin: "-0.12em -0.06em" }}>
    {[...word].map((letter, index) => (
      <span key={index} style={{ display: "inline-block", whiteSpace: "pre", translate: `0px ${(1 - ramp(t, at + index * step, at + index * step + 0.5)) * 115}%` }}>
        {letter}
      </span>
    ))}
  </div>
);

/** A quiet label in the lower left, the way a film names what is on screen. */
export const Caption: React.FC<{
  t: number;
  at?: number;
  leave?: number;
  title: string;
  note?: string;
  color?: string;
  fontFamily?: string;
  titleFamily?: string;
}> = ({ t, at = 0.2, leave, title, note, color = "#FFFFFF", fontFamily, titleFamily }) => (
  <div style={{ position: "absolute", left: 96, bottom: 84, color, fontFamily }}>
    <div style={{ fontFamily: titleFamily ?? fontFamily, fontSize: 92, fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.05 }}>
      <Rise t={t} at={at} leave={leave}>{title}</Rise>
    </div>
    {note ? (
      <div style={{ fontSize: 34, opacity: 0.72, marginTop: 14, letterSpacing: "0.005em" }}>
        <Rise t={t} at={at + 0.12} leave={leave === undefined ? undefined : leave + 0.04}>{note}</Rise>
      </div>
    ) : null}
  </div>
);

/** Fine film grain over everything beneath it. */
export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.07 }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ opacity, mixBlendMode: "overlay", pointerEvents: "none" }}>
      <svg width="100%" height="100%">
        <filter id="kit-grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={frame % 12} />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#kit-grain)" />
      </svg>
    </AbsoluteFill>
  );
};

/** Darkens the corners so the eye stays on the subject. */
export const Vignette: React.FC<{ strength?: number }> = ({ strength = 0.55 }) => (
  <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 50%, rgba(0,0,0,0) 45%, rgba(0,0,0,${strength}) 100%)`, pointerEvents: "none" }} />
);
