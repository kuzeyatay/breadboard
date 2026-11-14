import React from "react";
import { AbsoluteFill, Audio, Sequence, useVideoConfig } from "remotion";
import * as THREE from "three";
import {
  Caption,
  Grain,
  Rise,
  Stage3D,
  Vignette,
  easeInOut,
  easeOut,
  flow,
  glowPoints,
  hit,
  lorenz,
  mix,
  orbit,
  pulse,
  ramp,
  rand,
  useTime,
  type StageBuild,
} from "@kit";
import { loadFont as loadDisplay } from "@remotion/google-fonts/PlayfairDisplay";
import { loadFont as loadBody } from "@remotion/google-fonts/PlusJakartaSans";

const displayLoaded = loadDisplay("normal", {
  weights: ["500", "600"],
  subsets: ["latin", "latin-ext"],
});

const bodyLoaded = loadBody("normal", {
  weights: ["400", "500"],
  subsets: ["latin", "latin-ext"],
});

const DISPLAY_FONT = displayLoaded.fontFamily;
const BODY_FONT = bodyLoaded.fontFamily;

const BG_DARK = "#0C0D0A";
const BG_LIGHT = "#EAE3D6";
const CREAM = "#ECE6DA";
const SUB_LIGHT = "#CFC5B4";
const ACCENT_SAGE = "#8AA380";
const SAGE_INK = "#4E6649";
const ESPRESSO_INK = "#1B1815";

const BEAT = 0.75;
const T_DROP = 3.0;
const T_POUR_HITS = [6.0, 9.0] as const;
const T_ROLL1 = [11.21, 11.46, 11.68] as const;
const T_ROLL2 = [14.24, 14.52, 14.81] as const;
const T_SCENE3_MID = 15.01;
const T_FINALE_HIT = 24.01;

const SCENES = [
  { id: "morning-mist", start: 0, end: 3.0 },
  { id: "the-pour", start: 3.0, end: 12.0 },
  { id: "crema-daylight", start: 12.0, end: 18.0 },
  { id: "steam-craft", start: 18.0, end: 21.0 },
  { id: "brand-finale", start: 21.0, end: 26.0 },
] as const;

interface CupOptions {
  cupColor?: number;
  saucerColor?: number;
  tableColor?: number;
  cremaColor?: number;
  espressoColor?: number;
}

function createCupAssembly(opts: CupOptions = {}) {
  const root = new THREE.Group();

  const cupMat = new THREE.MeshStandardMaterial({
    color: opts.cupColor ?? 0xebe5d9,
    roughness: 0.34,
    metalness: 0.05,
  });

  const saucerMat = new THREE.MeshStandardMaterial({
    color: opts.saucerColor ?? 0xe2dbce,
    roughness: 0.38,
    metalness: 0.04,
  });

  const tableMat = new THREE.MeshStandardMaterial({
    color: opts.tableColor ?? 0x151310,
    roughness: 0.7,
    metalness: 0.05,
  });

  const tableGeo = new THREE.CylinderGeometry(8.5, 8.5, 0.2, 64);
  const table = new THREE.Mesh(tableGeo, tableMat);
  table.position.y = -0.22;
  root.add(table);

  const saucerProfile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.75, 0.0),
    new THREE.Vector2(0.95, 0.03),
    new THREE.Vector2(1.48, 0.16),
    new THREE.Vector2(1.52, 0.21),
    new THREE.Vector2(1.42, 0.22),
    new THREE.Vector2(0.78, 0.08),
    new THREE.Vector2(0.58, 0.05),
    new THREE.Vector2(0.0, 0.05),
  ];
  const saucerGeo = new THREE.LatheGeometry(saucerProfile, 64);
  const saucer = new THREE.Mesh(saucerGeo, saucerMat);
  saucer.position.y = -0.11;
  root.add(saucer);

  const cupProfile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.46, 0.0),
    new THREE.Vector2(0.5, 0.05),
    new THREE.Vector2(0.68, 0.32),
    new THREE.Vector2(0.79, 0.74),
    new THREE.Vector2(0.84, 1.18),
    new THREE.Vector2(0.84, 1.24),
    new THREE.Vector2(0.78, 1.27),
    new THREE.Vector2(0.74, 1.23),
    new THREE.Vector2(0.69, 0.76),
    new THREE.Vector2(0.58, 0.32),
    new THREE.Vector2(0.44, 0.12),
    new THREE.Vector2(0.0, 0.12),
  ];
  const cupGeo = new THREE.LatheGeometry(cupProfile, 64);
  const cup = new THREE.Mesh(cupGeo, cupMat);
  root.add(cup);

  const handleCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.77, 1.02, 0),
    new THREE.Vector3(1.16, 1.05, 0),
    new THREE.Vector3(1.24, 0.74, 0),
    new THREE.Vector3(1.06, 0.45, 0),
    new THREE.Vector3(0.68, 0.36, 0),
  ]);
  const handleGeo = new THREE.TubeGeometry(handleCurve, 32, 0.072, 16, false);
  const handle = new THREE.Mesh(handleGeo, cupMat);
  root.add(handle);

  const espressoMat = new THREE.MeshStandardMaterial({
    color: opts.espressoColor ?? 0x1e130c,
    roughness: 0.12,
    metalness: 0.08,
  });
  const liquidGeo = new THREE.CylinderGeometry(0.71, 0.49, 1.0, 48);
  const liquid = new THREE.Mesh(liquidGeo, espressoMat);
  liquid.visible = false;
  root.add(liquid);

  const cremaMat = new THREE.MeshStandardMaterial({
    color: opts.cremaColor ?? 0xd6c3a1,
    emissive: 0x3b2f1d,
    emissiveIntensity: 0.3,
    roughness: 0.28,
    metalness: 0.06,
  });
  const cremaGeo = new THREE.CircleGeometry(1, 48);
  const crema = new THREE.Mesh(cremaGeo, cremaMat);
  crema.rotation.x = -Math.PI / 2;
  crema.visible = false;
  root.add(crema);

  const swirlMat = new THREE.MeshStandardMaterial({
    color: 0x5c4228,
    emissive: 0x261a0e,
    emissiveIntensity: 0.2,
    roughness: 0.35,
  });
  const swirlGeo = new THREE.RingGeometry(0.28, 0.42, 48);
  const swirl = new THREE.Mesh(swirlGeo, swirlMat);
  swirl.rotation.x = -Math.PI / 2;
  swirl.visible = false;
  root.add(swirl);

  const rippleGroup = new THREE.Group();
  const rippleMats: THREE.MeshBasicMaterial[] = [];
  const rippleMeshes: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i += 1) {
    const rGeo = new THREE.RingGeometry(0.84, 0.94, 48);
    const rMat = new THREE.MeshBasicMaterial({
      color: 0xe6dac4,
      transparent: true,
      opacity: 0.0,
      side: THREE.DoubleSide,
    });
    const rMesh = new THREE.Mesh(rGeo, rMat);
    rMesh.rotation.x = -Math.PI / 2;
    rippleGroup.add(rMesh);
    rippleMats.push(rMat);
    rippleMeshes.push(rMesh);
  }
  root.add(rippleGroup);

  const setFill = (fill: number, t: number, impact: number) => {
    const clamped = Math.max(0, Math.min(1, fill));
    if (clamped <= 0.002) {
      liquid.visible = false;
      crema.visible = false;
      swirl.visible = false;
      for (const m of rippleMats) m.opacity = 0;
      return root.position.y + 0.15;
    }

    const minY = 0.14;
    const maxY = 1.13;
    const topY = mix(minY + 0.06, maxY, clamped);
    const height = Math.max(0.04, topY - minY);
    const radiusAtTop = mix(0.49, 0.72, clamped);

    liquid.visible = true;
    liquid.scale.set(mix(0.75, 1.0, clamped), height, mix(0.75, 1.0, clamped));
    liquid.position.y = minY + height * 0.5;

    crema.visible = true;
    crema.position.y = topY + 0.004;
    crema.scale.setScalar(radiusAtTop * 0.99);
    crema.rotation.z = t * 0.4;

    swirl.visible = true;
    swirl.position.set(
      Math.cos(t * 0.5) * 0.06,
      topY + 0.007,
      Math.sin(t * 0.5) * 0.06
    );
    swirl.scale.setScalar(radiusAtTop * 0.92);
    swirl.rotation.z = -t * 0.55;

    for (let i = 0; i < 3; i += 1) {
      const phase = (t * 1.45 + i / 3) % 1;
      const rScale = radiusAtTop * mix(0.12, 0.96, phase);
      rippleMeshes[i].position.y = topY + 0.009;
      rippleMeshes[i].scale.setScalar(rScale);
      rippleMats[i].opacity = impact * (1 - phase) * 0.62;
    }

    return root.position.y + topY;
  };

  return { root, setFill };
}

function createPourSpout() {
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.position.set(1.55, 2.25, 0);
  root.add(pivot);

  const steelMat = new THREE.MeshStandardMaterial({
    color: 0xd8cfc0,
    roughness: 0.22,
    metalness: 0.88,
  });

  const matteDarkMat = new THREE.MeshStandardMaterial({
    color: 0x261f1a,
    roughness: 0.4,
    metalness: 0.14,
  });

  const bodyProfile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.54, 0.0),
    new THREE.Vector2(0.58, 0.14),
    new THREE.Vector2(0.44, 1.05),
    new THREE.Vector2(0.38, 1.12),
    new THREE.Vector2(0.0, 1.12),
  ];
  const kettleBody = new THREE.Mesh(
    new THREE.LatheGeometry(bodyProfile, 40),
    matteDarkMat
  );
  kettleBody.position.set(0.35, -0.35, 0);
  pivot.add(kettleBody);

  const lidRim = new THREE.Mesh(
    new THREE.TorusGeometry(0.4, 0.032, 16, 40),
    steelMat
  );
  lidRim.rotation.x = Math.PI / 2;
  lidRim.position.set(0.35, 0.77, 0);
  pivot.add(lidRim);

  const neckCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.05, -0.1, 0),
    new THREE.Vector3(-0.32, 0.05, 0),
    new THREE.Vector3(-0.56, 0.36, 0),
    new THREE.Vector3(-0.84, 0.44, 0),
    new THREE.Vector3(-0.98, 0.36, 0),
  ]);
  const neckGeo = new THREE.TubeGeometry(neckCurve, 32, 0.06, 16, false);
  const neck = new THREE.Mesh(neckGeo, steelMat);
  pivot.add(neck);

  const tipLocal = new THREE.Vector3(-0.98, 0.36, 0);

  const update = (tilt: number, t: number) => {
    pivot.rotation.z = tilt;
    pivot.position.y = 2.25 + Math.sin(t * 1.5) * 0.035;
    pivot.updateMatrixWorld(true);
    return tipLocal.clone().applyMatrix4(pivot.matrixWorld);
  };

  return { root, update };
}

function createPourStream() {
  const lengthSegs = 36;
  const radialSegs = 14;
  const vertexCount = (lengthSegs + 1) * (radialSegs + 1);
  const positions = new Float32Array(vertexCount * 3);
  const indices: number[] = [];

  for (let iy = 0; iy < lengthSegs; iy += 1) {
    for (let ix = 0; ix < radialSegs; ix += 1) {
      const a = iy * (radialSegs + 1) + ix;
      const b = a + radialSegs + 1;
      const c = b + 1;
      const d = a + 1;
      indices.push(a, b, d);
      indices.push(b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);

  const mat = new THREE.MeshStandardMaterial({
    color: 0x5c3a21,
    emissive: 0x85633a,
    emissiveIntensity: 0.65,
    roughness: 0.08,
    metalness: 0.2,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;

  const update = (
    tip: THREE.Vector3,
    liquidTopY: number,
    t: number,
    strength: number
  ) => {
    if (strength <= 0.01) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;

    const posAttr = geo.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;

    for (let iy = 0; iy <= lengthSegs; iy += 1) {
      const s = iy / lengthSegs;
      const cx = mix(tip.x, 0, Math.pow(s, 0.72));
      const cy = mix(tip.y, liquidTopY - 0.04, Math.pow(s, 1.48));
      const cz = tip.z + Math.sin(s * 9 - t * 14) * 0.015 * s;

      const sNext = Math.min(1, s + 0.02);
      const nx = mix(tip.x, 0, Math.pow(sNext, 0.72)) - cx;
      const ny = mix(tip.y, liquidTopY - 0.04, Math.pow(sNext, 1.48)) - cy;
      const nz = tip.z + Math.sin(sNext * 9 - t * 14) * 0.015 * sNext - cz;

      const tLen = Math.hypot(nx, ny, nz) || 1;
      const tx = nx / tLen;
      const ty = ny / tLen;
      const tz = nz / tLen;

      let ux = -ty;
      let uy = tx;
      let uz = 0;
      const uLen = Math.hypot(ux, uy, uz) || 1;
      ux /= uLen;
      uy /= uLen;

      const bx = ty * uz - tz * uy;
      const by = tz * ux - tx * uz;
      const bz = tx * uy - ty * ux;

      const ripple = 1 + 0.11 * Math.sin(s * 18 - t * 24);
      const radius = 0.07 * strength * (1 - 0.34 * s) * ripple;

      for (let ix = 0; ix <= radialSegs; ix += 1) {
        const theta = (ix / radialSegs) * Math.PI * 2;
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);
        const idx = (iy * (radialSegs + 1) + ix) * 3;
        arr[idx] = cx + (ux * cosT + bx * sinT) * radius;
        arr[idx + 1] = cy + (uy * cosT + by * sinT) * radius;
        arr[idx + 2] = cz + (uz * cosT + bz * sinT) * radius;
      }
    }

    posAttr.needsUpdate = true;
    geo.computeVertexNormals();
  };

  return { mesh, update };
}

function createCoffeeBeans(count: number) {
  const geo = new THREE.SphereGeometry(1, 20, 14);
  geo.scale(0.11, 0.075, 0.155);

  const mat = new THREE.MeshStandardMaterial({
    color: 0x382417,
    roughness: 0.4,
    metalness: 0.1,
  });

  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const dummy = new THREE.Object3D();

  const setBean = (
    i: number,
    x: number,
    y: number,
    z: number,
    rx: number,
    ry: number,
    rz: number,
    scale = 1
  ) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(rx, ry, rz);
    dummy.scale.setScalar(scale * (0.9 + rand(i, 91) * 0.2));
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  };

  const commit = () => {
    mesh.instanceMatrix.needsUpdate = true;
  };

  return { mesh, setBean, commit };
}

const buildMorningMist: StageBuild = (ctx) => {
  const { scene } = ctx;

  const ambient = new THREE.AmbientLight(0x3a352e, 1.6);
  scene.add(ambient);

  const leafSun = new THREE.DirectionalLight(0xf2e7d5, 2.8);
  leafSun.position.set(-2.8, 4.5, 2.4);
  scene.add(leafSun);

  const sageRim = new THREE.PointLight(0x88a67d, 2.8, 12);
  sageRim.position.set(2.5, 2.2, -2.5);
  scene.add(sageRim);

  const rig = createCupAssembly({
    cupColor: 0xece6da,
    saucerColor: 0xe0d9cb,
    tableColor: 0x12130f,
  });
  rig.root.position.set(0, -0.65, 0);
  scene.add(rig.root);

  const COUNT = 18_000;
  const canopyDust = glowPoints(ctx, COUNT, 0.023);

  return (t) => {
    rig.setFill(0, t, 0);

    for (let i = 0; i < COUNT; i += 1) {
      const a = rand(i, 1) * Math.PI * 2 + t * 0.1;
      const r = 1.4 + rand(i, 2) * 4.5;
      const baseX = Math.cos(a) * r;
      const baseZ = Math.sin(a) * r;
      const baseY = -0.8 + rand(i, 3) * 3.8;
      const [fx, fy, fz] = flow(baseX * 0.45, baseY * 0.45, baseZ * 0.45, t * 0.6);
      const px = baseX + fx * 0.45;
      const py = baseY + fy * 0.25;
      const pz = baseZ + fz * 0.45;
      const isLeaf = rand(i, 4) > 0.45;
      const shimmer = 0.55 + 0.45 * Math.sin(t * 2.1 + rand(i, 5) * 10);
      const b = 0.036 + 0.044 * shimmer;
      canopyDust.position.set([px, py, pz], i * 3);
      if (isLeaf) {
        canopyDust.color.set([b * 0.55, b * 0.82, b * 0.52], i * 3);
      } else {
        canopyDust.color.set([b * 0.96, b * 0.89, b * 0.75], i * 3);
      }
    }
    canopyDust.commit();

    const p = ramp(t, 0, 3.0);
    const radius = mix(6.5, 4.3, p);
    const azimuth = mix(-0.48, 0.18, p);
    const elevation = mix(0.28, 0.37, p);
    orbit(ctx.camera, radius, azimuth, elevation, [0, -0.05, 0]);
  };
};

const MorningMist: React.FC<{ t: number }> = ({ t }) => (
  <AbsoluteFill style={{ backgroundColor: BG_DARK }}>
    <Stage3D
      build={buildMorningMist}
      time={t}
      bloom={{ strength: 0.75, radius: 0.55, threshold: 0.22 }}
      background={BG_DARK}
      fov={42}
    />
    <Caption
      t={t}
      title="Kozyatağı"
      note="A balcony among the trees"
      color={CREAM}
      titleFamily={DISPLAY_FONT}
      fontFamily={BODY_FONT}
    />
  </AbsoluteFill>
);

const buildThePour: StageBuild = (ctx) => {
  const { scene } = ctx;

  const ambient = new THREE.AmbientLight(0x3b322a, 1.45);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xf7ecd9, 3.0);
  keyLight.position.set(3.4, 5.2, 3.2);
  scene.add(keyLight);

  const rimLight = new THREE.PointLight(0xe0d3ba, 4.4, 14);
  rimLight.position.set(-2.6, 2.8, -2.0);
  scene.add(rimLight);

  const streamLight = new THREE.PointLight(0xf3e7d0, 3.5, 10);
  streamLight.position.set(0.4, 1.9, 1.8);
  scene.add(streamLight);

  const rig = createCupAssembly({
    cupColor: 0xebe5d9,
    saucerColor: 0xe0d9cb,
    tableColor: 0x13120f,
    cremaColor: 0xd6c3a1,
    espressoColor: 0x1c110a,
  });
  rig.root.position.set(0, -0.68, 0);
  scene.add(rig.root);

  const spout = createPourSpout();
  scene.add(spout.root);

  const stream = createPourStream();
  scene.add(stream.mesh);

  const SPLASH_COUNT = 5_500;
  const splash = glowPoints(ctx, SPLASH_COUNT, 0.022);

  const STEAM_COUNT = 16_000;
  const steam = glowPoints(ctx, STEAM_COUNT, 0.025);

  return (t) => {
    const globalT = 3.0 + t;
    const beatBump = pulse(t, 0, BEAT, 4.0);
    const rollBump =
      hit(globalT, T_ROLL1[0], 6.0) +
      hit(globalT, T_ROLL1[1], 6.0) +
      hit(globalT, T_ROLL1[2], 6.0);

    const startPour = ramp(t, 0.06, 0.5, easeOut);
    const endPour = 1 - ramp(t, 7.4, 8.2, easeInOut);
    const streamStrength = Math.max(0, startPour * endPour);

    const fillAmount = ramp(t, 0.3, 7.8, easeInOut);
    const liquidTopWorldY = rig.setFill(fillAmount, t, streamStrength + rollBump * 0.45);

    const spoutTilt =
      mix(0.05, 0.42, startPour) * mix(1.0, 0.15, ramp(t, 7.5, 8.5, easeInOut));
    const tipWorld = spout.update(spoutTilt, t);

    stream.update(
      tipWorld,
      liquidTopWorldY,
      t,
      streamStrength * (1 + beatBump * 0.14)
    );

    rimLight.intensity = 4.2 + beatBump * 0.9 + rollBump * 1.2;

    for (let i = 0; i < SPLASH_COUNT; i += 1) {
      const cycle = (t * (1.3 + rand(i, 1) * 0.85) + rand(i, 2)) % 1;
      const angle = rand(i, 3) * Math.PI * 2;
      const maxR = 0.09 + rand(i, 4) * 0.54;
      const r = cycle * maxR;
      const arcH = Math.sin(cycle * Math.PI) * (0.16 + rand(i, 5) * 0.26);
      const px = Math.cos(angle) * r;
      const pz = Math.sin(angle) * r;
      const py = liquidTopWorldY + arcH;
      const vis = streamStrength * Math.sin(cycle * Math.PI);
      const lum = (0.07 + 0.065 * beatBump) * vis;
      splash.position.set([px, py, pz], i * 3);
      splash.color.set([lum * 0.96, lum * 0.88, lum * 0.72], i * 3);
    }
    splash.commit();

    const steamRise = ramp(t, 1.1, 3.6, easeOut);
    for (let i = 0; i < STEAM_COUNT; i += 1) {
      const phase = (t * (0.34 + rand(i, 6) * 0.2) + rand(i, 7)) % 1;
      const swirlAngle = rand(i, 8) * Math.PI * 2 + phase * 2.4 + t * 0.28;
      const spread = 0.08 + phase * 0.54 * rand(i, 9);
      const x = Math.cos(swirlAngle) * spread;
      const z = Math.sin(swirlAngle) * spread;
      const y = liquidTopWorldY + 0.05 + phase * 2.15;
      const [fx, fy, fz] = flow(x * 0.9, y * 0.7, z * 0.9, t * 0.75);
      const fade = Math.sin(phase * Math.PI) * steamRise;
      const lum = (0.036 + 0.025 * rollBump) * fade;
      steam.position.set([x + fx * 0.26, y + fy * 0.09, z + fz * 0.26], i * 3);
      steam.color.set([lum * 0.96, lum * 0.91, lum * 0.82], i * 3);
    }
    steam.commit();

    if (globalT < T_POUR_HITS[0]) {
      const p = ramp(t, 0, 3.0);
      orbit(
        ctx.camera,
        mix(4.95, 3.95, p),
        mix(0.22, 0.88, p),
        mix(0.38, 0.3, p),
        [0.14, 0.35, 0]
      );
    } else if (globalT < T_POUR_HITS[1]) {
      const p = ramp(t, 3.0, 6.0);
      orbit(
        ctx.camera,
        mix(3.25, 3.6, p),
        mix(1.35, 2.55, p),
        mix(0.18, 0.3, p),
        [0, 0.16, 0]
      );
    } else {
      const p = ramp(t, 6.0, 9.0);
      orbit(
        ctx.camera,
        mix(3.95, 4.75, p),
        mix(2.6, 3.6, p),
        mix(0.5, 0.74, p),
        [0, 0.14, 0]
      );
    }
  };
};

const ThePour: React.FC<{ t: number }> = ({ t }) => (
  <AbsoluteFill style={{ backgroundColor: BG_DARK }}>
    <Stage3D
      build={buildThePour}
      time={t}
      bloom={{ strength: 0.7, radius: 0.55, threshold: 0.24 }}
      background={BG_DARK}
      fov={42}
    />
    <div
      style={{
        position: "absolute",
        left: 88,
        bottom: 84,
        maxWidth: 480,
      }}
    >
      <Rise t={t} at={0.55} leave={7.8}>
        <div
          style={{
            fontFamily: DISPLAY_FONT,
            fontSize: 48,
            fontWeight: 500,
            lineHeight: 1.1,
            color: CREAM,
            letterSpacing: "-0.01em",
          }}
        >
          Freshly poured
        </div>
      </Rise>
      <Rise t={t} at={0.85} leave={7.6}>
        <div
          style={{
            fontFamily: BODY_FONT,
            fontSize: 19,
            fontWeight: 400,
            color: SUB_LIGHT,
            marginTop: 10,
            letterSpacing: "0.01em",
          }}
        >
          Espresso and filter, until 01:00
        </div>
      </Rise>
    </div>
  </AbsoluteFill>
);

const buildDaylight: StageBuild = (ctx) => {
  const { scene } = ctx;

  const ambient = new THREE.AmbientLight(0xf3ece0, 1.85);
  scene.add(ambient);

  const sunKey = new THREE.DirectionalLight(0xfff7ea, 2.5);
  sunKey.position.set(3.5, 6.5, 2.5);
  scene.add(sunKey);

  const coolFill = new THREE.DirectionalLight(0xdbe6d5, 1.1);
  coolFill.position.set(-4.0, 4.0, -3.0);
  scene.add(coolFill);

  const rig = createCupAssembly({
    cupColor: 0xf4eee4,
    saucerColor: 0xe6dfd1,
    tableColor: 0xeae3d6,
    cremaColor: 0xcab591,
    espressoColor: 0x1d120b,
  });
  rig.root.position.set(0.45, -0.5, 0);
  scene.add(rig.root);

  const BEAN_COUNT = 32;
  const beans = createCoffeeBeans(BEAN_COUNT);
  scene.add(beans.mesh);

  const INK_COUNT = 6_000;
  const inkDust = glowPoints(ctx, INK_COUNT, 0.014, "ink");

  return (t) => {
    const globalT = 12.0 + t;
    const rollPulse =
      hit(globalT, T_ROLL2[0], 5.5) * 0.35 +
      hit(globalT, T_ROLL2[1], 5.5) * 0.35 +
      hit(globalT, T_ROLL2[2], 5.5) * 0.35 +
      hit(globalT, T_SCENE3_MID, 3.0) * 0.55;

    rig.setFill(1.0, t, 0.14 + rollPulse * 0.25);

    for (let i = 0; i < BEAN_COUNT; i += 1) {
      const orbitAngle = (i / BEAN_COUNT) * Math.PI * 2 + t * 0.2 + rand(i, 1) * 0.3;
      const ringRadius = 1.65 + rand(i, 2) * 1.75;
      const bounce = rollPulse * 0.08 * (i % 3 === 0 ? 1 : 0.4);
      const bx = 0.45 + Math.cos(orbitAngle) * ringRadius;
      const bz = Math.sin(orbitAngle) * ringRadius;
      const by =
        -0.56 + (rand(i, 3) > 0.65 ? 0.16 + Math.sin(t * 1.8 + i) * 0.05 : 0) + bounce;
      const scale = 0.85 + rand(i, 4) * 0.45;
      beans.setBean(
        i,
        bx,
        by,
        bz,
        rand(i, 5) * Math.PI + t * 0.35,
        orbitAngle + rand(i, 6) * 2.0,
        rand(i, 7) * 0.6,
        scale
      );
    }
    beans.commit();

    for (let i = 0; i < INK_COUNT; i += 1) {
      const a = rand(i, 10) * Math.PI * 2 + t * 0.08;
      const r = 1.8 + rand(i, 11) * 4.2;
      const px = 0.45 + Math.cos(a) * r;
      const pz = Math.sin(a) * r;
      const py = -0.58 + rand(i, 12) * 1.2;
      inkDust.position.set([px, py, pz], i * 3);
      inkDust.color.set([0.2, 0.16, 0.12], i * 3);
    }
    inkDust.commit();

    const move = ramp(t, 0, 6.0);
    const radius = mix(5.4, 3.65, move) - rollPulse * 0.06;
    const elevation = mix(1.18, 0.92, move);
    const azimuth = mix(-0.3, 0.72, move);
    orbit(ctx.camera, radius, azimuth, elevation, [0.35, -0.22, 0]);
  };
};

const CremaDaylight: React.FC<{ t: number }> = ({ t }) => (
  <AbsoluteFill style={{ backgroundColor: BG_LIGHT }}>
    <Stage3D build={buildDaylight} time={t} background={BG_LIGHT} fov={38} />
    <div
      style={{
        position: "absolute",
        left: 88,
        top: 84,
        maxWidth: 460,
      }}
    >
      <Rise t={t} at={0.25}>
        <div
          style={{
            fontFamily: DISPLAY_FONT,
            fontSize: 54,
            fontWeight: 600,
            lineHeight: 1.08,
            color: ESPRESSO_INK,
            letterSpacing: "-0.015em",
          }}
        >
          Balkon Sefası
        </div>
      </Rise>
      <Rise t={t} at={0.55}>
        <div
          style={{
            fontFamily: BODY_FONT,
            fontSize: 20,
            fontWeight: 500,
            color: SAGE_INK,
            marginTop: 14,
            letterSpacing: "0.01em",
          }}
        >
          Specialty coffee and homemade cakes
        </div>
      </Rise>
    </div>
  </AbsoluteFill>
);

const STEAM_RIBBON = lorenz(2400);

const buildSteamCraft: StageBuild = (ctx) => {
  const { scene } = ctx;

  const ambient = new THREE.AmbientLight(0x35302a, 1.3);
  scene.add(ambient);

  const rimWarm = new THREE.PointLight(0xdfd2b8, 4.4, 12);
  rimWarm.position.set(-2.4, 2.2, -1.8);
  scene.add(rimWarm);

  const keyLight = new THREE.DirectionalLight(0xf3ead9, 2.3);
  keyLight.position.set(2.5, 3.6, 3.0);
  scene.add(keyLight);

  const rig = createCupAssembly({
    cupColor: 0xebe5d9,
    saucerColor: 0xe0d9cb,
    tableColor: 0x12120f,
  });
  rig.root.position.set(-0.35, -0.78, 0);
  scene.add(rig.root);

  const beans = createCoffeeBeans(10);
  scene.add(beans.mesh);

  const COUNT = 22_000;
  const steam = glowPoints(ctx, COUNT, 0.025);

  return (t) => {
    rig.setFill(1.0, t, 0.14);

    for (let i = 0; i < 10; i += 1) {
      const angle = (i / 10) * Math.PI * 2 + t * 0.35;
      const rad = 1.65 + (i % 2) * 0.35;
      beans.setBean(
        i,
        -0.35 + Math.cos(angle) * rad,
        -0.8 + (i % 3) * 0.08,
        Math.sin(angle) * rad,
        t * 0.4 + i,
        angle,
        i * 0.5,
        0.9
      );
    }
    beans.commit();

    const drawProgress = ramp(t, 0, 2.2, easeOut);
    const pointCount = Math.floor(STEAM_RIBBON.length / 3);
    const maxIdx = Math.max(1, Math.floor(pointCount * 0.9));

    for (let i = 0; i < COUNT; i += 1) {
      const idx = Math.floor(rand(i, 1) * maxIdx);
      const lx = STEAM_RIBBON[idx * 3];
      const ly = STEAM_RIBBON[idx * 3 + 1];
      const lz = STEAM_RIBBON[idx * 3 + 2];
      const phase = (t * 0.48 + rand(i, 2)) % 1;
      const spread = 0.03 + phase * 0.065;
      const px = -0.35 + lx * 0.028 + (rand(i, 3) - 0.5) * spread;
      const py = 0.42 + (ly + 14) * 0.042 + phase * 0.65;
      const pz = lz * 0.028 + (rand(i, 4) - 0.5) * spread;
      const fade = Math.sin(phase * Math.PI) * mix(0.65, 1.0, drawProgress);
      const lum = 0.052 * fade;
      steam.position.set([px, py, pz], i * 3);
      steam.color.set([lum * 0.96, lum * 0.9, lum * 0.78], i * 3);
    }
    steam.commit();

    const p = ramp(t, 0, 3.0);
    const radius = mix(3.3, 4.95, p);
    const azimuth = mix(-0.85, 0.15, p);
    const elevation = mix(0.14, 0.28, p);
    orbit(ctx.camera, radius, azimuth, elevation, [-0.15, 0.42, 0]);
  };
};

const SteamAndCraft: React.FC<{ t: number }> = ({ t }) => (
  <AbsoluteFill style={{ backgroundColor: BG_DARK }}>
    <Stage3D
      build={buildSteamCraft}
      time={t}
      bloom={{ strength: 0.78, radius: 0.58, threshold: 0.2 }}
      background={BG_DARK}
      fov={40}
    />
    <Caption
      t={t}
      title="Home away home"
      note="Kadıköy, Istanbul"
      color={CREAM}
      titleFamily={DISPLAY_FONT}
      fontFamily={BODY_FONT}
    />
  </AbsoluteFill>
);

const buildFinale: StageBuild = (ctx) => {
  const { scene } = ctx;

  const ambient = new THREE.AmbientLight(0x35302a, 1.4);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xf6ecdc, 2.75);
  keyLight.position.set(3.2, 4.8, 3.4);
  scene.add(keyLight);

  const rimLight = new THREE.PointLight(0xd9ccb2, 4.0, 14);
  rimLight.position.set(-2.5, 2.4, -2.8);
  scene.add(rimLight);

  const leafFill = new THREE.PointLight(0x6e8a66, 1.7, 12);
  leafFill.position.set(2.4, -0.5, -2.5);
  scene.add(leafFill);

  const cupGroup = new THREE.Group();
  cupGroup.position.set(1.05, -0.58, 0);
  scene.add(cupGroup);

  const rig = createCupAssembly({
    cupColor: 0xebe5d9,
    saucerColor: 0xe0d9cb,
    tableColor: 0x12130f,
    cremaColor: 0xd4c19e,
    espressoColor: 0x1c110a,
  });
  cupGroup.add(rig.root);

  const ringGeo = new THREE.TorusGeometry(1.78, 0.018, 16, 120);
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x8aa380,
    emissive: 0x3b4d35,
    emissiveIntensity: 0.45,
    roughness: 0.3,
    metalness: 0.65,
  });
  const sageRing = new THREE.Mesh(ringGeo, ringMat);
  sageRing.position.set(1.05, 0.72, -1.6);
  scene.add(sageRing);

  const beans = createCoffeeBeans(12);
  scene.add(beans.mesh);

  const STEAM_COUNT = 12_000;
  const steam = glowPoints(ctx, STEAM_COUNT, 0.025);

  const DUST_COUNT = 12_000;
  const dust = glowPoints(ctx, DUST_COUNT, 0.018);

  return (t) => {
    const enter = ramp(t, 0, 1.1, easeOut);
    const shimmer = hit(t, 3.01, 2.4);
    const beatBreathe = pulse(t, 0, BEAT, 3.2);

    rig.setFill(1.0, t, 0.08 + shimmer * 0.25);
    cupGroup.rotation.y = -0.35 + t * 0.16;

    sageRing.scale.setScalar(mix(0.88, 1.02, enter) + shimmer * 0.03);
    sageRing.rotation.y = Math.sin(t * 0.45) * 0.16;
    ringMat.emissiveIntensity = 0.4 + shimmer * 0.6 + beatBreathe * 0.12;
    rimLight.intensity = 3.8 + shimmer * 2.2;

    for (let i = 0; i < 12; i += 1) {
      const baseAngle = (i / 12) * Math.PI * 2 + t * 0.22;
      const rad = 1.9 + (i % 3) * 0.35;
      const bx = 1.05 + Math.cos(baseAngle) * rad;
      const bz = Math.sin(baseAngle) * rad;
      const by = -0.52 + Math.sin(t * 1.1 + rand(i, 12) * 6.28) * 0.12 + (i % 2) * 0.22;
      beans.setBean(
        i,
        bx,
        by,
        bz,
        t * 0.45 + rand(i, 13) * 3,
        baseAngle + rand(i, 14),
        rand(i, 15) * 1.2,
        0.92
      );
    }
    beans.commit();

    for (let i = 0; i < STEAM_COUNT; i += 1) {
      const phase = (t * (0.32 + rand(i, 1) * 0.16) + rand(i, 2)) % 1;
      const angle = rand(i, 3) * Math.PI * 2 + phase * 1.9;
      const rad = 0.06 + phase * 0.56 * rand(i, 4);
      const x = 1.05 + Math.cos(angle) * rad;
      const z = Math.sin(angle) * rad;
      const y = 0.62 + phase * 2.35;
      const [fx, fy, fz] = flow(x * 0.8, y * 0.7, z * 0.8, t * 0.6);
      const fade = Math.sin(phase * Math.PI);
      const lum = (0.038 + 0.03 * shimmer) * fade;
      steam.position.set([x + fx * 0.24, y + fy * 0.07, z + fz * 0.24], i * 3);
      steam.color.set([lum * 0.96, lum * 0.9, lum * 0.78], i * 3);
    }
    steam.commit();

    for (let i = 0; i < DUST_COUNT; i += 1) {
      const a = rand(i, 6) * Math.PI * 2 + t * 0.08;
      const r = 1.2 + rand(i, 7) * 5.4;
      const px = Math.cos(a) * r;
      const pz = Math.sin(a) * r - 0.5;
      const py = -1.2 + rand(i, 8) * 4.2 + Math.sin(t * 0.7 + rand(i, 9) * 6.28) * 0.14;
      const twinkle = 0.5 + 0.5 * Math.sin(t * 1.8 + rand(i, 10) * 10);
      const isSage = rand(i, 11) > 0.55;
      const b = (0.025 + 0.035 * twinkle) * (0.85 + 0.15 * beatBreathe);
      dust.position.set([px, py, pz], i * 3);
      if (isSage) {
        dust.color.set([b * 0.52, b * 0.76, b * 0.5], i * 3);
      } else {
        dust.color.set([b * 0.95, b * 0.88, b * 0.75], i * 3);
      }
    }
    dust.commit();

    const p = ramp(t, 0, 5.0);
    const camRadius = mix(5.85, 5.05, p);
    const camAzimuth = mix(0.32, -0.1, p);
    orbit(ctx.camera, camRadius, camAzimuth, 0.26, [0.18, 0.35, 0]);
  };
};

const BrandFinale: React.FC<{ t: number; globalT: number }> = ({ t, globalT }) => {
  const accentBeat = hit(globalT, T_FINALE_HIT, 2.5);
  const wordmarkAlpha = ramp(t, 0.2, 0.9, easeOut);

  return (
    <AbsoluteFill style={{ backgroundColor: BG_DARK }}>
      <Stage3D
        build={buildFinale}
        time={t}
        bloom={{ strength: 0.72, radius: 0.6, threshold: 0.22 }}
        background={BG_DARK}
        fov={40}
      />

      <div
        style={{
          position: "absolute",
          left: 112,
          top: "50%",
          transform: "translateY(-50%)",
          maxWidth: 640,
          opacity: wordmarkAlpha,
        }}
      >
        <div
          style={{
            width: mix(0, 56, ramp(t, 0.15, 0.85, easeOut)),
            height: 2,
            backgroundColor: ACCENT_SAGE,
            marginBottom: 24,
            opacity: 0.85 + accentBeat * 0.15,
          }}
        />
        <Rise t={t} at={0.22}>
          <div
            style={{
              fontFamily: DISPLAY_FONT,
              fontSize: 78,
              fontWeight: 600,
              lineHeight: 1.04,
              letterSpacing: "-0.02em",
              color: CREAM,
            }}
          >
            Balkon Sefası
          </div>
        </Rise>
        <Rise t={t} at={0.55}>
          <div
            style={{
              fontFamily: BODY_FONT,
              fontSize: 22,
              fontWeight: 400,
              lineHeight: 1.5,
              color: SUB_LIGHT,
              marginTop: 18,
              letterSpacing: "0.01em",
            }}
          >
            Kozyatağı · 09:00 to 01:00
          </div>
        </Rise>
        <Rise t={t} at={0.85}>
          <div
            style={{
              fontFamily: BODY_FONT,
              fontSize: 18,
              fontWeight: 500,
              color: "rgba(236, 230, 218, 0.72)",
              marginTop: 10,
              letterSpacing: "0.02em",
            }}
          >
            balkonsefasi.com
          </div>
        </Rise>
      </div>
    </AbsoluteFill>
  );
};

const Video: React.FC = () => {
  const time = useTime();
  const { fps } = useVideoConfig();
  const active =
    SCENES.find((s) => time >= s.start && time < s.end) ?? SCENES[SCENES.length - 1];
  const localT = Math.max(0, time - active.start);

  const dropFlash = hit(time, T_DROP, 6.5) * 0.28;
  const isLightScene = active.id === "crema-daylight";

  return (
    <AbsoluteFill style={{ backgroundColor: isLightScene ? BG_LIGHT : BG_DARK }}>
      {active.id === "morning-mist" && <MorningMist t={localT} />}
      {active.id === "the-pour" && <ThePour t={localT} />}
      {active.id === "crema-daylight" && <CremaDaylight t={localT} />}
      {active.id === "steam-craft" && <SteamAndCraft t={localT} />}
      {active.id === "brand-finale" && <BrandFinale t={localT} globalT={time} />}

      {dropFlash > 0.004 && (
        <AbsoluteFill
          style={{
            backgroundColor: `rgba(236, 230, 218, ${dropFlash})`,
            pointerEvents: "none",
          }}
        />
      )}

      <Grain opacity={isLightScene ? 0.032 : 0.052} />
      <Vignette strength={isLightScene ? 0.22 : 0.54} />

      <Sequence from={Math.round(2.75 * fps)} durationInFrames={Math.round(1.0 * fps)}>
        <Audio src="https://remotion.media/whoosh.wav" volume={0.14} />
      </Sequence>
    </AbsoluteFill>
  );
};

export default Video;
