"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { XlsxViewCell, XlsxViewSheet } from "@/lib/document-structure/xlsx";

const DEFAULT_COLUMN_WIDTH = 88;
const ROW_HEADER_WIDTH = 46;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 2;

/** 0 → "A", 26 → "AA". */
export function columnLetter(index: number): string {
  let value = index + 1;
  let out = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    out = String.fromCharCode(65 + remainder) + out;
    value = Math.floor((value - 1) / 26);
  }
  return out;
}

/** RFC 4180-ish: quoted fields, doubled quotes, newlines inside quotes. */
function parseDelimited(text: string, delimiter: string, maxRows: number): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && field === "") quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (rows.length >= maxRows) return { rows, truncated: index < text.length - 1 };
    } else field += char;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return { rows, truncated: false };
}

/** A .csv or .tsv as one sheet, so it gets the same grid a workbook does. */
export function sheetFromDelimitedText(name: string, text: string, delimiter: string): XlsxViewSheet {
  const { rows, truncated } = parseDelimited(text.replace(/^﻿/, ""), delimiter, 5000);
  let columnCount = 0;
  const viewRows = rows.flatMap((cells, rowIndex) => {
    const viewCells: XlsxViewCell[] = [];
    cells.slice(0, 200).forEach((value, c) => {
      if (value === "") return;
      const numeric = /^-?(\d{1,3}(,\d{3})*|\d+)(\.\d+)?%?$/.test(value.trim());
      viewCells.push({ c, v: value, ...(numeric ? { n: 1 as const } : {}) });
      columnCount = Math.max(columnCount, c + 1);
    });
    return viewCells.length ? [{ r: rowIndex + 1, cells: viewCells }] : [];
  });
  return {
    name,
    rows: viewRows,
    rowCount: rows.length,
    columnCount,
    merges: [],
    columnWidths: {},
    truncated,
    hidden: false,
  };
}

interface Props {
  sheets: readonly XlsxViewSheet[];
  /** Extra notes from the reader, shown above the grid. */
  warnings?: readonly string[];
}

/**
 * A read-only spreadsheet: column letters and row numbers, merged cells,
 * column widths, a name box and formula bar for the selected cell, zoom, and
 * sheet tabs along the bottom — the parts that make a workbook read as one.
 */
export default function AttachmentSpreadsheetView({ sheets, warnings = [] }: Props) {
  const visibleSheets = useMemo(() => {
    const shown = sheets.filter((sheet) => !sheet.hidden);
    return shown.length ? shown : [...sheets];
  }, [sheets]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const gridRef = useRef<HTMLDivElement | null>(null);
  const sheet = visibleSheets[Math.min(sheetIndex, visibleSheets.length - 1)];

  const showSheet = (index: number) => {
    setSheetIndex(index);
    setSelected({ r: 0, c: 0 });
    gridRef.current?.scrollTo({ top: 0, left: 0 });
  };

  const layout = useMemo(() => {
    if (!sheet) return null;
    const cells = new Map<number, Map<number, XlsxViewCell>>();
    for (const row of sheet.rows) {
      const map = new Map<number, XlsxViewCell>();
      for (const cell of row.cells) map.set(cell.c, cell);
      cells.set(row.r - 1, map);
    }
    const spans = new Map<string, { rs: number; cs: number }>();
    const covered = new Set<string>();
    for (const merge of sheet.merges) {
      spans.set(`${merge.r}:${merge.c}`, { rs: merge.rs, cs: merge.cs });
      for (let r = merge.r; r < merge.r + merge.rs; r += 1) {
        for (let c = merge.c; c < merge.c + merge.cs; c += 1) {
          if (r !== merge.r || c !== merge.c) covered.add(`${r}:${c}`);
        }
      }
    }
    // A little empty margin past the data, the way a spreadsheet always has.
    const rowCount = Math.min(Math.max(sheet.rowCount + 5, 25), sheet.rowCount + 200);
    const columnCount = Math.min(Math.max(sheet.columnCount + 2, 10), 122);
    const widths = Array.from({ length: columnCount }, (_, c) => sheet.columnWidths[c] ?? DEFAULT_COLUMN_WIDTH);
    return { cells, spans, covered, rowCount, columnCount, widths };
  }, [sheet]);

  const selectedCell = layout?.cells.get(selected.r)?.get(selected.c);
  const formulaBarText = selectedCell?.f ? `=${selectedCell.f}` : selectedCell?.v ?? "";

  const move = (dr: number, dc: number) => {
    if (!layout) return;
    const r = Math.min(Math.max(selected.r + dr, 0), layout.rowCount - 1);
    const c = Math.min(Math.max(selected.c + dc, 0), layout.columnCount - 1);
    setSelected({ r, c });
    requestAnimationFrame(() => {
      gridRef.current
        ?.querySelector<HTMLElement>(`[data-cell="${r}:${c}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      Enter: [1, 0],
      Tab: [0, event.shiftKey ? -1 : 1],
    };
    const delta = step[event.key];
    if (!delta) return;
    event.preventDefault();
    move(delta[0], delta[1]);
  };

  if (!sheet || !layout) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sm text-[var(--ink-muted)]">
        <p>Nothing readable came out of this workbook.</p>
        {warnings.map((warning) => <p key={warning} className="text-xs">{warning}</p>)}
      </div>
    );
  }

  const fontSize = Math.round(12 * zoom * 10) / 10;
  const rowHeight = Math.round(22 * zoom);
  const headerCell =
    "sticky z-[2] select-none border-b border-r border-[var(--line)] bg-[var(--paper-strong)] text-center font-normal text-[var(--ink-muted)]";

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--paper-surface)] text-[var(--ink)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--line)] px-3 py-1.5">
        <span
          className="w-16 shrink-0 rounded-md border border-[var(--line)] bg-[var(--paper-raised)] px-2 py-1 text-center font-mono text-xs text-[var(--ink-heading)]"
          aria-label="Selected cell"
        >
          {columnLetter(selected.c)}
          {selected.r + 1}
        </span>
        <span className="shrink-0 font-serif text-sm italic text-[var(--ink-muted)]" aria-hidden>
          fx
        </span>
        <input
          readOnly
          value={formulaBarText}
          aria-label="Cell contents"
          className="h-7 min-w-0 flex-1 rounded-md border border-[var(--line)] bg-[var(--paper-raised)] px-2 font-mono text-xs text-[var(--ink-heading)] outline-none"
        />
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setZoom((value) => Math.max(MIN_ZOOM, Math.round((value - 0.1) * 10) / 10))}
            disabled={zoom <= MIN_ZOOM}
            className="grid h-7 w-7 place-items-center rounded-md border border-[var(--line)] text-sm text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)] disabled:opacity-40"
            aria-label="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            onClick={() => setZoom(1)}
            className="w-12 text-center text-xs tabular-nums text-[var(--ink-muted)] hover:text-[var(--ink-heading)]"
            title="Reset zoom"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setZoom((value) => Math.min(MAX_ZOOM, Math.round((value + 0.1) * 10) / 10))}
            disabled={zoom >= MAX_ZOOM}
            className="grid h-7 w-7 place-items-center rounded-md border border-[var(--line)] text-sm text-[var(--ink-muted)] transition hover:bg-[var(--paper-strong)] hover:text-[var(--ink-heading)] disabled:opacity-40"
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      </div>

      {warnings.length || sheet.truncated ? (
        <div className="shrink-0 border-b border-[var(--line)] bg-[var(--paper-strong)] px-3 py-1.5 text-xs text-[var(--ink-muted)]">
          {sheet.truncated ? <p>This sheet is large; only the first part is shown here. Download the original for all of it.</p> : null}
          {warnings.map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      ) : null}

      <div
        ref={gridRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-auto bg-[var(--paper-raised)] focus:outline-none"
        role="grid"
        aria-label={`Sheet ${sheet.name}`}
      >
        <table
          className="border-separate border-spacing-0"
          style={{ fontSize, tableLayout: "fixed", width: ROW_HEADER_WIDTH * zoom + layout.widths.reduce((a, b) => a + b * zoom, 0) }}
        >
          <colgroup>
            <col style={{ width: ROW_HEADER_WIDTH * zoom }} />
            {layout.widths.map((width, c) => (
              <col key={c} style={{ width: width * zoom }} />
            ))}
          </colgroup>
          <thead>
            <tr style={{ height: rowHeight }}>
              <th className={`${headerCell} left-0 top-0 z-[3]`} aria-label="Select all" />
              {layout.widths.map((width, c) => (
                <th
                  key={c}
                  scope="col"
                  className={`${headerCell} top-0 ${selected.c === c ? "!bg-[color-mix(in_srgb,var(--botanical)_22%,var(--paper-strong))] font-semibold text-[var(--ink-heading)]" : ""}`}
                  style={width === 0 ? { padding: 0, borderRightWidth: 0 } : undefined}
                >
                  {width === 0 ? null : columnLetter(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: layout.rowCount }, (_, r) => {
              const rowCells = layout.cells.get(r);
              return (
                <tr key={r} style={{ height: rowHeight }}>
                  <th
                    scope="row"
                    className={`${headerCell} left-0 z-[1] tabular-nums ${selected.r === r ? "!bg-[color-mix(in_srgb,var(--botanical)_22%,var(--paper-strong))] font-semibold text-[var(--ink-heading)]" : ""}`}
                  >
                    {r + 1}
                  </th>
                  {layout.widths.map((width, c) => {
                    const key = `${r}:${c}`;
                    if (layout.covered.has(key)) return null;
                    const span = layout.spans.get(key);
                    const cell = rowCells?.get(c);
                    const isSelected = selected.r === r && selected.c === c;
                    return (
                      <td
                        key={c}
                        data-cell={key}
                        rowSpan={span?.rs}
                        colSpan={span?.cs}
                        onMouseDown={() => setSelected({ r, c })}
                        title={cell && cell.v.length > 24 ? cell.v : undefined}
                        className={[
                          "overflow-hidden text-ellipsis whitespace-nowrap border-b border-r border-[var(--line)] px-1.5",
                          cell?.n ? "text-right tabular-nums" : "",
                          cell?.e ? "text-[#c0392b]" : "",
                          cell?.b ? "font-semibold text-[var(--ink-heading)]" : "",
                          span ? "text-center align-middle" : "",
                          isSelected ? "relative outline outline-2 -outline-offset-1 outline-[var(--botanical)]" : "",
                        ].join(" ")}
                        style={width === 0 && !span ? { padding: 0, borderRightWidth: 0 } : undefined}
                      >
                        {cell?.v}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {visibleSheets.length > 1 ? (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-[var(--line)] bg-[var(--paper-strong)] px-2 py-1" role="tablist" aria-label="Sheets">
          {visibleSheets.map((entry, index) => (
            <button
              key={`${entry.name}-${index}`}
              type="button"
              role="tab"
              aria-selected={index === sheetIndex}
              onClick={() => showSheet(index)}
              className={`shrink-0 rounded-md px-3 py-1 text-xs transition ${
                index === sheetIndex
                  ? "bg-[var(--paper-raised)] font-medium text-[var(--ink-heading)] shadow-sm"
                  : "text-[var(--ink-muted)] hover:bg-[var(--paper-surface)] hover:text-[var(--ink-heading)]"
              }`}
            >
              {entry.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
