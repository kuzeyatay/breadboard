'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Circle, Eraser, MousePointer2, PencilLine, Redo2, Square, Type, Undo2, X } from 'lucide-react';

type Point = { x: number; y: number };
type Tool = 'select' | 'pen' | 'text' | 'rectangle' | 'ellipse' | 'eraser';
type Mark = { tool: Exclude<Tool, 'select'>; points: Point[]; color: string; width: number; text?: string };
type Gesture = { pointerId: number; start: Point; mark: Mark; movingIndex?: number };
const WIDTH = 1200;
const HEIGHT = 1000;
const BACKGROUND = '#202020';
const COLORS = [
  ['White', '#ffffff'], ['Gray', '#808894'], ['Brown', '#98460e'], ['Red', '#ed292e'],
  ['Orange', '#ff8114'], ['Amber', '#f8a500'], ['Green', '#13a454'], ['Teal', '#119a92'],
  ['Cyan', '#0bb5d3'], ['Blue', '#2b66ed'], ['Indigo', '#5d42e8'], ['Purple', '#b42bdc'], ['Pink', '#de2678'],
] as const;

function bounds(mark: Mark) {
  const xs = mark.points.map((p) => p.x);
  const ys = mark.points.map((p) => p.y);
  if (mark.tool === 'text') {
    const fontSize = Math.max(18, mark.width * 5);
    return { x: xs[0], y: ys[0] - fontSize, width: (mark.text?.length ?? 0) * fontSize * 0.6, height: fontSize * 1.2 };
  }
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

function paint(context: CanvasRenderingContext2D, marks: Mark[]) {
  context.fillStyle = BACKGROUND;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const mark of marks) {
    const first = mark.points[0];
    const last = mark.points[mark.points.length - 1];
    context.strokeStyle = mark.tool === 'eraser' ? BACKGROUND : mark.color;
    context.fillStyle = context.strokeStyle;
    context.lineWidth = mark.tool === 'eraser' ? mark.width * 5 : mark.width;
    context.beginPath();
    if (mark.tool === 'text') {
      context.font = `${Math.max(18, mark.width * 5)}px sans-serif`;
      context.fillText(mark.text ?? '', first.x, first.y);
    } else if (mark.tool === 'rectangle') {
      context.strokeRect(first.x, first.y, last.x - first.x, last.y - first.y);
    } else if (mark.tool === 'ellipse') {
      context.ellipse((first.x + last.x) / 2, (first.y + last.y) / 2,
        Math.abs(last.x - first.x) / 2, Math.abs(last.y - first.y) / 2, 0, 0, Math.PI * 2);
      context.stroke();
    } else if (mark.points.length === 1) {
      context.arc(first.x, first.y, context.lineWidth / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      context.moveTo(first.x, first.y);
      for (const point of mark.points.slice(1)) context.lineTo(point.x, point.y);
      context.stroke();
    }
  }
}

export default function ComposerSketchDialog({ onClose, onAttach }: {
  onClose: () => void; onAttach: (files: File[]) => void | Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#ffffff');
  const [width, setWidth] = useState(4);
  const [history, setHistory] = useState<Mark[][]>([[]]);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Mark | null>(null);
  const [selection, setSelection] = useState<number | null>(null);
  const [textAt, setTextAt] = useState<Point | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const marks = history[step];

  function commit(next: Mark[]) {
    setHistory((current) => [...current.slice(0, step + 1), next]);
    setStep(step + 1);
    setError('');
  }
  function undo() { setStep((value) => Math.max(0, value - 1)); setSelection(null); }
  function redo() { setStep((value) => Math.min(history.length - 1, value + 1)); setSelection(null); }
  function finishText() {
    if (textAt && text.trim()) commit([...marks, { tool: 'text', points: [textAt], color, width, text: text.trim() }]);
    setTextAt(null);
    setText('');
  }

  useEffect(() => {
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    const displayed = [...marks];
    const movingIndex = gestureRef.current?.movingIndex;
    if (draft && movingIndex !== undefined) displayed[movingIndex] = draft;
    else if (draft) displayed.push(draft);
    paint(context, displayed);
    if (tool === 'select' && selection !== null && displayed[selection]) {
      const box = bounds(displayed[selection]);
      context.strokeStyle = '#76a9ff';
      context.lineWidth = 1.5;
      context.setLineDash([5, 5]);
      context.strokeRect(box.x - 8, box.y - 8, box.width + 16, box.height + 16);
      context.setLineDash([]);
    }
  }, [marks, draft, selection, tool]);

  function point(event: ReactPointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(WIDTH, (event.clientX - rect.left) * WIDTH / rect.width)),
      y: Math.max(0, Math.min(HEIGHT, (event.clientY - rect.top) * HEIGHT / rect.height)) };
  }
  function start(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (busy || event.button !== 0 || gestureRef.current) return;
    if (textAt) { finishText(); return; }
    event.preventDefault();
    const at = point(event);
    if (tool === 'text') { setTextAt(at); setText(''); return; }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'select') {
      const index = marks.findLastIndex((mark) => {
        if (mark.tool === 'eraser') return false;
        const box = bounds(mark);
        return at.x >= box.x - 12 && at.x <= box.x + box.width + 12 && at.y >= box.y - 12 && at.y <= box.y + box.height + 12;
      });
      setSelection(index < 0 ? null : index);
      if (index >= 0) gestureRef.current = { pointerId: event.pointerId, start: at, mark: marks[index], movingIndex: index };
      return;
    }
    setSelection(null);
    const mark: Mark = { tool, points: [at], color, width };
    gestureRef.current = { pointerId: event.pointerId, start: at, mark };
    setDraft(mark);
  }
  function move(event: ReactPointerEvent<HTMLCanvasElement>) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const at = point(event);
    let next: Mark;
    if (gesture.movingIndex !== undefined) {
      next = { ...gesture.mark, points: gesture.mark.points.map((p) => ({ x: p.x + at.x - gesture.start.x, y: p.y + at.y - gesture.start.y })) };
    } else {
      next = { ...gesture.mark, points: gesture.mark.tool === 'pen' || gesture.mark.tool === 'eraser'
        ? [...gesture.mark.points, at] : [gesture.start, at] };
      gesture.mark = next;
    }
    setDraft(next);
  }
  function end(event: ReactPointerEvent<HTMLCanvasElement>, cancelled = false) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!cancelled) {
      if (gesture.movingIndex !== undefined && draft) {
        commit(marks.map((mark, index) => index === gesture.movingIndex ? draft : mark));
      } else if (gesture.movingIndex === undefined) commit([...marks, gesture.mark]);
    }
    gestureRef.current = null;
    setDraft(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  async function attach() {
    if (busy || !marks.length) return;
    setBusy(true);
    setError('');
    try {
      // Export only the artwork, without selection outlines or editing controls.
      const output = document.createElement('canvas');
      output.width = WIDTH; output.height = HEIGHT;
      const context = output.getContext('2d');
      if (!context) throw new Error('Canvas is unavailable.');
      paint(context, marks);
      const blob = await new Promise<Blob>((resolve, reject) => output.toBlob((result) => result ? resolve(result) : reject(new Error('Could not export sketch.')), 'image/png'));
      await onAttach([new File([blob], `sketch-${Date.now()}.png`, { type: 'image/png' })]);
      onClose();
    } catch {
      setError('Your sketch could not be attached. Try again.');
      setBusy(false);
    }
  }
  // Breadboard remaps Tailwind's white palette to theme ink. The drawing
  // surface keeps literal colors so its dark canvas is legible in every theme.
  const button = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#c7c7c7] outline-none hover:bg-[#ffffff]/10 focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-30';
  return <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[170] bg-black/55 backdrop-blur-sm" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-[171] flex h-[min(58rem,calc(100dvh-32px))] w-[min(60rem,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[28px] bg-[#202020] text-[#f5f5f5] shadow-2xl outline-none"
        onKeyDown={(event) => {
          if (event.target instanceof HTMLInputElement || busy || gestureRef.current) return;
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
          if ((event.key === 'Delete' || event.key === 'Backspace') && selection !== null) { event.preventDefault(); commit(marks.filter((_, index) => index !== selection)); setSelection(null); }
        }}>
        <Dialog.Title className="sr-only">Sketch</Dialog.Title>
        <Dialog.Description className="sr-only">Draw on the canvas, choose tools and colors, then attach your sketch to the chat.</Dialog.Description>
        <div className="flex shrink-0 items-center justify-between gap-1 px-3 py-3 sm:px-4">
          <Dialog.Close className={button} disabled={busy} aria-label="Close sketch"><X size={19} /></Dialog.Close>
          <div role="toolbar" aria-label="Sketch tools" className="flex flex-wrap justify-center rounded-full border border-[#ffffff]/10 bg-[#ffffff]/[0.07] p-1">
            {([
              ['select', 'Select and move', MousePointer2], ['pen', 'Pen', PencilLine], ['text', 'Text', Type],
              ['rectangle', 'Rectangle', Square], ['ellipse', 'Ellipse', Circle], ['eraser', 'Eraser', Eraser],
            ] as const).map(([id, label, Icon]) => <button key={id} type="button" aria-label={label} title={label} disabled={busy}
              aria-pressed={tool === id} className={`${button} ${tool === id ? 'bg-[#ffffff]/10 !text-[#ffffff]' : ''}`}
              onClick={() => { finishText(); setTool(id); }}><Icon size={18} /></button>)}
          </div>
          <div className="flex flex-col sm:flex-row">
            <button type="button" className={button} aria-label="Undo" title="Undo (Ctrl+Z)" onClick={undo} disabled={step === 0 || busy}><Undo2 size={18} /></button>
            <button type="button" className={button} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={step === history.length - 1 || busy}><Redo2 size={18} /></button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} aria-label="Sketch canvas"
            className="h-full w-full touch-none" style={{ cursor: tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair' }}
            onPointerDown={start} onPointerMove={move} onPointerUp={(event) => end(event)} onPointerCancel={(event) => end(event, true)} />
          <input type="range" min="1" max="18" value={width} onChange={(event) => setWidth(Number(event.target.value))}
            disabled={busy} aria-label="Brush size" title={`Brush size: ${width}`}
            className="absolute left-4 top-1/2 h-40 w-5 -translate-y-1/2 accent-[#ffffff] [direction:rtl] [writing-mode:vertical-lr]" />
          {textAt && <form className="absolute max-w-[70%]" style={{ left: `${Math.min(70, textAt.x / WIDTH * 100)}%`, top: `${Math.min(85, textAt.y / HEIGHT * 100)}%` }}
            onSubmit={(event) => { event.preventDefault(); finishText(); }}>
            <input autoFocus value={text} onChange={(event) => setText(event.target.value)} aria-label="Sketch text" placeholder="Type, then press Enter"
              className="w-full rounded-lg border border-[#ffffff]/30 bg-[#303030] px-3 py-2 text-sm text-[#ffffff] outline-none" />
          </form>}
        </div>
        {error && <p role="alert" className="px-5 text-sm text-red-300">{error}</p>}
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-4">
          <span className="hidden w-9 shrink-0 sm:block" />
          <div role="toolbar" aria-label="Sketch colors" className="flex flex-wrap items-center justify-center gap-2">
            <label title="Custom color" className="relative h-6 w-6 overflow-hidden rounded-full" style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}>
              <input type="color" value={color} onChange={(event) => setColor(event.target.value)} disabled={busy} aria-label="Custom color" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
            </label>
            {COLORS.map(([name, hex]) => <button key={hex} type="button" aria-label={name} title={name} aria-pressed={color === hex} disabled={busy}
              onClick={() => setColor(hex)} className={`h-6 w-6 rounded-full border border-[#ffffff]/20 outline-none focus-visible:ring-2 focus-visible:ring-[#ffffff] ${color === hex ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-[#202020]' : ''}`}
              style={{ backgroundColor: hex }} />)}
          </div>
          <button type="button" aria-label="Attach sketch" title="Attach sketch" disabled={busy || !marks.length || !!textAt}
            className={`${button} !bg-[#315b91] !text-[#ffffff]`} onClick={() => void attach()}><Check size={19} /></button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
