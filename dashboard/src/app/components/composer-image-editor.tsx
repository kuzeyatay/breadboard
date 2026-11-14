'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Eraser, GripVertical, ImageMinus, MessageSquareDashed, PenLine, Scaling, Undo2 } from 'lucide-react';
import { removeBackground } from '@/vendor/genoffice/docs/src/renderer/cutout.ts';

type Tool = 'markup' | 'comment' | 'erase' | 'resize';
type Box = { x: number; y: number; w: number; h: number };

const MARKUP_COLOR = '#ef2b2b';
const COMMENT_COLOR = '#ffb020';
const MAX_SIDE = 8192;
// ponytail: whole-canvas undo snapshots, capped; switch to an op log if memory on huge images matters.
const MAX_UNDO = 10;
// Edge flood-fill tolerance (0..100). Raise it for noisier backgrounds.
const REMOVE_BG_TOLERANCE = 12;

function copyCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const copy = document.createElement('canvas');
  copy.width = source.width;
  copy.height = source.height;
  copy.getContext('2d')?.drawImage(source, 0, 0);
  return copy;
}

/**
 * The enlarged composer image, editable in place. Every finished edit is
 * reported through `onChange` straight away, so the attachment that gets sent
 * is always the picture on screen; there is no separate save step to forget.
 */
export default function ComposerImageEditor({ src, alt, onChange }: {
  src: string; alt: string; onChange: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const undoRef = useRef<HTMLCanvasElement[]>([]);
  const strokeRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  // A JPEG stays a JPEG until an edit needs transparency.
  const alphaRef = useRef(!/^data:image\/jpeg/i.test(src));
  const [tool, setTool] = useState<Tool | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [resize, setResize] = useState({ w: 0, h: 0 });
  const [canUndo, setCanUndo] = useState(false);
  const [box, setBox] = useState<Box | null>(null);
  const [commenting, setCommenting] = useState(false);
  const [comment, setComment] = useState('');
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);

  // Load once: later `src` values are this editor's own output coming back.
  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext('2d')?.drawImage(image, 0, 0);
      setSize({ w: canvas.width, h: canvas.height });
    };
    image.src = src;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function commit() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSize({ w: canvas.width, h: canvas.height });
    onChange(alphaRef.current ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.92));
  }
  function snapshot() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    undoRef.current = [...undoRef.current.slice(-(MAX_UNDO - 1)), copyCanvas(canvas)];
    setCanUndo(true);
  }
  function undo() {
    const canvas = canvasRef.current;
    const previous = undoRef.current.pop();
    if (!canvas || !previous) return;
    canvas.width = previous.width;
    canvas.height = previous.height;
    canvas.getContext('2d')?.drawImage(previous, 0, 0);
    setCanUndo(undoRef.current.length > 0);
    commit();
  }
  const undoLatest = useRef(undo);
  undoLatest.current = undo;
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        undoLatest.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  /** Pointer position in image pixels, plus image pixels per screen pixel. */
  function locate(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = event.currentTarget.width / rect.width;
    return { x: (event.clientX - rect.left) * scale, y: (event.clientY - rect.top) * scale, scale };
  }
  function pointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 || strokeRef.current) return;
    // Clicking away from an open comment keeps what was typed.
    if (commenting) return finishComment();
    if (tool !== 'markup' && tool !== 'erase' && tool !== 'comment') return;
    event.preventDefault();
    const { x, y, scale } = locate(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    strokeRef.current = { pointerId: event.pointerId, x, y };
    if (tool === 'comment') {
      setBox({ x, y, w: 0, h: 0 });
      return;
    }
    snapshot();
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    if (tool === 'erase') alphaRef.current = true;
    context.globalCompositeOperation = tool === 'erase' ? 'destination-out' : 'source-over';
    context.strokeStyle = MARKUP_COLOR;
    context.lineWidth = (tool === 'erase' ? 24 : 4) * scale;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    // A zero-length segment with round caps paints the dot a click should leave.
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x, y);
    context.stroke();
  }
  function pointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const stroke = strokeRef.current;
    if (!stroke || stroke.pointerId !== event.pointerId) return;
    const { x, y } = locate(event);
    if (tool === 'comment') {
      setBox({ x: Math.min(stroke.x, x), y: Math.min(stroke.y, y), w: Math.abs(x - stroke.x), h: Math.abs(y - stroke.y) });
      return;
    }
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    context.beginPath();
    context.moveTo(stroke.x, stroke.y);
    context.lineTo(x, y);
    context.stroke();
    stroke.x = x;
    stroke.y = y;
  }
  function pointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    const stroke = strokeRef.current;
    if (!stroke || stroke.pointerId !== event.pointerId) return;
    strokeRef.current = null;
    if (tool === 'comment') {
      setCommenting(true);
      return;
    }
    const context = event.currentTarget.getContext('2d');
    if (context) context.globalCompositeOperation = 'source-over';
    commit();
  }

  function cancelComment() {
    setBox(null);
    setCommenting(false);
    setComment('');
  }
  /** Bakes the region and its note into the pixels, which is what a model reads. */
  function finishComment() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    const text = comment.trim();
    if (!canvas || !context || !box || !text) return cancelComment();
    snapshot();
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    const fontSize = 14 * scale;
    const pad = 5 * scale;
    context.strokeStyle = COMMENT_COLOR;
    context.fillStyle = COMMENT_COLOR;
    context.lineWidth = 2 * scale;
    const pin = box.w < 8 * scale && box.h < 8 * scale;
    if (pin) {
      context.beginPath();
      context.arc(box.x, box.y, 6 * scale, 0, Math.PI * 2);
      context.fill();
    } else {
      context.strokeRect(box.x, box.y, box.w, box.h);
    }
    context.font = `600 ${fontSize}px sans-serif`;
    context.textBaseline = 'middle';
    const labelWidth = context.measureText(text).width + pad * 2;
    const labelHeight = fontSize + pad * 2;
    const wantX = pin ? box.x + 10 * scale : box.x;
    const wantY = pin ? box.y - labelHeight / 2 : box.y - labelHeight;
    const labelX = Math.max(0, Math.min(canvas.width - labelWidth, wantX));
    const labelY = Math.max(0, Math.min(canvas.height - labelHeight, wantY));
    context.fillRect(labelX, labelY, labelWidth, labelHeight);
    context.fillStyle = '#1a1a1a';
    context.fillText(text, labelX + pad, labelY + labelHeight / 2);
    cancelComment();
    commit();
  }

  function removeBg() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = removeBackground(pixels, REMOVE_BG_TOLERANCE);
    if (result.removedCount === 0) return;
    snapshot();
    alphaRef.current = true;
    context.putImageData(new ImageData(result.data, canvas.width, canvas.height), 0, 0);
    commit();
  }
  function applyResize() {
    const canvas = canvasRef.current;
    const w = Math.round(Math.max(1, Math.min(MAX_SIDE, resize.w)));
    const h = Math.round(Math.max(1, Math.min(MAX_SIDE, resize.h)));
    if (!canvas || (w === canvas.width && h === canvas.height)) return setTool(null);
    snapshot();
    const before = copyCanvas(canvas);
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext('2d');
    if (context) {
      context.imageSmoothingQuality = 'high';
      context.drawImage(before, 0, 0, w, h);
    }
    setTool(null);
    commit();
  }
  function pick(next: Tool) {
    cancelComment();
    if (next === 'resize') setResize(size);
    setTool((current) => (current === next ? null : next));
  }

  // Literal colors: Breadboard remaps Tailwind's white palette to theme ink,
  // and this sits on the always-dark preview backdrop.
  const item = 'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm outline-none transition hover:bg-[#ffffff]/10 focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-30';
  const active = 'bg-[#ffffff]/15 !text-[#ffffff]';
  const field = 'w-20 rounded-md border border-[#ffffff]/20 bg-[#1c1c1e] px-2 py-1 text-sm text-[#ffffff] outline-none focus:border-blue-400';
  const percent = (value: number, of: number) => `${(value / Math.max(1, of)) * 100}%`;

  return (
    <>
      <div className="relative">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={alt}
          className="block max-h-[80vh] max-w-[calc(100vw-3rem)] touch-none rounded-lg shadow-2xl"
          style={{
            cursor: tool && tool !== 'resize' ? 'crosshair' : 'default',
            // Checkerboard, so erased and removed areas read as transparent.
            background: 'repeating-conic-gradient(#d9d9d9 0% 25%, #f5f5f5 0% 50%) 0 0 / 20px 20px',
          }}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerUp}
          onPointerCancel={pointerUp}
        />
        {box ? (
          <div
            className="pointer-events-none absolute border-2 border-dashed"
            style={{
              borderColor: COMMENT_COLOR,
              left: percent(box.x, size.w), top: percent(box.y, size.h),
              width: percent(box.w, size.w), height: percent(box.h, size.h),
            }}
          />
        ) : null}
        {box && commenting ? (
          <form
            className="absolute z-10 w-56 max-w-[70%]"
            style={{ left: percent(Math.min(box.x, size.w * 0.6), size.w), top: percent(Math.min(box.y + box.h, size.h * 0.9), size.h) }}
            onSubmit={(event) => { event.preventDefault(); finishComment(); }}
          >
            <input
              autoFocus
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); cancelComment(); } }}
              aria-label="Comment"
              placeholder="Comment, then press Enter"
              className="mt-1 w-full rounded-lg border border-[#ffffff]/30 bg-[#2a2a2c] px-3 py-2 text-sm text-[#ffffff] shadow-xl outline-none"
            />
          </form>
        ) : null}
      </div>

      <div
        className="relative flex flex-col items-center gap-2"
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      >
        {tool === 'resize' ? (
          <form
            className="absolute bottom-full mb-2 flex items-center gap-2 rounded-xl bg-[#2a2a2c] px-3 py-2 text-sm text-[#d4d4d4] shadow-xl"
            onSubmit={(event) => { event.preventDefault(); applyResize(); }}
          >
            <input
              type="number" min={1} max={MAX_SIDE} aria-label="Width" className={field} value={resize.w || ''}
              onChange={(event) => {
                const w = Number(event.target.value);
                setResize({ w, h: Math.round((w * size.h) / Math.max(1, size.w)) });
              }}
            />
            <span aria-hidden>×</span>
            <input
              type="number" min={1} max={MAX_SIDE} aria-label="Height" className={field} value={resize.h || ''}
              onChange={(event) => {
                const h = Number(event.target.value);
                setResize({ w: Math.round((h * size.w) / Math.max(1, size.h)), h });
              }}
            />
            <button type="submit" className={`${item} bg-[#315b91] !text-[#ffffff]`}>Apply</button>
          </form>
        ) : null}
        <div role="toolbar" aria-label="Image tools" className="flex items-center gap-0.5 rounded-xl bg-[#2a2a2c] p-1 text-[#d4d4d4] shadow-xl">
          <span
            aria-hidden
            title="Drag to move"
            className="flex h-8 w-7 cursor-grab touch-none items-center justify-center text-[#8a8a8a] active:cursor-grabbing"
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = { pointerId: event.pointerId, x: event.clientX - offset.x, y: event.clientY - offset.y };
            }}
            onPointerMove={(event) => {
              const drag = dragRef.current;
              if (drag?.pointerId === event.pointerId) setOffset({ x: event.clientX - drag.x, y: event.clientY - drag.y });
            }}
            onPointerUp={() => { dragRef.current = null; }}
            onPointerCancel={() => { dragRef.current = null; }}
          >
            <GripVertical size={16} />
          </span>
          <button type="button" aria-pressed={tool === 'markup'} className={`${item} ${tool === 'markup' ? active : ''}`} onClick={() => pick('markup')}>
            <PenLine size={16} />Markup
          </button>
          <button type="button" aria-pressed={tool === 'comment'} className={`${item} ${tool === 'comment' ? active : ''}`} onClick={() => pick('comment')}>
            <MessageSquareDashed size={16} />Comment
          </button>
          <button type="button" className={item} onClick={() => { cancelComment(); removeBg(); }}>
            <ImageMinus size={16} />Remove BG
          </button>
          <button type="button" aria-pressed={tool === 'erase'} className={`${item} ${tool === 'erase' ? active : ''}`} onClick={() => pick('erase')}>
            <Eraser size={16} />Erase
          </button>
          <button type="button" aria-pressed={tool === 'resize'} className={`${item} ${tool === 'resize' ? active : ''}`} onClick={() => pick('resize')}>
            <Scaling size={16} />Resize
          </button>
          {canUndo ? (
            <button type="button" aria-label="Undo" title="Undo (Ctrl+Z)" className={item} onClick={undo}>
              <Undo2 size={16} />
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
