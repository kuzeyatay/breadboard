"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { notifyPlanChanged, subscribePlanChanges } from "@/lib/plan/client-sync";
import type { PlanBoard, PlanColumn, PlanProjectSummary, PlanTask, UpdateTaskInput } from "@/lib/plan/types";

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Couldn’t save changes.");
  return body as T;
}

export function useNotepadTasks(ownerKey: string) {
  const [projects, setProjects] = useState<PlanProjectSummary[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [columns, setColumns] = useState<PlanColumn[]>([]);
  const [tasks, setTasks] = useState<PlanTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; retry: () => void } | null>(null);
  const selection = useRef<number | null>(null);
  const request = useRef<AbortController | null>(null);
  const pending = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(false);
  const key = `breadboard:new-tab:notepad-project:${ownerKey}`;

  const refresh = useCallback(async () => {
    if (pending.current) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const options = { cache: "no-store" as const, signal: controller.signal };
    try {
      const { projects: nextProjects } = await readResponse<{ projects: PlanProjectSummary[] }>(await fetch("/api/plan/projects", options));
      const selected = nextProjects.find((project) => project.id === selection.current) ?? nextProjects[0];
      const board = selected ? (await readResponse<{ board: PlanBoard }>(await fetch(`/api/plan/projects/${selected.id}`, options))).board : null;
      if (controller.signal.aborted || !mounted.current) return;
      selection.current = selected?.id ?? null;
      setProjectId(selection.current);
      setProjects(nextProjects);
      setColumns(board?.columns ?? []);
      setTasks(board?.columns.flatMap((column) => column.tasks) ?? []);
      setError((current) => current?.retry === refresh ? null : current);
    } catch {
      if (controller.signal.aborted || !mounted.current) return;
      setError({ message: "Couldn’t load to-dos.", retry: refresh });
    } finally {
      if (!controller.signal.aborted && mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    try {
      const saved = Number(localStorage.getItem(key));
      if (Number.isInteger(saved) && saved > 0) selection.current = saved;
    } catch { /* Use the first project. */ }
    void refresh();
    const unsubscribe = subscribePlanChanges(() => void refresh());
    return () => { mounted.current = false; request.current?.abort(); unsubscribe(); };
  }, [key, refresh]);

  function selectProject(id: number) {
    selection.current = id;
    setProjectId(id);
    setTasks([]);
    setColumns([]);
    setLoading(true);
    setError(null);
    try { localStorage.setItem(key, String(id)); } catch { /* Session selection still works. */ }
    void refresh();
  }

  // Serialize a title's blur followed by a checkmark, and invalidate reads that
  // started before the edit. A refresh must never undo a just-saved change.
  function mutate(path: string, method: string, body: unknown, onSaved?: () => void): Promise<boolean> {
    request.current?.abort();
    pending.current += 1;
    setBusy(true);
    setError(null);
    const operation = queue.current.then(async () => {
      try {
        const { task } = await readResponse<{ task: PlanTask }>(await fetch(path, {
          method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        }));
        if (mounted.current && task.projectId === selection.current) {
          setTasks((current) => current.some((item) => item.id === task.id)
            ? current.map((item) => item.id === task.id ? task : item)
            : [...current, task]);
          onSaved?.();
        }
        notifyPlanChanged();
        return true;
      } catch (failure) {
        if (mounted.current) setError({
          message: failure instanceof Error ? failure.message : "Couldn’t save changes.",
          retry: () => { void mutate(path, method, body, onSaved); },
        });
        return false;
      } finally {
        pending.current -= 1;
        if (mounted.current) setBusy(pending.current > 0);
      }
    });
    queue.current = operation;
    return operation;
  }

  function updateTask(id: number, patch: UpdateTaskInput, onSaved?: () => void) {
    return mutate(`/api/plan/tasks/${id}`, "PATCH", patch, onSaved);
  }

  function addTask(title: string, dueDate: string, onSaved?: () => void) {
    const columnId = columns.find((column) => !column.isFinal)?.id;
    if (!projectId || !columnId) return Promise.resolve(false);
    return mutate("/api/plan/tasks", "POST", { projectId, columnId, title, dueDate }, onSaved);
  }

  return { projects, projectId, columns, tasks, loading, busy, error, selectProject, updateTask, addTask };
}
