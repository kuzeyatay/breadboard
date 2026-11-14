import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { Agents, Ask } from "./scenes/Chat";
import { Learn } from "./scenes/Garden";
import { Home, Places } from "./scenes/Home";
import { Browser } from "./scenes/Work";
import { Closing, Opening } from "./scenes/Title";
import { END, PHRASES, bg, type Clock } from "./scenes/shared";

// One app screen per musical phrase. The opening owns the build and the first phrase.
const shots: { from: number; Shot: React.FC<Clock> }[] = [
  { from: 0, Shot: Opening },
  { from: PHRASES[1], Shot: Home },
  { from: PHRASES[2], Shot: Learn },
  { from: PHRASES[3], Shot: Ask },
  { from: PHRASES[4], Shot: Agents },
  { from: PHRASES[5], Shot: Browser },
  { from: PHRASES[6], Shot: Places },
  { from: PHRASES[7], Shot: Closing },
];

const Video: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const time = Math.min(frame / fps, END);
  const current = [...shots].reverse().find((shot) => time >= shot.from) ?? shots[0];
  return (
    <AbsoluteFill style={{ backgroundColor: bg }}>
      <current.Shot t={time - current.from} time={time} />
    </AbsoluteFill>
  );
};

export default Video;
