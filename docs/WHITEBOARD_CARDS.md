# Whiteboard cards

A note in a garden can hold a whiteboard: a framed drawing surface you can write,
sketch and think on, which keeps what you drew — and where you were on it —
between visits. The surface is [PenEcho](https://github.com/penecho/penecho),
vendored at `./penecho`, running as a local canvas server that Breadboard starts
on demand.

## Using one

In a note's markdown editor, **Add whiteboard** writes a block like this at the
chosen place:

````markdown
```penecho
id: 1754470000000-a1b2c3d4e5f6
title: Whiteboard
height: 520
```
````

The block is a reference, not content. `title` is the card's heading and
`height` its size in the note (280–1200 px, default 520); both can be edited by
hand afterwards. `id` names one board on the canvas server and should be left
alone — changing it points the card at a different (probably empty) board.

The rendered card shows the title bar and the board. Clicking the title bar (or
**Expand**) fills the window with it; **Close** or `Escape` puts it back. The
frame is never moved in the document while that happens, so nothing on the board
is lost or reloaded.

Boards mount as they scroll into view, and a mounted board is never unmounted —
a note with several whiteboards only pays for the ones you look at.

## What "remembers where it was" means

Everything on the board — ink, images, text, AI widgets — plus the viewport
(pan and zoom) is written back to the canvas server a couple of seconds after
you stop changing it, and whenever the page is hidden or closed. Reopening the
card restores all of it, so you return to the board exactly as you left it,
looking at the same part of it.

A board that is erased completely is deleted rather than left behind, so an
emptied card stays empty.

## How it is wired

| Piece | Where |
| --- | --- |
| Block → card (build) | `quartz/quartz/plugins/transformers/penechoBoard.ts` |
| The card itself | `quartz/quartz/components/scripts/penechoBoard.inline.ts` |
| Insert control | `quartz/quartz/components/MarkdownActions.tsx` |
| Canvas server launcher | `dashboard/src/lib/penecho/service.ts` |
| What the card asks | `dashboard/src/app/api/penecho/status` |

The canvas server needs no install step: it is plain Node with no required
dependencies, so the dashboard runs `node server.js` out of the clone, binds it
to loopback, and answers PenEcho's first-run access screen itself. Its AI
provider is ChatMock, so a board answers on the same model as everything else.
`PENECHO_MODEL` overrides the model; `PENECHO_URL` points the cards at a server
Breadboard does not supervise (and stops it starting one).

Without Sharp — which the clone does not install — PenEcho cannot encode WebP,
so the launcher selects PNG for the images it sends the model.

## Changes made to the vendored clone

Four, each guarded so an unconfigured PenEcho behaves exactly as upstream does:

- `PENECHO_FRAME_ANCESTORS` (`src/server/main.js`) replaces the shipped
  `frame-ancestors 'none'`. Without it a card is a blank frame. The same list is
  added to the widget sandbox's policy, or every AI-rendered widget is blocked
  inside an embedded board.
- The board binding (`src/client/app/breadboard-board.js`) implements
  `?board=<id>`: load that board on open, write it back as it changes.
- `saveSnapshot` (`src/client/app/persistence.js`) gained `createId` and `quiet`,
  and the history commit calls a change hook. Everything else it does is
  untouched.
- `public/breadboard-board.css` hides the wordmark and the manual new/save canvas
  buttons for a bound board, which the card's own title bar and autosave replace.

After editing anything under `src/client/app/`, run `npm run build:client` in
`./penecho` — `public/app.js` is generated from those files.

## Not included

The whiteboard is not part of the packaged desktop build: `penecho/` is not
staged into `desktop/build-resources/app-services`, so an installed Breadboard
reports that the whiteboard server is not installed. Running from the repo is
unaffected.
