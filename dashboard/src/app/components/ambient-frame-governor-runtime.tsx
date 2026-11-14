'use client';
import { useEffect } from 'react';
import { startAmbientFrameGovernor } from '@/lib/ambient-frame-governor';

/** Advances slow decorative animations from one shared low-rate clock. */
export default function AmbientFrameGovernorRuntime() {
  useEffect(() => startAmbientFrameGovernor(), []);
  return null;
}
