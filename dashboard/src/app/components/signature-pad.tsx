"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, type RefObject } from "react";

export type SignaturePadHandle = {
  /** The pad's canvas, or null before it mounts. */
  canvas: () => HTMLCanvasElement | null;
  clear: () => void;
  isEmpty: () => boolean;
};

type Props = {
  handleRef: RefObject<SignaturePadHandle | null>;
  color: string;
  strokeWidth: number;
  onStrokeEnd?: () => void;
};

/** Backing-store resolution; the pad is displayed at a third of this, so exported
 * signatures stay sharp when scaled up on a page. */
const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 400;

/**
 * A transparent drawing surface for handwritten signatures. Pointer events cover
 * mouse, pen and touch in one path, and the canvas is never filled, so the PNG it
 * exports carries an alpha channel and sits on the page without a white box.
 */
export default function SignaturePad({
  handleRef,
  color,
  strokeWidth,
  onStrokeEnd,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const dirtyRef = useRef(false);

  const context = useCallback(() => {
    const canvas = canvasRef.current;
    return canvas ? canvas.getContext("2d") : null;
  }, []);

  useImperativeHandle(handleRef, () => ({
    canvas: () => canvasRef.current,
    clear: () => {
      const canvas = canvasRef.current;
      const ctx = context();
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      dirtyRef.current = false;
    },
    isEmpty: () => !dirtyRef.current,
  }), [context]);

  const pointAt = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }, []);

  const startStroke = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const ctx = context();
      if (!ctx) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      drawingRef.current = true;
      dirtyRef.current = true;
      const { x, y } = pointAt(event);
      ctx.beginPath();
      ctx.moveTo(x, y);
      // A dot, so a tap leaves a mark rather than nothing.
      ctx.lineTo(x + 0.01, y);
      ctx.stroke();
    },
    [context, pointAt],
  );

  const continueStroke = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current) return;
      const ctx = context();
      if (!ctx) return;
      const { x, y } = pointAt(event);
      ctx.lineTo(x, y);
      ctx.stroke();
    },
    [context, pointAt],
  );

  const endStroke = useCallback(() => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    onStrokeEnd?.();
  }, [onStrokeEnd]);

  useEffect(() => {
    const ctx = context();
    if (!ctx) return;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = color;
    // The pad is displayed smaller than its backing store, so scale the nib to match.
    ctx.lineWidth = strokeWidth * (CANVAS_WIDTH / 400);
  }, [color, context, strokeWidth]);

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_WIDTH}
      height={CANVAS_HEIGHT}
      onPointerDown={startStroke}
      onPointerMove={continueStroke}
      onPointerUp={endStroke}
      onPointerLeave={endStroke}
      onPointerCancel={endStroke}
      className="h-32 w-full touch-none rounded-md border border-dashed border-gray-700 bg-[repeating-conic-gradient(#1f2937_0_25%,#111827_0_50%)] bg-[length:16px_16px]"
    />
  );
}
