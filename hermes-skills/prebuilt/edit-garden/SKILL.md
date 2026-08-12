---
name: Edit Garden
description: Reorganize a Garden's knowledge: inspect the folder tree, create folders, move notes between them, and rename or delete folders, planning multi-step reorganizations before touching anything.
---

# Edit Garden

Reorganize where a Garden's notes live. Breadboard can already do each of these
operations without this skill being selected — the tools are part of every
authenticated chat. Selecting `/edit-garden` adds the discipline that a
multi-step reorganization needs: read the whole tree first, plan the moves,
confirm anything destructive, and report what actually changed.

breadboard:
  category: prebuilt
  surfaces: [garden_chat, dashboard_terminal]
  requiredTools:
    - garden_list
    - garden_list_files
    - garden_create_folder
    - garden_move_page
    - garden_rename_folder
    - garden_delete_folder
  requiredArtifactKinds: []
  requiredRuntimes: []
  requiredMcpServers: []
  optionalMcpServers: []

## What this changes and what it does not

These tools move content; they never rewrite it. A moved note keeps its slug,
its title, and every word of its body, so links to it still resolve — Quartz
resolves `[[wikilinks]]` by shortest path, not by folder. Changing what a page
*says* is a different job: use `garden_propose_page_revision` for that, and do
not reach for it silently in the middle of a reorganization.

Folder names are normalized to lowercase hyphenated segments. "Week 4 Notes"
becomes `week-4-notes` on disk while Quartz displays it as "Week 4 Notes". Tell
the user the displayed name, not the slug, unless they asked for the path.

## Resolve the Garden and read the tree

1. Call `garden_list` and match the requested Garden by exact slug or
   case-insensitive name. Never guess between multiple matches. In Garden Chat
   with no Garden named, use the active Garden; in Terminal, ask which Garden.
2. Call `garden_list_files` before proposing or performing anything. It returns
   every folder and the folder each note sits in. Work only from what it
   returns — never from a path a user half-remembered or one you inferred from a
   note's title.
3. If the request names a note that does not appear in the tree, say so and stop
   rather than moving a similarly named one.

## Plan before you move

For a single obvious move, just do it. For anything larger — "sort these into
weeks," "clean up my Garden," "group everything about X" — write the plan out
first as a short list of concrete operations (`move <note> -> <folder>`), and
show it before executing. A reorganization is easy to reverse one note at a
time and tedious to reverse thirty, so the plan is what the user is actually
approving.

When a plan is approved, execute it operation by operation and keep going if one
step fails: report the failures at the end rather than abandoning the rest.

## The operations

- `garden_create_folder` with `folder` — creates the full nested path, so
  `course/week-4` creates `course` too. Create a missing destination as part of
  a move instead of refusing the move.
- `garden_move_page` with `slug` and `toFolder` — moves one note. Pass an empty
  `toFolder` to move it to the Garden root. Moving a note to where it already is
  succeeds and changes nothing.
- `garden_rename_folder` with `folder` and `name` — renames that folder in
  place, keeping its parent. `name` is a single segment with no slashes; to move
  a folder under a different parent, create the destination and move its notes.
- `garden_delete_folder` with `folder` — see below.

If a move reports that a note with that name already exists in the destination,
say which note is in the way. Do not rename either note to force the move
through.

## Deleting is different

`garden_delete_folder` permanently destroys the folder and every note inside it.
There is no trash and no undo. Before calling it:

1. The user must have asked to delete that specific folder. Never infer a
   deletion from "clean up," "get rid of the clutter," or a tidying request.
2. Call `garden_list_files` and tell them exactly how many notes are inside and
   what they are called.
3. Wait for an explicit yes. If they only wanted the folder gone but the notes
   kept, move the notes out first, then delete the empty folder.

Never delete a folder as a step in a larger plan the user approved as a whole.
Deletion gets its own confirmation.

## Report what happened

Say what moved and where it went, using the Garden's displayed names — for
example "Moved 6 notes into Week 4; created Course/Week 5." Do not list every
operation when there were many; give the shape of the result and mention any
step that failed and why. If a tool reports that the Garden belongs to someone
else, say that and stop: these tools only work in the user's own Garden, and
there is no proposal fallback for reorganization.
