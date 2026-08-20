"use client";

// Every place Buzz asks for a name.
//
// These exist because the page originally asked with `window.prompt`, and
// Electron does not implement it — the call throws `prompt() is and will not
// be supported`, so in the desktop shell "New room", "New community" and every
// rename were buttons that did nothing at all. Nothing about the browser is
// safe to assume here; a room is named in the app's own surface or not at all.

import { useState, type FormEvent, type ReactNode } from "react";
import { Hash, Lock } from "lucide-react";

import { cn } from "@/app/buzz/lib/cn";
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
import { Textarea } from "@/app/buzz/ui/textarea";
import type { BuzzRoomSummary, BuzzRoomVisibility } from "../types.ts";

/** The slug a name will become, shown while it is being typed. */
function previewSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug === "" ? "room" : slug;
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1 block text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </span>
  );
}

function VisibilityChoice({
  value,
  onChange,
}: {
  value: BuzzRoomVisibility;
  onChange: (next: BuzzRoomVisibility) => void;
}) {
  const options: Array<{
    value: BuzzRoomVisibility;
    icon: typeof Hash;
    label: string;
    hint: string;
  }> = [
    {
      value: "public",
      icon: Hash,
      label: "Open to the community",
      hint: "Anyone in this community can walk in.",
    },
    {
      value: "private",
      icon: Lock,
      label: "Invite only",
      hint: "Only people brought in can open it.",
    },
  ];

  return (
    <div className="flex flex-col gap-1.5">
      {options.map((option) => {
        const Icon = option.icon;
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cn(
              "flex items-start gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors",
              active
                ? "border-primary/60 bg-primary/10"
                : "border-border/60 hover:bg-muted/60",
            )}
          >
            <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block text-xs font-medium">{option.label}</span>
              <span className="block text-2xs text-muted-foreground">
                {option.hint}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export interface NewRoomValues {
  name: string;
  topic: string;
  visibility: BuzzRoomVisibility;
}

/*
 * Each dialog's form is a separate component, rendered only while the dialog
 * is open.
 *
 * That is what resets it. A dialog that stayed mounted would keep the last
 * abandoned draft in state and offer it back the next time it opened, as if it
 * were the new room's name — and clearing it in an effect would mean a second
 * render on every open just to blank three fields.
 */
export function NewRoomDialog({
  open,
  communityName,
  busy,
  error,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  communityName: string;
  busy: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: NewRoomValues) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-3">
        {open ? (
          <NewRoomForm
            busy={busy}
            communityName={communityName}
            error={error}
            onCancel={() => onOpenChange(false)}
            onSubmit={onSubmit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function NewRoomForm({
  communityName,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  communityName: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (values: NewRoomValues) => void;
}) {
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [visibility, setVisibility] = useState<BuzzRoomVisibility>("public");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() === "" || busy) return;
    onSubmit({ name: name.trim(), topic: topic.trim(), visibility });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>New room</DialogTitle>
        <DialogDescription>
          Rooms in {communityName} are shared: the people in them and their
          agents all read the same transcript.
        </DialogDescription>
      </DialogHeader>

      <form className="flex flex-col gap-3" onSubmit={submit}>
        <label className="block">
          <FieldLabel>Name</FieldLabel>
          <Input
            autoFocus
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder="product-launch"
            value={name}
          />
          <span className="mt-1 block text-3xs text-muted-foreground">
            Opens as #{previewSlug(name)}
          </span>
        </label>

        <label className="block">
          <FieldLabel>Topic (optional)</FieldLabel>
          <Textarea
            className="min-h-16"
            maxLength={280}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="What belongs in here."
            value={topic}
          />
        </label>

        <div>
          <FieldLabel>Who can open it</FieldLabel>
          <VisibilityChoice value={visibility} onChange={setVisibility} />
        </div>

        {error ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button onClick={onCancel} type="button" variant="ghost">
            Cancel
          </Button>
          <Button disabled={busy || name.trim() === ""} type="submit">
            {busy ? "Opening…" : "Open room"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

export function NewCommunityDialog({
  open,
  busy,
  error,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-3">
        {open ? (
          <NewCommunityForm
            busy={busy}
            error={error}
            onCancel={() => onOpenChange(false)}
            onSubmit={onSubmit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function NewCommunityForm({
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState("");

  return (
    <>
      <DialogHeader>
        <DialogTitle>New community</DialogTitle>
        <DialogDescription>
          A community is a Breadboard organization — the group its rooms and
          their people belong to. Its rooms open as soon as it exists.
        </DialogDescription>
      </DialogHeader>

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() === "" || busy) return;
          onSubmit(name.trim());
        }}
      >
        <label className="block">
          <FieldLabel>Name</FieldLabel>
          <Input
            autoFocus
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder="Honeycomb Studios"
            value={name}
          />
        </label>

        {error ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button onClick={onCancel} type="button" variant="ghost">
            Cancel
          </Button>
          <Button disabled={busy || name.trim() === ""} type="submit">
            {busy ? "Creating…" : "Create community"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

export interface RoomSettingsValues {
  name: string;
  topic: string;
  visibility: BuzzRoomVisibility;
}

export function RoomSettingsDialog({
  open,
  room,
  busy,
  error,
  onOpenChange,
  onSave,
  onArchive,
  onDelete,
}: {
  open: boolean;
  room: BuzzRoomSummary | null;
  busy: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onSave: (values: RoomSettingsValues) => void;
  onArchive: (archived: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-3">
        {open && room ? (
          // Keyed by room: switching rooms with the dialog open must reseed
          // the fields rather than leave the previous room's name in them.
          <RoomSettingsForm
            busy={busy}
            error={error}
            key={room.publicId}
            onArchive={onArchive}
            onDelete={onDelete}
            onSave={onSave}
            room={room}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RoomSettingsForm({
  room,
  busy,
  error,
  onSave,
  onArchive,
  onDelete,
}: {
  room: BuzzRoomSummary;
  busy: boolean;
  error: string | null;
  onSave: (values: RoomSettingsValues) => void;
  onArchive: (archived: boolean) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(room.name);
  const [topic, setTopic] = useState(room.topic);
  const [visibility, setVisibility] = useState<BuzzRoomVisibility>(
    room.visibility,
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Room settings</DialogTitle>
        <DialogDescription>
          #{room.slug} · {room.memberCount}{" "}
          {room.memberCount === 1 ? "member" : "members"}
        </DialogDescription>
      </DialogHeader>

      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim() === "" || busy) return;
          onSave({ name: name.trim(), topic: topic.trim(), visibility });
        }}
      >
        <label className="block">
          <FieldLabel>Name</FieldLabel>
          <Input
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>

        <label className="block">
          <FieldLabel>Topic</FieldLabel>
          <Textarea
            className="min-h-16"
            maxLength={280}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="What belongs in here."
            value={topic}
          />
        </label>

        <div>
          <FieldLabel>Who can open it</FieldLabel>
          <VisibilityChoice value={visibility} onChange={setVisibility} />
        </div>

        {error ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter className="sm:justify-between">
          <div className="flex items-center gap-1">
            <Button
              onClick={() => onArchive(!room.archived)}
              size="sm"
              type="button"
              variant="ghost"
            >
              {room.archived ? "Unarchive" : "Archive"}
            </Button>
            {/* Deleting takes the transcript with it, so the button asks
                  once. Two clicks, not a confirm() the shell may not have. */}
            <Button
              className={cn(
                confirmingDelete &&
                  "bg-destructive text-destructive-foreground hover:bg-destructive/90",
              )}
              onClick={() => {
                if (!confirmingDelete) {
                  setConfirmingDelete(true);
                  return;
                }
                onDelete();
              }}
              size="sm"
              type="button"
              variant={confirmingDelete ? "destructive" : "ghost"}
            >
              {confirmingDelete ? "Delete for everyone" : "Delete"}
            </Button>
          </div>
          <Button disabled={busy || name.trim() === ""} size="sm" type="submit">
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
