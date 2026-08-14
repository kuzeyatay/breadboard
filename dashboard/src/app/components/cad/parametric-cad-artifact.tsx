"use client";

// The parametric CAD artifact.
//
// Everything on this page comes out of the stored manifest, which is the
// artifact's own source: the specification, the CadQuery program, the measured
// geometry, the validation findings and the revision history. The only thing
// fetched separately is the GLB the viewer draws, through Breadboard's
// authenticated CAD download route.
//
// The renderer has no filesystem access, no service address and no credential.
// A parameter edit posts to an authenticated server action, which rebuilds
// through the CAD service and publishes a new revision — no CAD code runs in
// the browser.

import { useCallback, useMemo, useRef, useState } from "react";
import ModelViewer, { type ModelViewerHandle, type StandardView } from "./model-viewer";
import type {
  CADFileReference,
  CADValidationIssue,
  ParametricCADArtifact,
} from "@/lib/cad/types";

const STANDARD_VIEWS: Array<{ id: StandardView; label: string }> = [
  { id: "isometric", label: "Iso" },
  { id: "front", label: "Front" },
  { id: "rear", label: "Rear" },
  { id: "left", label: "Left" },
  { id: "right", label: "Right" },
  { id: "top", label: "Top" },
  { id: "bottom", label: "Bottom" },
];

const FORMAT_LABELS: Record<string, string> = {
  step: "STEP · editable CAD",
  stl: "STL · for slicing",
  glb: "GLB · 3D preview",
  "3mf": "3MF · for slicing",
  sldprt: "SLDPRT · native SolidWorks part",
  source: "CadQuery source",
  operations: "SolidWorks operations",
  spec: "Design specification",
  report: "Validation report",
};

function fileUrl(file: CADFileReference): string {
  return `/api/cad/projects/${encodeURIComponent(file.projectId)}/files/${file.revision}/${file.format}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function statusTone(status: ParametricCADArtifact["status"]): {
  label: string;
  className: string;
} {
  if (status === "valid") {
    return { label: "Geometry checks passed", className: "text-[var(--botanical)]" };
  }
  if (status === "valid-with-warnings") {
    return { label: "Geometry passed with warnings", className: "text-[var(--selection-yellow-line)]" };
  }
  if (status === "invalid") return { label: "Geometry checks failed", className: "text-[var(--danger)]" };
  return { label: "Draft", className: "text-[var(--ink-muted)]" };
}

const panel =
  "rounded-xl border border-[var(--line)] bg-[var(--paper-raised)] p-4";
const label = "text-[11px] font-medium uppercase tracking-wide text-[var(--ink-muted)]";
const toggle =
  "neu-button rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] px-2.5 py-1 text-xs font-medium text-[var(--ink-heading)] transition-colors hover:bg-[var(--paper-raised)]";
const toggleOn =
  "neu-button rounded-lg border border-[var(--botanical)] bg-[color-mix(in_srgb,var(--botanical)_16%,transparent)] px-2.5 py-1 text-xs font-medium text-[var(--ink-heading)]";

type CadPanel = "assembly" | "parameters" | "validation" | "exports" | "source" | "history";

const CAD_PANEL_IDS: Record<CadPanel, string> = {
  assembly: "cad-assembly-panel",
  parameters: "cad-parameters-panel",
  validation: "cad-validation-panel",
  exports: "cad-exports-panel",
  source: "cad-source-panel",
  history: "cad-history-panel",
};

export default function ParametricCadArtifact({
  design,
  conversationId,
  initialPanel = "assembly",
  onRevised,
}: {
  design: ParametricCADArtifact;
  /** Needed to publish a new artifact version when a parameter changes. */
  conversationId?: string;
  /**
   * Which panel opens first. Lets a caller point straight at the findings.
   * Assembly leads by default — a reader opening a design first needs to know
   * which body is which and what goes where, not the parameter values.
   */
  initialPanel?: CadPanel;
  onRevised?: () => void;
}) {
  const viewer = useRef<ModelViewerHandle | null>(null);
  const [wireframe, setWireframe] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [showBox, setShowBox] = useState(false);
  const [projection, setProjection] = useState<"perspective" | "orthographic">("perspective");
  const assembly = design.designSpec.assembly ?? null;
  const [tab, setTab] = useState<CadPanel | null>(
    initialPanel === "assembly" && !assembly ? "parameters" : initialPanel,
  );
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  const measurements = design.measurements;
  const tone = statusTone(design.status);
  const preview = design.previewFile;
  const errors = design.validation.issues.filter((issue) => issue.severity === "error");
  const warnings = design.validation.issues.filter((issue) => issue.severity === "warning");
  const notes = design.validation.issues.filter((issue) => issue.severity === "info");
  const editable = design.designSpec.parameters.filter((parameter) => parameter.editable);
  const printed = design.designSpec.components.filter(
    (component) => component.bodyRole !== "reference",
  );
  const bought = design.designSpec.components.filter(
    (component) => component.bodyRole === "reference",
  );
  const bedFit = useMemo(() => {
    const bed = design.designSpec.printerBed;
    if (!bed) return null;
    const box = measurements.boundingBox;
    const fits = box.x <= bed.x && box.y <= bed.y && box.z <= bed.z;
    return { bed, fits };
  }, [design.designSpec.printerBed, measurements.boundingBox]);

  const submitParameters = useCallback(async () => {
    if (!conversationId) {
      setSaveMessage("Open this design from its conversation to change parameters.");
      return;
    }
    const changed: Record<string, number | string | boolean> = {};
    for (const parameter of editable) {
      const raw = edits[parameter.id];
      if (raw === undefined) continue;
      if (typeof parameter.value === "number") {
        const value = Number(raw);
        if (!Number.isFinite(value)) {
          setSaveMessage(`"${parameter.label}" must be a number.`);
          return;
        }
        if (value !== parameter.value) changed[parameter.id] = value;
      } else if (typeof parameter.value === "boolean") {
        const value = raw === "true";
        if (value !== parameter.value) changed[parameter.id] = value;
      } else if (raw !== parameter.value) {
        changed[parameter.id] = raw;
      }
    }
    if (!Object.keys(changed).length) {
      setSaveMessage("Nothing changed.");
      return;
    }

    setSaving(true);
    setSaveMessage("Rebuilding and re-validating…");
    try {
      const response = await fetch(
        `/api/cad/projects/${encodeURIComponent(design.projectId)}/parameters`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversationId, parameters: changed }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        revision?: number;
        status?: string;
        error?: string;
        message?: string;
      };
      if (!response.ok || !body.ok) {
        setSaveMessage(body.message ?? body.error ?? "The parameter change could not be built.");
        return;
      }
      setSaveMessage(
        `Revision ${body.revision} built (${body.status}). The previous revision is still available.`,
      );
      setEdits({});
      onRevised?.();
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "The parameter change failed.");
    } finally {
      setSaving(false);
    }
  }, [conversationId, design.projectId, edits, editable, onRevised]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-[var(--ink-heading)]">
            {design.title}
          </h2>
          <p className="text-xs text-[var(--ink-muted)]">
            Revision {design.revision} · {measurements.boundingBox.x.toFixed(1)} ×{" "}
            {measurements.boundingBox.y.toFixed(1)} × {measurements.boundingBox.z.toFixed(1)}{" "}
            {measurements.boundingBox.unit} ·{" "}
            {measurements.solidCount} {measurements.solidCount === 1 ? "body" : "bodies"}
          </p>
        </div>
        <p className={`text-xs font-medium ${tone.className}`}>{tone.label}</p>
      </header>

      {design.designSpec.description ? (
        <p className="text-sm leading-relaxed text-[var(--ink)]">
          {design.designSpec.description}
        </p>
      ) : null}

      {templateBuilt(design) ? (
        <p className="rounded-lg border border-[var(--selection-yellow-line)] bg-[var(--paper-strong)] p-3 text-xs leading-relaxed text-[var(--ink)]">
          This geometry came from Breadboard&rsquo;s built-in recovery template for this kind of
          product, not from the model&rsquo;s own program: the model-written build did not complete.
          It is a real kernel-built, measured part, but its shape is generic to the template rather
          than reasoned from the brief. Ask for a change to have the model rewrite it.
        </p>
      ) : null}

      {/* ---- interactive preview ------------------------------------- */}
      <section className="min-h-[320px] flex-1 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--paper-strong)]">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--line)] px-3 py-2">
          {STANDARD_VIEWS.map((view) => (
            <button
              key={view.id}
              type="button"
              className={toggle}
              onClick={() => viewer.current?.setView(view.id)}
            >
              {view.label}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-[var(--line)]" aria-hidden />
          <button type="button" className={toggle} onClick={() => viewer.current?.resetView()}>
            Reset view
          </button>
          <button
            type="button"
            className={projection === "orthographic" ? toggleOn : toggle}
            onClick={() =>
              setProjection((current) =>
                current === "perspective" ? "orthographic" : "perspective",
              )
            }
          >
            {projection === "orthographic" ? "Orthographic" : "Perspective"}
          </button>
          <button
            type="button"
            className={wireframe ? toggleOn : toggle}
            onClick={() => setWireframe((current) => !current)}
          >
            Wireframe
          </button>
          <button
            type="button"
            className={showGrid ? toggleOn : toggle}
            onClick={() => setShowGrid((current) => !current)}
          >
            Grid
          </button>
          <button
            type="button"
            className={showBox ? toggleOn : toggle}
            onClick={() => setShowBox((current) => !current)}
          >
            Bounding box
          </button>
        </div>
        <div className="h-[min(58vh,520px)] min-h-[280px] w-full">
          {preview ? (
            <ModelViewer
              source={fileUrl(preview)}
              handleRef={viewer}
              wireframe={wireframe}
              showGrid={showGrid}
              showBoundingBox={showBox}
              projection={projection}
              extent={measurements.boundingBox}
            />
          ) : (
            <p className="flex h-full items-center justify-center px-6 text-center text-sm text-[var(--ink-muted)]">
              This revision has no 3D preview file.
            </p>
          )}
        </div>
      </section>

      {/* ---- panels --------------------------------------------------- */}
      <nav className="flex flex-wrap gap-1.5">
        {(
          [
            ...(assembly ? ([["assembly", "Assembly"]] as const) : []),
            ["parameters", `Parameters (${editable.length})`],
            ["validation", `Validation (${errors.length + warnings.length})`],
            ["exports", `Exports (${design.exports.length})`],
            ["source", "Source"],
            ["history", `Revisions (${design.revisionHistory.length})`],
          ] as const
        ).map(([id, text]) => (
          <button
            key={id}
            id={`cad-${id}-trigger`}
            type="button"
            className={tab === id ? toggleOn : toggle}
            aria-expanded={tab === id}
            aria-controls={CAD_PANEL_IDS[id]}
            onClick={() => setTab((current) => (current === id ? null : id))}
          >
            {text}
          </button>
        ))}
      </nav>

      {tab === "assembly" && assembly ? (
        <section
          id={CAD_PANEL_IDS.assembly}
          aria-labelledby="cad-assembly-trigger"
          className={`${panel} space-y-4`}
        >
          {assembly.overview ? (
            <p className="text-sm leading-relaxed text-[var(--ink)]">{assembly.overview}</p>
          ) : null}

          {printed.length ? (
            <div>
              <p className={label}>Printed parts</p>
              <ul className="mt-1.5 space-y-1">
                {printed.map((component) => {
                  const measured = bodyExtent(design, component.id, component.name);
                  return (
                    <li
                      key={component.id}
                      className="flex flex-wrap items-baseline gap-x-3 text-xs text-[var(--ink)]"
                    >
                      <span className="font-medium text-[var(--ink-heading)]">
                        {component.quantity > 1 ? `${component.quantity} × ` : ""}
                        {component.name}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--ink-muted)]">
                        {component.id}
                      </span>
                      {measured ? (
                        <span className="text-[var(--ink-muted)]">
                          {measured.x.toFixed(1)} × {measured.y.toFixed(1)} ×{" "}
                          {measured.z.toFixed(1)} mm
                        </span>
                      ) : null}
                      {component.material ? (
                        <span className="text-[var(--ink-muted)]">{component.material}</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {assembly.hardware.length ? (
            <div>
              <p className={label}>Hardware to supply</p>
              <ul className="mt-1.5 space-y-1">
                {assembly.hardware.map((item) => (
                  <li key={item.id} className="text-xs leading-relaxed text-[var(--ink)]">
                    <span className="font-medium text-[var(--ink-heading)]">
                      {item.quantity} × {item.name}
                    </span>
                    {item.purpose ? (
                      <span className="text-[var(--ink-muted)]"> — {item.purpose}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {bought.length ? (
            <div>
              <p className={label}>Parts this design makes room for</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--ink-muted)]">
                Reference envelopes. They are not printed and not included; the geometry reserves
                their space, so measure the ones you actually buy.
              </p>
              <ul className="mt-1.5 space-y-1">
                {bought.map((component) => (
                  <li
                    key={component.id}
                    className="flex flex-wrap items-baseline gap-x-3 text-xs text-[var(--ink)]"
                  >
                    <span>
                      {component.quantity > 1 ? `${component.quantity} × ` : ""}
                      {component.name}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--ink-muted)]">
                      {component.id}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {assembly.steps.length ? (
            <div>
              <p className={label}>Assembly order</p>
              <ol className="mt-1.5 space-y-2">
                {[...assembly.steps]
                  .sort((left, right) => left.order - right.order)
                  .map((step) => (
                    <li
                      key={`${step.order}-${step.summary}`}
                      className="rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] p-2.5"
                    >
                      <p className="text-xs font-medium text-[var(--ink-heading)]">
                        {step.order}. {step.summary}
                      </p>
                      {step.detail ? (
                        <p className="mt-0.5 text-xs leading-relaxed text-[var(--ink)]">
                          {step.detail}
                        </p>
                      ) : null}
                      {step.parts.length || step.hardware?.length ? (
                        <p className="mt-1 text-[11px] leading-snug text-[var(--ink-muted)]">
                          {[
                            ...step.parts.map((id) => partLabel(design, id)),
                            ...(step.hardware ?? []).map((id) => hardwareLabel(assembly, id)),
                          ].join(" · ")}
                        </p>
                      ) : null}
                    </li>
                  ))}
              </ol>
            </div>
          ) : null}

          {assembly.notes?.length ? (
            <div>
              <p className={label}>Before you build it</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs leading-relaxed text-[var(--ink)]">
                {assembly.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "parameters" ? (
        <section
          id={CAD_PANEL_IDS.parameters}
          aria-labelledby="cad-parameters-trigger"
          className={panel}
        >
          <p className={label}>Named parameters</p>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            Changing a value rebuilds the design through the local CAD service and creates a new
            revision. Earlier revisions stay available.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {design.designSpec.parameters.map((parameter) => {
              const current = edits[parameter.id] ?? String(parameter.value);
              return (
                <label
                  key={parameter.id}
                  className="flex flex-col gap-1 rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] p-2.5"
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-xs font-medium text-[var(--ink-heading)]">
                      {parameter.label}
                    </span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">
                      {parameter.source}
                    </span>
                  </span>
                  {typeof parameter.value === "boolean" ? (
                    <select
                      className="rounded border border-[var(--line)] bg-[var(--paper-raised)] px-2 py-1 text-sm text-[var(--ink)]"
                      value={current}
                      disabled={!parameter.editable || saving}
                      onChange={(event) =>
                        setEdits((state) => ({ ...state, [parameter.id]: event.target.value }))
                      }
                    >
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : (
                    <input
                      className="rounded border border-[var(--line)] bg-[var(--paper-raised)] px-2 py-1 text-sm text-[var(--ink)] disabled:opacity-60"
                      type={typeof parameter.value === "number" ? "number" : "text"}
                      step="any"
                      {...(parameter.minimum === undefined ? {} : { min: parameter.minimum })}
                      {...(parameter.maximum === undefined ? {} : { max: parameter.maximum })}
                      value={current}
                      disabled={!parameter.editable || saving}
                      onChange={(event) =>
                        setEdits((state) => ({ ...state, [parameter.id]: event.target.value }))
                      }
                    />
                  )}
                  <span className="text-[11px] leading-snug text-[var(--ink-muted)]">
                    {parameter.unit ? `${parameter.unit}. ` : ""}
                    {parameter.description ?? ""}
                    {parameter.minimum !== undefined || parameter.maximum !== undefined
                      ? ` Range ${parameter.minimum ?? "−∞"}–${parameter.maximum ?? "∞"}.`
                      : ""}
                  </span>
                </label>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className={toggleOn}
              disabled={saving || !conversationId}
              onClick={() => void submitParameters()}
            >
              {saving ? "Rebuilding…" : "Rebuild with these values"}
            </button>
            {saveMessage ? (
              <span className="text-xs text-[var(--ink-muted)]">{saveMessage}</span>
            ) : null}
          </div>
        </section>
      ) : null}

      {tab === "validation" ? (
        <section
          id={CAD_PANEL_IDS.validation}
          aria-labelledby="cad-validation-trigger"
          className={`${panel} space-y-3`}
        >
          <p className="rounded-lg border border-[var(--line)] bg-[var(--paper-raised)] p-2.5 text-xs leading-5 text-[var(--ink-muted)]">
            Geometry checks cover solid topology, measured size, and declared manufacturing limits.
            They do not by themselves prove assembly fit, strength, ergonomics, optical performance,
            or product safety.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Measurement label="Bounding box">
              {measurements.boundingBox.x.toFixed(2)} × {measurements.boundingBox.y.toFixed(2)} ×{" "}
              {measurements.boundingBox.z.toFixed(2)} {measurements.boundingBox.unit}
            </Measurement>
            <Measurement label="Solids">{measurements.solidCount}</Measurement>
            <Measurement label="Volume">
              {measurements.volume === undefined
                ? "—"
                : `${(measurements.volume / 1000).toFixed(2)} cm³`}
            </Measurement>
            <Measurement label="Surface area">
              {measurements.surfaceArea === undefined
                ? "—"
                : `${(measurements.surfaceArea / 100).toFixed(2)} cm²`}
            </Measurement>
            <Measurement label="Triangles">{measurements.triangleCount ?? "—"}</Measurement>
            <Measurement label="Print bed">
              {bedFit
                ? `${bedFit.fits ? "Fits" : "Too large for"} ${bedFit.bed.x}×${bedFit.bed.y}×${bedFit.bed.z} mm`
                : "Not configured"}
            </Measurement>
            <Measurement label="STL tolerance">
              {design.designSpec.exportSettings.stlLinearTolerance} mm /{" "}
              {design.designSpec.exportSettings.stlAngularTolerance} rad
            </Measurement>
            <Measurement label="Checked">
              {new Date(design.validation.checkedAt).toLocaleString()}
            </Measurement>
          </div>

          {measurements.bodies.length ? (
            <div>
              <p className={label}>Bodies</p>
              <ul className="mt-1.5 space-y-1">
                {measurements.bodies.map((body) => (
                  <li
                    key={body.name}
                    className="flex flex-wrap items-baseline gap-x-3 text-xs text-[var(--ink)]"
                  >
                    <span className="font-medium text-[var(--ink-heading)]">{body.name}</span>
                    <span className="text-[var(--ink-muted)]">
                      {body.boundingBox.x.toFixed(2)} × {body.boundingBox.y.toFixed(2)} ×{" "}
                      {body.boundingBox.z.toFixed(2)} mm
                    </span>
                    <span className={body.valid ? "text-[var(--botanical)]" : "text-[var(--danger)]"}>
                      {body.valid ? "valid shape" : "invalid shape"}
                    </span>
                    <span
                      className={body.watertight ? "text-[var(--botanical)]" : "text-[var(--danger)]"}
                    >
                      {body.watertight ? "watertight" : "not watertight"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <IssueList title="Errors" issues={errors} tone="text-[var(--danger)]" />
          <IssueList
            title="Warnings"
            issues={warnings}
            tone="text-[var(--selection-yellow-line)]"
          />
          <IssueList title="Notes" issues={notes} tone="text-[var(--ink-muted)]" />

          {design.assumptions.length ? (
            <div>
              <p className={label}>Assumptions</p>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-[var(--ink)]">
                {design.assumptions.map((assumption) => (
                  <li key={assumption}>{assumption}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {design.disclaimers.map((disclaimer) => (
            <p
              key={disclaimer}
              className="rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] p-3 text-xs leading-relaxed text-[var(--ink-muted)]"
            >
              {disclaimer}
            </p>
          ))}
        </section>
      ) : null}

      {tab === "exports" ? (
        <section
          id={CAD_PANEL_IDS.exports}
          aria-labelledby="cad-exports-trigger"
          className={panel}
        >
          <p className={label}>Downloads</p>
          <ul className="mt-2 divide-y divide-[var(--line)]">
            {design.exports.map((file) => (
              <li key={file.format} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <a
                  href={fileUrl(file)}
                  download={file.filename}
                  className="text-sm font-medium text-[var(--botanical)] underline-offset-2 hover:underline"
                >
                  {FORMAT_LABELS[file.format] ?? file.format.toUpperCase()}
                </a>
                <span className="text-xs text-[var(--ink-muted)]">{file.filename}</span>
                <span className="text-xs text-[var(--ink-muted)]">{formatBytes(file.byteSize)}</span>
                {file.linearTolerance ? (
                  <span className="text-xs text-[var(--ink-muted)]">
                    {file.linearTolerance} mm / {file.angularTolerance} rad
                  </span>
                ) : null}
                <span className="font-mono text-[10px] text-[var(--ink-muted)]">
                  {file.sha256.slice(0, 12)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-[var(--ink-muted)]">
            STEP is the editable engineering model — open it in any CAD program and keep the exact
            surfaces. STL and 3MF are triangle meshes derived from that solid at the tolerances
            shown; they are what a slicer reads, and they cannot be edited back into a parametric
            design.
          </p>
        </section>
      ) : null}

      {tab === "source" ? (
        <section
          id={CAD_PANEL_IDS.source}
          aria-labelledby="cad-source-trigger"
          className={panel}
        >
          <p className={label}>
            {/* A SolidWorks design is an operation program, not a Python one,
                and it has no entrypoint to call. */}
            {design.provenance.engine === "solidworks"
              ? "SolidWorks operation program"
              : `CadQuery program · ${design.entrypoint}(params)`}{" "}
            · {design.provenance.engine} {design.provenance.engineVersion} on OpenCascade{" "}
            {design.provenance.kernelVersion}
          </p>
          <pre className="mt-2 max-h-[420px] overflow-auto whitespace-pre rounded-lg bg-[var(--paper-strong)] p-3 text-xs leading-relaxed text-[var(--ink)]">
            {design.source}
          </pre>
          {design.generationLog.length ? (
            <>
              <p className={`${label} mt-3`}>Generation log</p>
              <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-[var(--ink-muted)]">
                {design.generationLog.map((entry, index) => (
                  <li key={`${entry.stage}-${index}`}>
                    {entry.stage}: {entry.detail}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}

      {tab === "history" ? (
        <section
          id={CAD_PANEL_IDS.history}
          aria-labelledby="cad-history-trigger"
          className={panel}
        >
          <p className={label}>Revisions</p>
          <ul className="mt-2 divide-y divide-[var(--line)]">
            {[...design.revisionHistory].reverse().map((entry) => (
              <li key={entry.revision} className="py-2">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-sm font-medium text-[var(--ink-heading)]">
                    Revision {entry.revision}
                    {entry.revision === design.revision ? " · current" : ""}
                  </span>
                  <span
                    className={
                      entry.validationPassed
                        ? "text-xs text-[var(--botanical)]"
                        : "text-xs text-[var(--danger)]"
                    }
                  >
                    {entry.status}
                  </span>
                  <span className="text-xs text-[var(--ink-muted)]">
                    {new Date(entry.createdAt).toLocaleString()}
                  </span>
                  {entry.boundingBox ? (
                    <span className="text-xs text-[var(--ink-muted)]">
                      {entry.boundingBox.x.toFixed(1)} × {entry.boundingBox.y.toFixed(1)} ×{" "}
                      {entry.boundingBox.z.toFixed(1)} mm
                    </span>
                  ) : null}
                </div>
                {entry.instruction ? (
                  <p className="mt-0.5 text-xs text-[var(--ink)]">{entry.instruction}</p>
                ) : null}
                {entry.parameterDiff.length ? (
                  <p className="mt-0.5 font-mono text-[11px] text-[var(--ink-muted)]">
                    {entry.parameterDiff
                      .map((change) => `${change.id}: ${String(change.from)} → ${String(change.to)}`)
                      .join("  ·  ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** Legacy provenance reader for artifacts saved before canned CAD was removed. */
function templateBuilt(design: ParametricCADArtifact): boolean {
  if (design.provenance.geometryAuthor) {
    return design.provenance.geometryAuthor === "deterministic-template";
  }
  return /deterministic fallback/i.test(design.provenance.model);
}

/** The kernel's measurement of one named body, matched to its component. */
function bodyExtent(
  design: ParametricCADArtifact,
  id: string,
  name: string,
): { x: number; y: number; z: number } | null {
  const wanted = [id, name].map(normalizeName);
  const body = design.measurements.bodies.find((candidate) =>
    wanted.includes(normalizeName(candidate.name)),
  );
  return body ? body.boundingBox : null;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** A step names parts by component id; show the reader the part's name. */
function partLabel(design: ParametricCADArtifact, id: string): string {
  const component = design.designSpec.components.find((candidate) => candidate.id === id);
  return component ? component.name : id;
}

function hardwareLabel(
  assembly: NonNullable<ParametricCADArtifact["designSpec"]["assembly"]>,
  id: string,
): string {
  const item = assembly.hardware.find((candidate) => candidate.id === id);
  return item ? `${item.quantity} × ${item.name}` : id;
}

function Measurement({ label: text, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className={label}>{text}</p>
      <p className="text-sm font-medium text-[var(--ink-heading)]">{children}</p>
    </div>
  );
}

function IssueList({
  title,
  issues,
  tone,
}: {
  title: string;
  issues: CADValidationIssue[];
  tone: string;
}) {
  if (!issues.length) return null;
  return (
    <div>
      <p className={label}>
        {title} ({issues.length})
      </p>
      <ul className="mt-1.5 space-y-2">
        {issues.map((issue, index) => (
          <li
            key={`${issue.code}-${index}`}
            className="rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] p-2.5"
          >
            <p className={`text-xs font-medium ${tone}`}>{issue.code}</p>
            <p className="text-xs leading-relaxed text-[var(--ink)]">{issue.message}</p>
            {issue.expected !== undefined || issue.actual !== undefined ? (
              <p className="mt-0.5 font-mono text-[11px] text-[var(--ink-muted)]">
                expected {String(issue.expected ?? "—")} · actual {String(issue.actual ?? "—")}
              </p>
            ) : null}
            {issue.repairHint ? (
              <p className="mt-0.5 text-xs text-[var(--botanical)]">{issue.repairHint}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
