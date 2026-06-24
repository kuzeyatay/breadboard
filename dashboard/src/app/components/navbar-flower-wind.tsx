"use client";

import { useEffect, useState, type CSSProperties } from "react";
import styles from "./navbar-flower-wind.module.css";

type PlantVariant = "grassShort" | "grassTall" | "flowerLow" | "flowerTall";
type RandomSource = () => number;

interface Plant {
  left: string;
  bottom: number;
  scale: number;
  delay: string;
  duration: string;
  sway: string;
  rotate: string;
  variant: PlantVariant;
  flowerColor?: string;
  flowerCenter?: string;
}

const PLANT_COUNT = 24;
const FLOWER_COUNT = 6;
const FLOWER_COLORS = ["#F2C94C", "#E88CA5", "#7FADE8", "#B99AE8"] as const;
const DEFAULT_CENTER = "#F2C94C";
const YELLOW_CENTER = "#FFF2A8";

function seededRandom(seed: number): RandomSource {
  let state = seed;

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function between(random: RandomSource, min: number, max: number): number {
  return min + random() * (max - min);
}

function toFixedNumber(value: number, digits = 1): number {
  return Number(value.toFixed(digits));
}

function selectFlowerSlots(random: RandomSource): Set<number> {
  const candidates = Array.from({ length: PLANT_COUNT - 4 }, (_, index) => index + 2);

  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [candidates[index], candidates[swapIndex]] = [
      candidates[swapIndex],
      candidates[index],
    ];
  }

  const selected: number[] = [];

  for (const candidate of candidates) {
    if (selected.every((slot) => Math.abs(slot - candidate) >= 3)) {
      selected.push(candidate);
    }

    if (selected.length === FLOWER_COUNT) break;
  }

  for (const candidate of candidates) {
    if (selected.length === FLOWER_COUNT) break;
    if (!selected.includes(candidate)) selected.push(candidate);
  }

  return new Set(selected.sort((a, b) => a - b));
}

function createPlants(random: RandomSource): Plant[] {
  const flowerSlots = selectFlowerSlots(random);

  return Array.from({ length: PLANT_COUNT }, (_, index) => {
    const baseLeft = ((index + 0.5) / PLANT_COUNT) * 100;
    const left = clamp(baseLeft + between(random, -1.35, 1.35), 1.25, 98.75);
    const isFlower = flowerSlots.has(index);

    if (isFlower) {
      const flowerColor =
        FLOWER_COLORS[
          Math.floor(between(random, 0, FLOWER_COLORS.length)) %
            FLOWER_COLORS.length
        ];
      const variant = random() > 0.45 ? "flowerTall" : "flowerLow";

      return {
        left: `${toFixedNumber(left)}%`,
        bottom: random() > 0.4 ? 0 : 1,
        scale: toFixedNumber(
          variant === "flowerTall"
            ? between(random, 0.96, 1.13)
            : between(random, 0.9, 1.04),
          2,
        ),
        delay: `-${toFixedNumber(between(random, 0.1, 5.4))}s`,
        duration: `${toFixedNumber(between(random, 3.1, 5.5))}s`,
        sway: `${toFixedNumber(between(random, 5.2, 8))}px`,
        rotate: `${toFixedNumber(between(random, 2.8, 4.8))}deg`,
        variant,
        flowerColor,
        flowerCenter: flowerColor === "#F2C94C" ? YELLOW_CENTER : DEFAULT_CENTER,
      };
    }

    const tallGrass = random() > 0.52;

    return {
      left: `${toFixedNumber(left)}%`,
      bottom: random() > 0.58 ? 0 : -1,
      scale: toFixedNumber(
        tallGrass ? between(random, 0.72, 1) : between(random, 0.64, 0.9),
        2,
      ),
      delay: `-${toFixedNumber(between(random, 0.1, 5.2))}s`,
      duration: `${toFixedNumber(between(random, 3.1, 5.4))}s`,
      sway: `${toFixedNumber(between(random, 4, 7.2))}px`,
      rotate: `${toFixedNumber(between(random, 2, 4.2))}deg`,
      variant: tallGrass ? "grassTall" : "grassShort",
    };
  });
}

const INITIAL_PLANTS = createPlants(seededRandom(1224));

function plantStyle(plant: Plant): CSSProperties {
  const sway = Number.parseFloat(plant.sway);
  const rotate = Number.parseFloat(plant.rotate);

  return {
    "--plant-left": plant.left,
    "--plant-bottom": `${plant.bottom}px`,
    "--plant-scale": plant.scale,
    "--plant-delay": plant.delay,
    "--plant-duration": plant.duration,
    "--plant-sway-left": `${-(sway * 0.45).toFixed(1)}px`,
    "--plant-sway-right": plant.sway,
    "--plant-sway-soft": `${(sway * 0.8).toFixed(1)}px`,
    "--plant-sway-rest": `${(sway * 0.25).toFixed(1)}px`,
    "--plant-rotate-left": `${-(rotate * 0.75).toFixed(1)}deg`,
    "--plant-rotate-right": plant.rotate,
    "--plant-rotate-soft": `${(rotate * 0.75).toFixed(1)}deg`,
    "--plant-rotate-rest": `${(rotate * 0.2).toFixed(1)}deg`,
    "--flower-head": plant.flowerColor ?? "#F2C94C",
    "--flower-center": plant.flowerCenter ?? DEFAULT_CENTER,
  } as CSSProperties;
}

function GrassShortSprite() {
  return (
    <svg
      className={styles.sprite}
      viewBox="0 0 18 24"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <rect className={styles.grassDark} x="0" y="21" width="18" height="3" />
      <rect className={styles.grassMid} x="2" y="15" width="2" height="6" />
      <rect className={styles.grassLight} x="4" y="12" width="2" height="9" />
      <rect className={styles.grassDark} x="7" y="10" width="2" height="11" />
      <rect className={styles.grassMid} x="10" y="13" width="2" height="8" />
      <rect className={styles.grassLight} x="13" y="16" width="2" height="5" />
      <rect className={styles.grassMid} x="1" y="18" width="4" height="2" />
      <rect className={styles.grassLight} x="10" y="17" width="5" height="2" />
    </svg>
  );
}

function GrassTallSprite() {
  return (
    <svg
      className={styles.sprite}
      viewBox="0 0 20 28"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <rect className={styles.grassDark} x="0" y="25" width="20" height="3" />
      <rect className={styles.grassMid} x="2" y="16" width="2" height="9" />
      <rect className={styles.grassLight} x="5" y="10" width="2" height="15" />
      <rect className={styles.grassDark} x="9" y="7" width="2" height="18" />
      <rect className={styles.grassMid} x="13" y="12" width="2" height="13" />
      <rect className={styles.grassLight} x="16" y="17" width="2" height="8" />
      <rect className={styles.grassLight} x="3" y="14" width="4" height="2" />
      <rect className={styles.grassMid} x="11" y="15" width="4" height="2" />
      <rect className={styles.grassDark} x="14" y="20" width="4" height="2" />
    </svg>
  );
}

function FlowerSprite({ tall }: { tall: boolean }) {
  const headY = tall ? 1 : 7;
  const stemY = tall ? 14 : 19;
  const stemHeight = tall ? 15 : 10;

  return (
    <svg
      className={styles.sprite}
      viewBox="0 0 26 32"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <rect className={styles.grassDark} x="0" y="29" width="26" height="3" />
      <rect className={styles.stem} x="12" y={stemY} width="2" height={stemHeight} />
      <rect className={styles.grassMid} x="4" y="21" width="2" height="8" />
      <rect className={styles.grassLight} x="7" y="24" width="4" height="2" />
      <rect className={styles.grassMid} x="14" y="23" width="5" height="2" />
      <rect className={styles.grassLight} x="20" y="20" width="2" height="9" />
      <rect className={styles.flowerHead} x="11" y={headY} width="4" height="4" />
      <rect
        className={styles.flowerHead}
        x="6"
        y={headY + 5}
        width="5"
        height="5"
      />
      <rect
        className={styles.flowerHead}
        x="15"
        y={headY + 5}
        width="5"
        height="5"
      />
      <rect
        className={styles.flowerHead}
        x="11"
        y={headY + 10}
        width="4"
        height="4"
      />
      <rect
        className={styles.flowerCenter}
        x="11"
        y={headY + 5}
        width="4"
        height="4"
      />
    </svg>
  );
}

function PlantSprite({ variant }: { variant: PlantVariant }) {
  if (variant === "flowerLow" || variant === "flowerTall") {
    return <FlowerSprite tall={variant === "flowerTall"} />;
  }

  if (variant === "grassTall") return <GrassTallSprite />;
  return <GrassShortSprite />;
}

export default function NavbarFlowerWind() {
  const [plants, setPlants] = useState(INITIAL_PLANTS);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setPlants(createPlants(Math.random));
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <div className={styles.wind} aria-hidden="true">
      <div className={styles.grassBed} />
      {plants.map((plant, index) => (
        <span
          key={`${plant.variant}-${index}`}
          className={styles.plant}
          style={plantStyle(plant)}
        >
          <span className={styles.plantSprite}>
            <PlantSprite variant={plant.variant} />
          </span>
        </span>
      ))}
    </div>
  );
}
