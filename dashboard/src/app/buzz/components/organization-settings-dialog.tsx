"use client";

// The organization's own settings: its picture and its name.
//
// Both are shared state. For an organization on Crumbs the server writes them
// as an admin-signed record that every member's machine reads, so the picture
// chosen here is the one everyone sees on their rail. The picture is shrunk to
// a small square in the browser first: it travels inside an encrypted message,
// and a rail tile never shows more than 44 pixels of it anyway.

import { useRef, useState, type FormEvent } from "react";
import { ImagePlus, Trash2 } from "lucide-react";

import { Button } from "@/app/buzz/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/buzz/ui/dialog";
import { Input } from "@/app/buzz/ui/input";
import type { BuzzCommunity } from "../types.ts";

const SIZE = 128;
const MAX_LENGTH = 60_000;

/** A centred square crop of the file, as a small WebP (or JPEG) data URL. */
async function squareDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("That file is not a picture this app can read."));
      element.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This window cannot draw pictures.");
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, SIZE, SIZE);
    for (const quality of [0.9, 0.75, 0.6, 0.45]) {
      let data = canvas.toDataURL("image/webp", quality);
      if (!data.startsWith("data:image/webp")) data = canvas.toDataURL("image/jpeg", quality);
      if (data.length <= MAX_LENGTH) return data;
    }
    throw new Error("That picture is too detailed to share. Try a simpler one.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function OrganizationSettingsDialog({
  open,
  community,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  community: BuzzCommunity | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void | Promise<unknown>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-3">
        {open && community ? (
          <SettingsForm community={community} onCancel={() => onOpenChange(false)} onSaved={async () => { await onSaved(); onOpenChange(false); }} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SettingsForm({
  community,
  onCancel,
  onSaved,
}: {
  community: BuzzCommunity;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(community.name);
  const [image, setImage] = useState<string | null>(community.image ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const changed = name.trim() !== community.name || image !== (community.image ?? null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try { setImage(await squareDataUrl(file)); }
    catch (problem) { setError(problem instanceof Error ? problem.message : "That picture could not be used."); }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!changed || busy || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/organizations/${community.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(name.trim() !== community.name ? { name: name.trim() } : {}), image }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error || "The settings could not be saved.");
      await onSaved();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "The settings could not be saved.");
      setBusy(false);
    }
  };

  const letters = name.trim().split(/\s+/).filter(Boolean);
  const initials = letters.length > 1 ? (letters[0][0] + letters[1][0]).toUpperCase() : (letters[0] ?? "?").slice(0, 2).toUpperCase();

  return (
    <>
      <DialogHeader>
        <DialogTitle>Organization settings</DialogTitle>
        <DialogDescription>
          Everyone in {community.name} sees the picture and name you set here.
        </DialogDescription>
      </DialogHeader>

      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <div className="flex items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-sidebar-accent text-lg font-semibold text-sidebar-accent-foreground">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element -- a data URL made in this dialog
              <img src={image} alt="Organization picture" className="size-full object-cover" />
            ) : initials}
          </span>
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden
              onChange={(event) => { void pick(event.target.files?.[0]); event.target.value = ""; }} />
            <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
              <ImagePlus className="size-4" /> {image ? "Change picture" : "Add picture"}
            </Button>
            {image ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setImage(null)} disabled={busy}>
                <Trash2 className="size-4" /> Remove
              </Button>
            ) : null}
          </div>
        </div>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Name</span>
          <Input maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
        </label>

        {error ? (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button onClick={onCancel} type="button" variant="ghost">Cancel</Button>
          <Button disabled={busy || !changed || !name.trim()} type="submit">{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </form>
    </>
  );
}
