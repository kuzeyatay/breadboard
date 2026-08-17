---
name: generate-gadget
description: Build a gadget — a small, self-contained app the user keeps in the chat, reopens later, and can have you edit. Use when the answer is something the user should be able to operate rather than read: a tracker, a calculator with saved state, a checklist, a small tool over their own artifacts or memory. A gadget can also ask to send a message, save a note, or record a memory, and each of those is queued for the user to approve rather than done.
---

# Generate a gadget

A gadget is a real, persistent artifact: three files running in a locked-down
sandbox, stored so that reopening it never regenerates it, and versioned so it
can be revised in place. It is the right output when the user wants something to
*use*, not something to read.

breadboard:
  category: featured
  surfaces: [garden_chat, dashboard_terminal]
  requiredTools:
    - gadget_bindings
    - gadget_generate
    - gadget_revise
  requiredArtifactKinds: [gadget]
  requiredRuntimes: [gadget-runtime]
  requiredMcpServers: []
  optionalMcpServers: []

## When a gadget is the right answer

Reach for one when the user would benefit from state that persists, from
entering things over time, or from a small tool shaped exactly to their problem
— a habit tracker, a unit converter they keep, a reading queue, a scratch
budget. Reach for the interactive visualizer instead when the point is to
*explain* something by manipulating it, and for a plain artifact when the answer
is a document. Do not build a gadget for a one-off calculation; just answer.

## Always call `gadget_bindings` first

It returns the exact binding kinds, the operations each one offers, and the
`host` API. Write the code against that response, not from memory. A call to an
operation that does not exist is rejected at publication, and a binding the
manifest does not declare is refused at runtime.

## What the code may and may not do

The gadget runs in `sandbox="allow-scripts"` with a content policy of
`connect-src 'none'`. It therefore **cannot**:

- call `fetch`, `XMLHttpRequest`, or open a `WebSocket`
- use `localStorage`, `sessionStorage`, `indexedDB`, or cookies
- reach `window.parent`, `window.top`, or embed an iframe or form
- load anything from an external origin, including fonts and images
- use `eval` or build functions from strings

Publication rejects all of these, so writing one is not a runtime surprise — it
is a failed build. Everything the gadget needs from outside comes through
`host`, and anything it wants to keep goes in a `storage` binding.

`index.html` is a body fragment, not a document. Do not write `<html>`,
`<head>`, or `<body>`. Load the script exactly once, with
`<script src="main.js"></script>`; the runtime replaces that tag with the real
inlined code.

## The two verbs, and why they differ

```js
// A read. Resolves with real data, after Breadboard authorizes and records it.
const items = await host.notes.observe('list', {});

// A write. Resolves IMMEDIATELY — before anything has happened.
const queued = await host.phone.act('send', { channel: 'telegram', text: 'Hi' });
// queued = { actionId, status: 'pending', simulated, outcome, applied: false }
```

`act` returning is **not** the write happening. The action was described,
simulated, and put in a queue the user reviews — perhaps days later. Because the
queue simulates, `queued.simulated` is shaped like the real result, so the next
line of the gadget can keep going as though it had succeeded.

This has one consequence you must respect in the UI you write: **never render
"Sent!" or "Saved!" when `act` resolves.** Say it was queued, and show
`queued.outcome`, which is the plain description of what will happen. A gadget
that claims otherwise is lying to the user about something they have not agreed
to yet.

## Declaring bindings

Declare only what the code calls, and set `writable: true` only when it calls
`host.<name>.act`. An unused binding is a permission the user was asked for and
did not need; publication warns about it. A read-only binding has no `act`
method at all, so writing through it fails while you are building rather than in
front of the user.

Each binding's `purpose` is shown to the user. Write it for them — "so it can
remind you on Telegram", not "messaging capability".

## Building one

1. `gadget_bindings` — read the API.
2. Write the three files. Keep them small and legible; the user can read them.
3. `gadget_generate` with the whole package.
4. Tell the user what it does, what it can reach, and — if it has writable
   bindings — that it will ask before doing any of it.

To change an existing gadget, send the complete replacement package to
`gadget_revise` with its `artifactId`. Its id, stored data, and approval history
survive. A rejected revision leaves the previous version running.

## Worked shape

```html
<!-- index.html -->
<main>
  <h1>Reading queue</h1>
  <form id="add"><input id="title" placeholder="Add a book" /><button>Add</button></form>
  <ul id="list"></ul>
  <p id="status"></p>
</main>
<script src="main.js"></script>
```

```js
// main.js
const listEl = document.getElementById('list');
const statusEl = document.getElementById('status');

async function render() {
  const books = (await host.shelf.observe('get', { key: 'books' })) ?? [];
  listEl.replaceChildren(...books.map((book) => {
    const li = document.createElement('li');
    li.textContent = book;
    return li;
  }));
}

document.getElementById('add').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.getElementById('title');
  const books = (await host.shelf.observe('get', { key: 'books' })) ?? [];
  const next = [...books, input.value];
  const queued = await host.shelf.act('set', { key: 'books', value: next });
  // Queued, not saved. Say so.
  statusEl.textContent = queued.outcome;
  input.value = '';
});

render().then(() => host.ready());
```

Its manifest declares one binding: `{ name: 'shelf', kind: 'storage',
purpose: 'to keep your reading list between visits', writable: true }`.
