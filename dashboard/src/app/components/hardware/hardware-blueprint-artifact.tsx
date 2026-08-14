"use client";

// The Hardware Blueprint artifact.
//
// Everything here is rendered from the stored HardwareDesign — no request is
// made and no model runs, so reopening a blueprint is instant and always shows
// the design as it was compiled. Selection is one piece of state shared by the
// wiring diagram, the schematic, the BOM, the assembly steps and validation, so
// picking a step or a finding lights up the same parts everywhere.

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  designExportFiles,
  designProjectZip,
  projectZipFilename,
} from "@/lib/hardware/exports.ts";
import { designOverview, type PartRole } from "@/lib/hardware/overview.ts";
import { VALIDATION_DISCLAIMER } from "@/lib/hardware/safety.ts";
import { VALIDATION_RULES, describeValidationRule } from "@/lib/hardware/validation.ts";
import type { BomItem, HardwareDesign, ValidationSeverity } from "@/lib/hardware/types";
import FirmwareView from "./firmware-view";
import SchematicView from "./schematic-view";
import WiringView, { type Selection } from "./wiring-view";

const SECTIONS = [
  "Overview",
  "Wiring",
  "Schematic",
  "BOM",
  "Assembly",
  "Firmware",
  "Validation",
  "Data",
] as const;
type Section = (typeof SECTIONS)[number];

const STATUS_TEXT: Record<HardwareDesign["status"], { label: string; tone: string }> = {
  ready: { label: "Ready to build", tone: "text-[var(--botanical)]" },
  "ready-with-warnings": {
    label: "Ready, with warnings",
    tone: "text-[#9a6b16] dark:text-[#e0b464]",
  },
  "needs-changes": { label: "Needs changes", tone: "text-[#9a4438] dark:text-[#efb4aa]" },
  "concept-only": { label: "Concept only", tone: "text-[#9a4438] dark:text-[#efb4aa]" },
};

const EMPTY: Selection = { componentIds: [], netIds: [] };

function download(filename: string, content: string | Uint8Array, mimeType: string): void {
  const blob =
    typeof content === "string"
      ? new Blob([content], { type: mimeType })
      : new Blob([content.slice().buffer as ArrayBuffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function Chip({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div
      className="rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-3 py-2"
      title={hint}
    >
      <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--ink-muted)]">{label}</p>
      <p className="mt-0.5 text-sm text-[var(--ink-heading)]">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] leading-4 text-[var(--ink-muted)]">{hint}</p> : null}
    </div>
  );
}

const SEVERITY_META: Record<
  ValidationSeverity,
  { label: string; plural: string; blurb: string; accent: string; tint: string }
> = {
  error: {
    label: "Error",
    plural: "Errors",
    blurb: "Fix before you build. The circuit as drawn can damage a part or cannot work.",
    accent: "#c2503f",
    tint: "bg-[#fdf3f1] dark:bg-[#3b2320]",
  },
  warning: {
    label: "Warning",
    plural: "Warnings",
    blurb: "It will work, but there is something to know before you wire it.",
    accent: "#c99000",
    tint: "bg-[#fdf8ec] dark:bg-[#38301c]",
  },
  info: {
    label: "Note",
    plural: "Notes",
    blurb: "Something the checks could not settle either way.",
    accent: "var(--botanical)",
    tint: "bg-[var(--paper-strong)]",
  },
};

const SEVERITY_RANK: Record<ValidationSeverity, number> = { error: 0, warning: 1, info: 2 };

/** One "GPIO21 → SDA" style meta row under a part or a finding. */
function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-2 text-xs leading-5">
      <span className="w-16 shrink-0 text-[var(--ink-muted)]">{label}</span>
      <span className="min-w-0 flex-1 text-[var(--ink)]">{children}</span>
    </div>
  );
}

export default function HardwareBlueprintArtifact({
  design,
  initialSection = "Overview",
}: {
  design: HardwareDesign;
  /** Which tab to open on. The blueprint opens on its overview by default. */
  initialSection?: Section;
}) {
  const [section, setSection] = useState<Section>(initialSection);
  const [selection, setSelection] = useState<Selection>(EMPTY);
  const [bomSort, setBomSort] = useState<{ key: keyof BomItem; ascending: boolean }>({
    key: "reference",
    ascending: true,
  });
  const [copiedJson, setCopiedJson] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<ValidationSeverity | "all">("all");

  const counts = useMemo(
    () => ({
      errors: design.validationResults.filter((entry) => entry.severity === "error").length,
      warnings: design.validationResults.filter((entry) => entry.severity === "warning").length,
      info: design.validationResults.filter((entry) => entry.severity === "info").length,
    }),
    [design.validationResults],
  );

  const overview = useMemo(() => designOverview(design), [design]);

  const findings = useMemo(() => {
    const ordered = [...design.validationResults].sort(
      (left, right) => SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity],
    );
    return severityFilter === "all"
      ? ordered
      : ordered.filter((entry) => entry.severity === severityFilter);
  }, [design.validationResults, severityFilter]);

  const estimatedCurrent =
    overview.power.typicalMa === undefined
      ? "not estimated"
      : `${Math.round(overview.power.typicalMa)} mA typical`;

  const sortedBom = useMemo(() => {
    const items = [...design.bom];
    items.sort((left, right) => {
      const a = left[bomSort.key];
      const b = right[bomSort.key];
      const compared =
        typeof a === "number" && typeof b === "number"
          ? a - b
          : String(a ?? "").localeCompare(String(b ?? ""));
      return bomSort.ascending ? compared : -compared;
    });
    return items;
  }, [bomSort, design.bom]);

  const exportFiles = useMemo(() => designExportFiles(design), [design]);
  const designJson = useMemo(() => JSON.stringify(design, null, 2), [design]);

  /** Highlight something and go look at it. Only ever called from a control
   *  that says so — reading a finding no longer throws you into the diagram. */
  const showInWiring = (componentIds: string[], netIds: string[]) => {
    setSelection({ componentIds, netIds });
    setSection("Wiring");
  };

  const tabClass = (name: Section) =>
    `rounded-lg px-3 py-1.5 text-sm transition-colors ${
      section === name
        ? "bg-[var(--paper-raised)] font-semibold text-[var(--ink-heading)] shadow-sm"
        : "text-[var(--ink-muted)] hover:text-[var(--ink-heading)]"
    }`;

  const actionButton =
    "neu-button rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] px-2.5 py-1 text-xs text-[var(--ink-heading)]";

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-[var(--ink-heading)]">{design.title}</h2>
          <p className={`text-xs font-medium ${STATUS_TEXT[design.status].tone}`}>
            {STATUS_TEXT[design.status].label}
            {counts.errors ? ` · ${counts.errors} error${counts.errors === 1 ? "" : "s"}` : ""}
            {counts.warnings ? ` · ${counts.warnings} warning${counts.warnings === 1 ? "" : "s"}` : ""}
          </p>
        </div>
      </header>

      <nav
        aria-label="Blueprint sections"
        className="flex flex-wrap gap-1 rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-1"
      >
        {SECTIONS.map((name) => (
          <button key={name} type="button" className={tabClass(name)} onClick={() => setSection(name)}>
            {name}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-auto">
        {section === "Overview" ? (
          <div className="space-y-4">
            <p className="text-sm leading-6 text-[var(--ink)]">{design.summary}</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Chip
                label="Controller"
                value={overview.controller?.name ?? "—"}
                hint={
                  overview.controller?.logicVoltage === undefined
                    ? undefined
                    : `${overview.controller.reference} · ${overview.controller.logicVoltage} V logic`
                }
              />
                <Chip
                  label="Power source"
                  value={`${design.request.power.source}${
                    design.request.power.part ? ` · ${design.request.power.part}` : ""
                  }`}
                hint={
                  overview.rails.length
                    ? `Rails: ${overview.rails
                        .map((rail) => (rail.voltage === undefined ? rail.name : `${rail.voltage} V`))
                        .join(", ")}`
                    : undefined
                }
              />
              <Chip
                label="Estimated current"
                value={estimatedCurrent}
                hint={
                  overview.power.maximumMa === undefined
                    ? undefined
                    : `${Math.round(overview.power.maximumMa)} mA worst case`
                }
              />
              <Chip
                label="Parts"
                value={`${overview.counts.orderable} to buy`}
                hint={`${overview.counts.placed} placed${
                  overview.counts.automatic
                    ? `, ${overview.counts.automatic} added by the compiler`
                    : ""
                }`}
              />
              <Chip
                label="Nets"
                value={String(overview.counts.nets)}
                hint={`${overview.counts.connections} pin connections`}
              />
              <Chip
                label="Checks"
                value={
                  counts.errors || counts.warnings
                    ? `${counts.errors} error${counts.errors === 1 ? "" : "s"}, ${counts.warnings} warning${
                        counts.warnings === 1 ? "" : "s"
                      }`
                    : "all passed"
                }
                hint={`${VALIDATION_RULES.length} rules ran`}
              />
              <Chip
                label="Estimated cost"
                value={overview.cost.total === undefined ? "—" : `~ €${overview.cost.total.toFixed(2)}`}
                hint={overview.cost.complete ? "Every line has a price" : "Some lines have no price"}
              />
              <Chip
                label="Build style"
                value={design.request.prototypeType}
                hint={
                  design.firmware
                    ? `${design.firmware.platform} · ${design.firmware.language}`
                    : undefined
                }
              />
            </div>

            <section>
              <h3 className="text-sm font-semibold text-[var(--ink-heading)]">
                What each part does
              </h3>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
                Every part in the design, grouped by the job it does, with the wiring the compiler
                gave it. Pin names come from the same pin assignments the diagrams and the firmware
                use.
              </p>
              <div className="mt-2 space-y-4">
                {overview.groups.map((group) => (
                  <div key={group.id}>
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-heading)]">
                        {group.label}
                      </h4>
                      <p className="text-xs text-[var(--ink-muted)]">{group.blurb}</p>
                    </div>
                    <ul className="mt-1.5 space-y-2">
                      {group.parts.map((part: PartRole) => (
                        <li
                          key={part.componentId}
                          className="rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-3"
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <p className="text-sm font-semibold text-[var(--ink-heading)]">
                              <span className="font-mono text-xs">{part.reference}</span>{" "}
                              {part.name}
                              {part.value ? (
                                <span className="font-normal text-[var(--ink)]"> · {part.value}</span>
                              ) : null}
                            </p>
                            <div className="flex items-center gap-1.5">
                              {part.address ? (
                                <span className="rounded bg-[var(--paper-raised)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ink-muted)]">
                                  {part.address}
                                </span>
                              ) : null}
                              {part.automatic ? (
                                <span className="rounded bg-[var(--paper-raised)] px-1.5 py-0.5 text-[10px] text-[var(--ink-muted)]">
                                  added automatically
                                </span>
                              ) : null}
                              <button
                                type="button"
                                className={actionButton}
                                onClick={() => showInWiring([part.componentId], [])}
                              >
                                Show in wiring
                              </button>
                            </div>
                          </div>
                          <p className="mt-1 text-sm leading-6 text-[var(--ink)]">{part.job}</p>
                          <div className="mt-1.5 space-y-0.5">
                            <MetaRow label="Wired">{part.link}</MetaRow>
                            <MetaRow label="Power">{part.supply}</MetaRow>
                            <MetaRow label="Draw">{part.draw}</MetaRow>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>

            {design.componentResearch?.length ? (
              <details className="rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-3">
                <summary className="cursor-pointer text-sm font-semibold text-[var(--ink-heading)]">
                  Online component research ({design.componentResearch.length})
                </summary>
                <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
                  These records are saved with this blueprint. A found product is used for wiring only
                  when manufacturer evidence supplies every fact the compiler needs.
                </p>
                <ul className="mt-2 space-y-2">
                  {design.componentResearch.map((record, index) => (
                    <li
                      key={`${record.requestedAs}-${index}`}
                      className="rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] p-2.5"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-medium text-[var(--ink-heading)]">
                          {record.requestedAs}
                        </p>
                        <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--ink-muted)]">
                          {record.status.replaceAll("-", " ")}
                        </span>
                      </div>
                      {record.definition?.manufacturer || record.definition?.manufacturerPartNumber ? (
                        <p className="mt-0.5 text-xs text-[var(--ink)]">
                          {[record.definition.manufacturer, record.definition.manufacturerPartNumber]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">{record.note}</p>
                      {record.sources.length ? (
                        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                          {record.sources.map((source) => (
                            <li key={source.url}>
                              <a
                                href={source.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[var(--botanical)] underline underline-offset-2"
                              >
                                {source.title}
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}

            {overview.rails.length || overview.busses.length ? (
              <section>
                <h3 className="text-sm font-semibold text-[var(--ink-heading)]">
                  Rails and buses
                </h3>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {overview.rails.map((rail) => (
                    <button
                      key={rail.netId}
                      type="button"
                      onClick={() => showInWiring([], [rail.netId])}
                      className="rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-3 text-left hover:bg-[var(--paper-raised)]"
                    >
                      <p className="font-mono text-xs font-semibold text-[var(--ink-heading)]">
                        {rail.name}
                        {rail.voltage === undefined ? "" : ` · ${rail.voltage} V`}
                      </p>
                      <p className="mt-0.5 text-xs leading-5 text-[var(--ink)]">
                        {rail.references.length
                          ? `Feeds ${rail.references.join(", ")}.`
                          : "Nothing draws from this rail."}
                        {rail.typicalLoadMa === undefined
                          ? ""
                          : ` About ${rail.typicalLoadMa} mA typical.`}
                      </p>
                    </button>
                  ))}
                  {overview.busses.map((bus) => (
                    <button
                      key={bus.label}
                      type="button"
                      onClick={() => showInWiring([], bus.netIds)}
                      className="rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-3 text-left hover:bg-[var(--paper-raised)]"
                    >
                      <p className="text-xs font-semibold text-[var(--ink-heading)]">{bus.label}</p>
                      <p className="mt-0.5 text-xs leading-5 text-[var(--ink)]">
                        {bus.references.length
                          ? `Shared by ${bus.references.join(", ")}.`
                          : "No device on it yet."}
                      </p>
                      <ul className="mt-1 space-y-0.5 font-mono text-[11px] leading-4 text-[var(--ink-muted)]">
                        {bus.links.map((link) => (
                          <li key={link}>{link}</li>
                        ))}
                      </ul>
                    </button>
                  ))}
                </div>
                {overview.power.undocumented.length ? (
                  <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]">
                    The current figure leaves out {overview.power.undocumented.join(", ")} — the
                    library has no draw documented for {overview.power.undocumented.length === 1 ? "it" : "them"}.
                  </p>
                ) : null}
              </section>
            ) : null}

            <section>
              <h3 className="text-sm font-semibold text-[var(--ink-heading)]">Design decisions</h3>
              <ul className="mt-2 space-y-2">
                {design.decisions.map((decision) => (
                  <li
                    key={`${decision.category}-${decision.selection}`}
                    className="rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-3"
                  >
                    <p className="text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">
                      {decision.category}
                    </p>
                    <p className="text-sm font-medium text-[var(--ink-heading)]">{decision.selection}</p>
                    <p className="mt-0.5 text-sm text-[var(--ink)]">{decision.rationale}</p>
                  </li>
                ))}
              </ul>
            </section>

            <p className="rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-3 text-xs leading-5 text-[var(--ink-muted)]">
              {VALIDATION_DISCLAIMER}
            </p>
          </div>
        ) : null}

        {section === "Wiring" ? (
          <WiringView design={design} selection={selection} onSelect={setSelection} />
        ) : null}

        {section === "Schematic" ? (
          <SchematicView design={design} selection={selection} onSelect={setSelection} />
        ) : null}

        {section === "BOM" ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-left text-xs uppercase tracking-wide text-[var(--ink-muted)]">
                  {(
                    [
                      ["reference", "Ref"],
                      ["name", "Component"],
                      ["valueOrModel", "Value / model"],
                      ["quantity", "Qty"],
                      ["purpose", "Purpose"],
                      ["manufacturerPartNumber", "MPN"],
                      ["estimatedTotalPrice", "Est. total"],
                    ] as Array<[keyof BomItem, string]>
                  ).map(([key, label]) => (
                    <th key={String(key)} scope="col" className="px-2 py-2">
                      <button
                        type="button"
                        className="font-semibold uppercase hover:text-[var(--ink-heading)]"
                        onClick={() =>
                          setBomSort((current) => ({
                            key,
                            ascending: current.key === key ? !current.ascending : true,
                          }))
                        }
                      >
                        {label}
                        {bomSort.key === key ? (bomSort.ascending ? " ▲" : " ▼") : ""}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedBom.map((item) => {
                  const instances = design.components.filter(
                    (instance) => instance.definitionId === item.componentDefinitionId,
                  );
                  const automatic = instances.some((instance) => instance.automaticallyAdded);
                  return (
                    <tr
                      key={`${item.componentDefinitionId}-${item.reference}`}
                      className="cursor-pointer border-b border-[var(--line)] align-top hover:bg-[var(--paper-strong)]"
                      onClick={() =>
                        showInWiring(
                          instances.map((instance) => instance.id),
                          [],
                        )
                      }
                    >
                      <td className="px-2 py-2 font-mono text-xs text-[var(--ink-heading)]">
                        {item.reference}
                      </td>
                      <td className="px-2 py-2 text-[var(--ink)]">
                        {item.name}
                        {automatic ? (
                          <span className="ml-1.5 rounded bg-[var(--paper-strong)] px-1.5 py-0.5 text-[10px] text-[var(--ink-muted)]">
                            added automatically
                          </span>
                        ) : null}
                        {item.substitutes.length ? (
                          <span className="mt-0.5 block text-xs text-[var(--ink-muted)]">
                            Substitutes: {item.substitutes.join("; ")}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-2 text-[var(--ink)]">{item.valueOrModel ?? "—"}</td>
                      <td className="px-2 py-2 text-[var(--ink)]">{item.quantity}</td>
                      <td className="px-2 py-2 text-xs text-[var(--ink-muted)]">{item.purpose}</td>
                      <td className="px-2 py-2 font-mono text-xs text-[var(--ink)]">
                        {item.manufacturerPartNumber ?? "—"}
                      </td>
                      <td className="px-2 py-2 text-[var(--ink)]">
                        {item.estimatedTotalPrice === undefined
                          ? "—"
                          : `~ €${item.estimatedTotalPrice.toFixed(2)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-[var(--ink-muted)]">
              Prices are rough estimates carried in the component library, not live quotes. Select a
              row to highlight the part in the wiring view.
            </p>
          </div>
        ) : null}

        {section === "Assembly" ? (
          <ol className="space-y-2">
            {design.assemblySteps.map((step) => {
              const chosen =
                step.componentIds.some((id) => selection.componentIds.includes(id)) ||
                step.netIds.some((id) => selection.netIds.includes(id));
              return (
                <li key={step.id}>
                  <button
                    type="button"
                    onClick={() => setSelection({ componentIds: step.componentIds, netIds: step.netIds })}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${
                      chosen
                        ? "border-[var(--botanical)] bg-[var(--paper-raised)]"
                        : "border-[var(--line)] bg-[var(--paper-strong)] hover:bg-[var(--paper-raised)]"
                    }`}
                  >
                    <p className="text-sm font-semibold text-[var(--ink-heading)]">
                      {step.index}. {step.title}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-[var(--ink)]">{step.instruction}</p>
                    {step.warning ? (
                      <p className="mt-1.5 rounded-lg bg-[#fdf3f1] px-2 py-1.5 text-xs text-[#9a4438] dark:bg-[#3b2320] dark:text-[#efb4aa]">
                        {step.warning}
                      </p>
                    ) : null}
                    {step.verification ? (
                      <p className="mt-1.5 text-xs text-[var(--ink-muted)]">Check: {step.verification}</p>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ol>
        ) : null}

        {section === "Firmware" ? (
          <FirmwareView
            firmware={design.firmware}
            onDownloadFile={(path, content) =>
              download(path.split("/").pop() ?? "firmware.txt", content, "text/plain")
            }
            onDownloadProject={() =>
              download(projectZipFilename(design), designProjectZip(design), "application/zip")
            }
          />
        ) : null}

        {section === "Validation" ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-3">
              <p className={`text-sm font-semibold ${STATUS_TEXT[design.status].tone}`}>
                {STATUS_TEXT[design.status].label}
              </p>
              <p className="mt-0.5 text-xs leading-5 text-[var(--ink-muted)]">
                {VALIDATION_RULES.length} rules ran against the compiled circuit.{" "}
                {design.validationResults.length === 0
                  ? "None of them fired."
                  : `${design.validationResults.length} finding${
                      design.validationResults.length === 1 ? "" : "s"
                    }: ${counts.errors} error${counts.errors === 1 ? "" : "s"}, ${
                      counts.warnings
                    } warning${counts.warnings === 1 ? "" : "s"}, ${counts.info} note${
                      counts.info === 1 ? "" : "s"
                    }.`}
              </p>
              {design.validationResults.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(
                    [
                      ["all", `All ${design.validationResults.length}`],
                      ...(["error", "warning", "info"] as ValidationSeverity[])
                        .filter((severity) =>
                          design.validationResults.some((entry) => entry.severity === severity),
                        )
                        .map(
                          (severity) =>
                            [
                              severity,
                              `${SEVERITY_META[severity].plural} ${
                                design.validationResults.filter(
                                  (entry) => entry.severity === severity,
                                ).length
                              }`,
                            ] as const,
                        ),
                    ] as Array<readonly [ValidationSeverity | "all", string]>
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={severityFilter === value}
                      onClick={() => setSeverityFilter(value)}
                      className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                        severityFilter === value
                          ? "border-[var(--botanical)] bg-[var(--paper-raised)] font-semibold text-[var(--ink-heading)]"
                          : "border-[var(--line)] text-[var(--ink-muted)] hover:text-[var(--ink-heading)]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {design.validationResults.length === 0 ? (
              <p className="rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-3 text-sm leading-6 text-[var(--ink)]">
                Every check passed. That is not the same as safe — the checks below are the only
                ones that ran, and the notice at the bottom of this page still applies.
              </p>
            ) : null}

            {findings.map((finding) => {
              const meta = SEVERITY_META[finding.severity];
              const parts = finding.componentIds
                .map((id) => design.components.find((instance) => instance.id === id))
                .filter((instance): instance is NonNullable<typeof instance> => Boolean(instance));
              const nets = finding.netIds
                .map((id) => design.nets.find((net) => net.id === id))
                .filter((net): net is NonNullable<typeof net> => Boolean(net));
              return (
                <article
                  key={finding.id}
                  className={`rounded-xl border border-[var(--line)] p-3 ${meta.tint}`}
                  style={{ borderLeftWidth: 4, borderLeftColor: meta.accent }}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p
                      className="text-xs font-semibold uppercase tracking-wide"
                      style={{ color: meta.accent }}
                    >
                      {meta.label}
                    </p>
                    {parts.length || nets.length ? (
                      <button
                        type="button"
                        className={actionButton}
                        onClick={() => showInWiring(finding.componentIds, finding.netIds)}
                      >
                        Show in wiring
                      </button>
                    ) : null}
                  </div>
                  <h3 className="mt-0.5 text-sm font-semibold text-[var(--ink-heading)]">
                    {finding.title}
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--ink)]">{finding.message}</p>
                  {finding.remediation ? (
                    <p className="mt-1.5 rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] p-2 text-sm leading-6 text-[var(--ink)]">
                      <span className="font-semibold">Fix: </span>
                      {finding.remediation}
                    </p>
                  ) : null}

                  <div className="mt-2 space-y-1">
                    {parts.length ? (
                      <MetaRow label="Parts">
                        <span className="flex flex-wrap gap-1">
                          {parts.map((instance) => (
                            <button
                              key={instance.id}
                              type="button"
                              title={`Highlight ${instance.name} in the wiring diagram`}
                              onClick={() => showInWiring([instance.id], [])}
                              className="rounded border border-[var(--line)] bg-[var(--paper-raised)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--ink-heading)] hover:border-[var(--botanical)]"
                            >
                              {instance.reference} {instance.name}
                            </button>
                          ))}
                        </span>
                      </MetaRow>
                    ) : null}
                    {nets.length ? (
                      <MetaRow label="Nets">
                        <span className="flex flex-wrap gap-1">
                          {nets.map((net) => (
                            <button
                              key={net.id}
                              type="button"
                              title={`Highlight ${net.name} in the wiring diagram`}
                              onClick={() => showInWiring([], [net.id])}
                              className="rounded border border-[var(--line)] bg-[var(--paper-raised)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--ink-heading)] hover:border-[var(--botanical)]"
                            >
                              {net.name}
                            </button>
                          ))}
                        </span>
                      </MetaRow>
                    ) : null}
                    <MetaRow label="Rule">
                      <span className="font-mono text-[11px]">{finding.rule}</span>
                      <span className="block text-[var(--ink-muted)]">
                        {describeValidationRule(finding.rule)}
                      </span>
                    </MetaRow>
                  </div>
                </article>
              );
            })}

            <details className="rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-3">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--ink-heading)]">
                What was checked ({VALIDATION_RULES.length} rules)
              </summary>
              <ul className="mt-2 space-y-1.5">
                {VALIDATION_RULES.map((rule) => (
                  <li key={rule} className="text-xs leading-5">
                    <span className="font-mono text-[11px] text-[var(--ink-heading)]">{rule}</span>
                    <span className="block text-[var(--ink-muted)]">
                      {describeValidationRule(rule)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>

            <p className="rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-3 text-xs leading-5 text-[var(--ink-muted)]">
              {VALIDATION_DISCLAIMER}
            </p>
          </div>
        ) : null}

        {section === "Data" ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={actionButton}
                onClick={() => {
                  void navigator.clipboard
                    .writeText(designJson)
                    .then(() => {
                      setCopiedJson(true);
                      setTimeout(() => setCopiedJson(false), 1600);
                    })
                    .catch(() => setCopiedJson(false));
                }}
              >
                {copiedJson ? "Design JSON copied" : "Copy design JSON"}
              </button>
              {exportFiles.map((file) => (
                <button
                  key={file.path}
                  type="button"
                  className={actionButton}
                  title={file.description}
                  onClick={() =>
                    download(file.path.split("/").pop() ?? file.path, file.content, file.mimeType)
                  }
                >
                  {file.path}
                </button>
              ))}
              <button
                type="button"
                className={actionButton}
                onClick={() =>
                  download(projectZipFilename(design), designProjectZip(design), "application/zip")
                }
              >
                Project ZIP
              </button>
            </div>
            <pre className="max-h-[60vh] overflow-auto rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-3 font-mono text-xs text-[var(--ink)]">
              {designJson}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}
