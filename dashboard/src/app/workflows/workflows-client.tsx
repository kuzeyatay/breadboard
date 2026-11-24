"use client";

// One workflow, opened from Spaces (where every workflow is listed, beside the
// documents, designs and videos). `?workflow=<id>` opens it: the canvas for a
// built workflow, the replay view for one taught by demonstration. `?teach=1`
// opens the teaching flow. Both sit under the Spaces header with Bread in the
// corner; "Spaces" in the breadcrumb is the way back. The `workflow` query
// param stays the identifier because chat links and
// use-workflow-automation.ts's "Open automation settings" links use it.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import BreadboardLoader from "@/app/components/breadboard-loader";
import { startNavigationProgress } from "@/app/components/navigation-progress";
import SpacesShell, { type SpacesGarden } from "@/app/spaces/spaces-shell";
import { readTeachSetupDraft } from "@/lib/teach/setup-draft";
import { CanvasEditor } from "./components/canvas-editor";
import DemonstratedWorkflow from "./teach/demonstrated-workflow";
import TeachWorkflow from "./teach/teach-workflow";
import "./sim-canvas.css";
import type { WorkflowStateJson } from "./lib/types";

type WorkflowDetail = {
  id: string;
  name: string;
  description?: string | null;
  state: WorkflowStateJson | null;
  source?: "canvas" | "demonstration";
};

export default function WorkflowsClient({
  workflowId,
  clapReview = false,
  teachOnOpen = false,
  initialRunId = null,
  showNavbarFlowers,
  garden,
}: {
  workflowId: string | null;
  clapReview?: boolean;
  teachOnOpen?: boolean;
  initialRunId?: string | null;
  showNavbarFlowers: boolean;
  garden: SpacesGarden | null;
}) {
  const router = useRouter();
  const [activeId, setActiveId] = useState<string | null>(workflowId);
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Non-null while the teaching flow is open. A re-teach carries the workflow it
  // is correcting, so the second demonstration becomes a version of that
  // workflow rather than a new one beside it.
  const [teaching, setTeaching] = useState<{ workflowId: string | null; name?: string } | null>(
    teachOnOpen ? { workflowId: null } : null,
  );

  useEffect(() => {
    setActiveId(workflowId);
  }, [workflowId]);

  useEffect(() => {
    if (!teachOnOpen || workflowId) return;
    // A setup draft restores the panel that held it, re-teach included.
    const draft = readTeachSetupDraft(window.localStorage);
    setTeaching(draft ? { workflowId: draft.reteachWorkflowId, name: draft.reteachName } : { workflowId: null });
  }, [teachOnOpen, workflowId]);

  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    setDetail(null);
    setDetailError(null);
    fetch(`/api/workflows/${encodeURIComponent(activeId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as Partial<WorkflowDetail> & { error?: string };
        if (!response.ok || !payload.id) throw new Error(payload.error || "This workflow could not be opened.");
        setDetail({
          id: payload.id,
          name: payload.name ?? "Untitled workflow",
          description: payload.description ?? "",
          state: payload.state ?? null,
          source: payload.source ?? "canvas",
        });
      })
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setDetailError(cause instanceof Error ? cause.message : "This workflow could not be opened.");
      });
    return () => controller.abort();
  }, [activeId, attempt]);

  const openWorkflow = useCallback(
    (id: string) => {
      setActiveId(id);
      router.replace(`/workflows?workflow=${encodeURIComponent(id)}`, { scroll: false });
    },
    [router],
  );

  /** Every workflow lives in Spaces; leaving one goes back there. */
  const backToSpaces = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    startNavigationProgress();
    router.push("/spaces");
  }, [router]);

  const notice = clapReview && activeId ? (
    <p role="status" className="border-b border-[var(--line)] bg-[var(--paper-surface)] px-5 py-3 text-sm text-[var(--ink)]">
      Clap controls selected this workflow. Review its steps and required inputs, then press Run to confirm. Nothing has run yet.
    </p>
  ) : null;

  // The canvas renders its own Spaces header: its name field and save state live there.
  if (!teaching && activeId && detail && detail.id === activeId && detail.source !== "demonstration") {
    return (
      <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-[var(--paper-bg)] text-[var(--ink)]">
        <CanvasEditor
          workflowId={detail.id}
          initialName={detail.name}
          initialDescription={detail.description ?? ""}
          initialState={detail.state}
          showFlowers={showNavbarFlowers}
          garden={garden}
          notice={notice}
        />
      </div>
    );
  }

  const title = teaching ? (teaching.name ? `Re-teach ${teaching.name}` : "Teach a workflow") : detail?.name ?? "";

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-[var(--paper-bg)] text-[var(--ink)]">
      <SpacesShell
        showFlowers={showNavbarFlowers}
        garden={garden}
        pageKey={activeId ? `workflow:${activeId}` : "workflow:teach"}
        trail={["Workflows", title]}
      >
        {notice}
        {teaching ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
            <TeachWorkflow
              reteachWorkflowId={teaching.workflowId}
              reteachName={teaching.name}
              onSaved={(savedId) => {
                setTeaching(null);
                openWorkflow(savedId);
              }}
              onClose={() => {
                setTeaching(null);
                if (!activeId) backToSpaces();
              }}
            />
          </div>
        ) : detailError ? (
          <p role="alert" className="m-6 rounded-xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]">
            {detailError}
            <button type="button" onClick={() => setAttempt((count) => count + 1)} className="ml-2 underline underline-offset-2">
              Try again
            </button>
          </p>
        ) : detail && detail.id === activeId ? (
          <DemonstratedWorkflow
            workflowId={detail.id}
            initialRunId={initialRunId}
            onBack={backToSpaces}
            onReteach={() => setTeaching({ workflowId: detail.id, name: detail.name })}
            onDelete={async () => {
              await fetch(`/api/workflows/${encodeURIComponent(detail.id)}`, { method: "DELETE" }).catch(
                () => undefined,
              );
              backToSpaces();
            }}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <BreadboardLoader className="h-5 w-5 text-[var(--botanical)]" />
          </div>
        )}
      </SpacesShell>
    </div>
  );
}
