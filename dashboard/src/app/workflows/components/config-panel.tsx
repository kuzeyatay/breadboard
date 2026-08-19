"use client";

// Right-side config panel: selected block's subblocks rendered as one of 6
// field widgets (short-input, long-input, dropdown, switch, code, slider),
// respecting SubBlockConfig.condition visibility. Field values write straight
// to the subblock store (per-keystroke, canvas-stable per sim's split).

import { useMemo, useState } from "react";
import {
  isConditionMet,
  resolveBlockConfig,
  resolveOptions,
  type CanvasSubBlockConfig,
} from "../lib/registry";
import { useSubBlockStore } from "../stores/subblock-store";
import { useWorkflowStore } from "../stores/workflow-store";

function FieldLabel({ subBlock }: { subBlock: CanvasSubBlockConfig }) {
  return (
    <label className="mb-1 block text-xs font-medium text-[var(--ink-muted)]" title={subBlock.tooltip}>
      {subBlock.title ?? subBlock.id}
    </label>
  );
}

function ShortInput({ subBlock, value, onChange }: FieldProps) {
  return (
    <input
      type={subBlock.password ? "password" : "text"}
      value={typeof value === "string" || typeof value === "number" ? String(value) : ""}
      onChange={(event) => onChange(event.target.value)}
      placeholder={subBlock.placeholder}
      readOnly={subBlock.readOnly}
      className="neu-control w-full rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
    />
  );
}

function LongInput({ subBlock, value, onChange }: FieldProps) {
  return (
    <textarea
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.target.value)}
      placeholder={subBlock.placeholder}
      readOnly={subBlock.readOnly}
      rows={subBlock.rows ?? 4}
      className="neu-control w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
    />
  );
}

function CodeInput({ subBlock, value, onChange }: FieldProps) {
  return (
    <textarea
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.target.value)}
      placeholder={subBlock.placeholder ?? "// code"}
      spellCheck={false}
      rows={8}
      className="neu-control w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2 font-mono text-xs text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
    />
  );
}

function DropdownInput({ subBlock, value, onChange }: FieldProps) {
  const options = useMemo(() => resolveOptions(subBlock), [subBlock]);
  return (
    <select
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.target.value)}
      className="neu-control w-full rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] px-3 py-2 text-sm text-[var(--ink)] outline-none"
    >
      <option value="">Select…</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function SwitchInput({ value, onChange }: FieldProps) {
  const checked = Boolean(value);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${checked ? "bg-[var(--botanical)]" : "bg-[var(--line-strong)]"}`}
    >
      <span
        className={`pointer-events-none block size-4 rounded-full bg-white shadow-sm transition-transform ${checked ? "translate-x-[18px]" : "translate-x-0.5"}`}
      />
    </button>
  );
}

function SliderInput({ subBlock, value, onChange }: FieldProps) {
  const min = subBlock.min ?? 0;
  const max = subBlock.max ?? 100;
  const numeric = typeof value === "number" ? value : Number(value) || min;
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        value={numeric}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-[var(--botanical)]"
      />
      <span className="w-10 shrink-0 text-right text-xs text-[var(--ink-muted)]">{numeric}</span>
    </div>
  );
}

type FieldProps = {
  subBlock: CanvasSubBlockConfig;
  value: unknown;
  onChange: (value: unknown) => void;
};

/** The 6 field widgets the brief calls for; unmapped sim subblock types fall back to short-input. */
function FieldWidget(props: FieldProps) {
  switch (props.subBlock.type) {
    case "long-input":
      return <LongInput {...props} />;
    case "code":
      return <CodeInput {...props} />;
    case "dropdown":
    case "combobox":
      return <DropdownInput {...props} />;
    case "switch":
      return <SwitchInput {...props} />;
    case "slider":
      return <SliderInput {...props} />;
    default:
      return <ShortInput {...props} />;
  }
}

export function ConfigPanel({ blockId, onClose }: { blockId: string; onClose: () => void }) {
  const block = useWorkflowStore((state) => state.blocks[blockId]);
  const renameBlock = useWorkflowStore((state) => state.renameBlock);
  const setBlockEnabled = useWorkflowStore((state) => state.setBlockEnabled);
  const removeBlock = useWorkflowStore((state) => state.removeBlock);
  const duplicateBlock = useWorkflowStore((state) => state.duplicateBlock);
  const values = useSubBlockStore((state) => state.values[blockId] ?? {});
  const setValue = useSubBlockStore((state) => state.setValue);
  const [nameDraft, setNameDraft] = useState(block?.name ?? "");

  const config = useMemo(() => (block ? resolveBlockConfig(block.type) : null), [block]);

  if (!block || !config) return null;

  const visibleSubBlocks = config.subBlocks.filter(
    (sub) => !sub.hidden && sub.context !== "tool-input" && isConditionMet(sub.condition, values),
  );

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-[var(--line)] bg-[var(--paper-surface)]">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--line)] p-3">
        <input
          value={nameDraft}
          onChange={(event) => setNameDraft(event.target.value)}
          onBlur={() => renameBlock(blockId, nameDraft)}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          }}
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1 py-1 text-sm font-semibold text-[var(--ink-heading)] outline-none focus:border-[var(--line)] focus:bg-[var(--paper-raised)]"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close block settings"
          className="neu-button-icon flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)]"
        >
          ×
        </button>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-2">
        <label className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
          <input
            type="checkbox"
            checked={block.enabled !== false}
            onChange={(event) => setBlockEnabled(blockId, event.target.checked)}
          />
          Enabled
        </label>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => duplicateBlock(blockId)}
            className="neu-button rounded-lg px-2.5 py-1 text-xs text-[var(--ink)]"
          >
            Duplicate
          </button>
          <button
            type="button"
            onClick={() => {
              removeBlock(blockId);
              onClose();
            }}
            disabled={block.type === "starter"}
            className="neu-button rounded-lg px-2.5 py-1 text-xs text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        {visibleSubBlocks.length === 0 ? (
          <p className="px-1 text-xs leading-5 text-[var(--ink-muted)]">This block has no configurable fields.</p>
        ) : (
          visibleSubBlocks.map((sub) => (
            <div key={sub.id}>
              <FieldLabel subBlock={sub} />
              <FieldWidget
                subBlock={sub}
                value={values[sub.id]}
                onChange={(value) => setValue(blockId, sub.id, value)}
              />
              {sub.description ? (
                <p className="mt-1 text-[11px] leading-4 text-[var(--ink-faint)]">{sub.description}</p>
              ) : null}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
