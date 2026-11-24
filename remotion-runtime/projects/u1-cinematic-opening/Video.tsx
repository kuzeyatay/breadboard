import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { Stage3D, glowPoints, orbit, rand, type StageBuild } from "@kit";
import * as THREE from "three";

const build: StageBuild = (ctx) => {
  const COUNT = 12000;
  const points = glowPoints(ctx, COUNT, 0.025);
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 1), new THREE.MeshStandardMaterial({ color: "#b9ffff", emissive: "#32d9d0", emissiveIntensity: 1.8, metalness: 0.35, roughness: 0.22, wireframe: true }));
  ctx.scene.add(core);
  const inner = new THREE.Mesh(new THREE.OctahedronGeometry(0.48, 1), new THREE.MeshStandardMaterial({ color: "#eaffff", emissive: "#a8ffff", emissiveIntensity: 2.4, metalness: 0.1, roughness: 0.18 }));
  ctx.scene.add(inner);
  const key = new THREE.PointLight("#74fff1", 45, 18);
  key.position.set(2, 2, 4);
  ctx.scene.add(key);
  const warm = new THREE.PointLight("#fff6d7", 16, 12);
  warm.position.set(-3, -1, 2);
  ctx.scene.add(warm);
  return (t) => {
    const reveal = Math.min(1, Math.max(0, t / 1.7));
    core.rotation.set(t * 0.18, t * 0.34, t * 0.1);
    core.scale.setScalar(0.72 + reveal * 0.28 + Math.sin(t * 1.8) * 0.025);
    inner.rotation.set(-t * 0.28, t * 0.5, t * 0.22);
    for (let i = 0; i < COUNT; i += 1) {
      const a = rand(i, 1) * Math.PI * 2 + t * (0.16 + rand(i, 2) * 0.1);
      const r = 1.7 + rand(i, 3) * 2.4;
      const z = (rand(i, 4) - 0.5) * 3.2;
      const twist = a + z * 0.55;
      points.position.set([Math.cos(twist) * r, Math.sin(twist) * r * 0.62, z], i * 3);
      const c = 0.025 + rand(i, 5) * 0.055;
      points.color.set([c * 0.35, c, c * 0.9], i * 3);
    }
    points.commit();
    orbit(ctx.camera, 8.5 - reveal * 2.8, 0.22 + t * 0.1, 0.16 + Math.sin(t * 0.35) * 0.035);
  };
};

const Video: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  return <AbsoluteFill style={{ backgroundColor: "#04090d" }}><Stage3D build={build} time={t} bloom={{ strength: 0.8, radius: 0.55, threshold: 0.18 }} background="#04090d" /></AbsoluteFill>;
};

export default Video;
