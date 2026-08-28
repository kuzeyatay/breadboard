// Renders the Buzz room surface for real (esbuild -> CJS -> react-dom/server)
// rather than reasoning about what the JSX would produce.
//
// This exists because the first version of the page looked wrong in ways that
// typechecked perfectly: message bodies carried a `buzz-markdown` class that no
// stylesheet defines, and the vendored primitives painted with `bg-background`
// while that token had been renamed out from under them. Both are invisible to
// `tsc` and obvious in the markup, so the markup is what gets asserted.

import assert from "node:assert/strict";
import fs from "node:fs";
import module from "node:module";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import esbuild from "esbuild";

const dashboardRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");

fs.mkdirSync(path.join(dashboardRoot, "node_modules", ".cache"), { recursive: true });
const outDirectory = fs.mkdtempSync(
  path.join(dashboardRoot, "node_modules", ".cache", "breadboard-buzz-render-"),
);

after(() => {
  fs.rmSync(outDirectory, { recursive: true, force: true });
});

const entry = path.join(outDirectory, "entry.jsx");
fs.writeFileSync(
  entry,
  [
    'export { MessageRow } from "@/app/buzz/components/message-row";',
    'export { AgentsView, InboxView } from "@/app/buzz/components/rail-views";',
    'export { MembersPanel } from "@/app/buzz/components/members-panel";',
    'export { MessageMarkdown } from "@/app/buzz/components/message-markdown";',
    'export { Composer } from "@/app/buzz/components/composer";',
    'export { RoomRail } from "@/app/buzz/components/room-rail";',
    'export { default as BuzzLoading } from "@/app/buzz/loading";',
    'export { default as RouteLoading } from "@/app/components/route-loading";',
    'export { SidebarProvider } from "@/app/buzz/ui/sidebar";',
    "",
  ].join("\n"),
  "utf8",
);

const bundle = path.join(outDirectory, "bundle.cjs");
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  outfile: bundle,
  format: "cjs",
  platform: "node",
  target: "node20",
  jsx: "automatic",
  // `dialog.tsx` imports `card-texture.css`, which in turn points at four PNGs.
  // None of it affects the markup this test asserts on, and bundling images
  // into a server-render harness would only make it slower and more brittle.
  loader: { ".ts": "ts", ".tsx": "tsx", ".css": "empty", ".png": "empty" },
  alias: { "@": path.join(dashboardRoot, "src") },
  external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
  logLevel: "silent",
});

const require = module.createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const {
  AgentsView,
  BuzzLoading,
  Composer,
  InboxView,
  MembersPanel,
  MessageMarkdown,
  MessageRow,
  RoomRail,
  RouteLoading,
  SidebarProvider,
} = require(bundle);

const agent = {
  id: 1,
  roomId: 1,
  kind: "agent",
  userId: null,
  personaSlug: "researcher",
  displayName: "Researcher",
  handle: "researcher",
  accent: "#8839ef",
  respondTo: "mention",
  model: null,
  conversationId: null,
  muted: false,
  joinedAt: "2026-01-01 00:00:00",
};

const person = { ...agent, id: 2, kind: "human", personaSlug: null, handle: "ada", displayName: "Ada" };

function message(overrides = {}) {
  return {
    id: 1,
    roomId: 1,
    clientMessageId: "a",
    memberId: 1,
    authorKind: "agent",
    authorName: "Researcher",
    authorHandle: "researcher",
    personaSlug: "researcher",
    body: "On it — mapping the views now.",
    parentId: null,
    status: "complete",
    runId: null,
    metadata: null,
    editedAt: null,
    deletedAt: null,
    createdAt: "2026-08-20 12:00:00",
    updatedAt: "2026-08-20 12:00:00",
    ...overrides,
  };
}

function renderRow(overrides = {}, members = [agent, person]) {
  return renderToStaticMarkup(
    React.createElement(MessageRow, {
      message: message(overrides),
      member: agent,
      roomMembers: members,
      grouped: false,
      isSelf: false,
      onReact: () => {},
      onOpenThread: () => {},
      onDelete: () => {},
      onEdit: () => {},
    }),
  );
}

test("a message body carries the stylesheet's own markdown scope", () => {
  const html = renderRow();
  // `message-markdown` is the class the vendored sheet hangs the whole message
  // typography on. Anything else and the body renders with browser defaults.
  assert.match(html, /class="message-markdown"/);
});

test("a message row keeps Buzz's row anatomy", () => {
  const html = renderRow();
  assert.match(html, /data-testid="message-row"/);
  assert.match(html, /data-testid="message-author"/);
  // No profile pictures anywhere in Buzz, and no gutter left behind where one
  // used to sit — the text starts at the row's own edge.
  assert.doesNotMatch(html, /data-testid="message-avatar/);
  assert.doesNotMatch(html, /w-9 shrink-0/);
  // Rows are padded by the conversation variable so the transcript retunes
  // with the type scale.
  assert.match(html, /py-conversation-row/);
});

test("mentions of room members render as chips, by kind", () => {
  const html = renderToStaticMarkup(
    React.createElement(MessageMarkdown, {
      body: "Handing to @researcher — @ada can you review?",
      members: [agent, person],
    }),
  );
  assert.match(html, /inline-chip-icon-agent[^"]*"[^>]*data-mention-handle="researcher"/);
  assert.match(html, /inline-chip-icon-human[^"]*"[^>]*data-mention-handle="ada"/);
});

test("an at-sign that names nobody in the room stays plain text", () => {
  const html = renderToStaticMarkup(
    React.createElement(MessageMarkdown, {
      body: "Mail ada@example.com, and `@researcher` is a code span.",
      members: [agent, person],
    }),
  );
  assert.doesNotMatch(html, /mention-chip/);
  // The email is still a mailto link, and the code span is untouched.
  assert.match(html, /mailto:ada@example\.com/);
  assert.match(html, /<code>@researcher<\/code>/);
});

test("an unanswered agent row says who is thinking rather than rendering blank", () => {
  const html = renderRow({ body: "", status: "streaming" });
  assert.match(html, /Researcher is thinking/);
});

test("a deleted message keeps a row and says so", () => {
  const html = renderRow({ deletedAt: "2026-08-20 12:01:00", body: "" });
  assert.match(html, /This message was deleted/);
});

test("the composer offers its toolbar and a send control", () => {
  const html = renderToStaticMarkup(
    React.createElement(Composer, {
      members: [agent],
      placeholder: "Message #engineering",
      onSend: () => {},
    }),
  );
  assert.match(html, /data-testid="send-message"/);
  assert.match(html, /data-testid="message-insert-mention"/);
  assert.match(html, /placeholder="Message #engineering"/);
});

test("the rail carries search, the primary menu, unread badges and the profile card", () => {
  const html = renderToStaticMarkup(
    React.createElement(
      SidebarProvider,
      { className: "buzz-host-shell" },
      React.createElement(RoomRail, {
        community: { id: 1, name: "Honeycomb", role: "owner", people: [] },
        rooms: [
          {
            publicId: "r1",
            organizationId: 1,
            slug: "engineering",
            name: "engineering",
            topic: "",
            kind: "channel",
            visibility: "public",
            archived: false,
            unread: 3,
            memberCount: 9,
            agentHandles: ["researcher"],
            peopleHandles: ["ada"],
          },
        ],
        // Deliberately not the room above: an open room shows no badge, so a
        // test that opened it would assert nothing.
        activeRoomId: "elsewhere",
        view: "room",
        inboxCount: 3,
        agentCount: 1,
        onSelect: () => {},
        onCreateRoom: () => {},
        onSearch: () => {},
        onOpenView: () => {},
      }),
    ),
  );
  assert.match(html, /data-testid="open-search"/);
  // Upstream pins a card naming the reader to the bottom of the rail. This
  // page is only ever open for the signed-in account, so it does not.
  assert.doesNotMatch(html, /data-testid="sidebar-profile-card"/);
  assert.match(html, /Inbox/);
  // A channel says only that something is waiting; a count is reserved for
  // direct rooms, where every message is addressed to you.
  assert.match(html, /data-testid="channel-unread-dot-engineering"/);
  assert.match(html, /font-bold/, "an unread room is bold, not dimmed");

  // Both primary rows open a real view, so both carry a handle to click. The
  // third row upstream draws here — Projects — is deliberately absent rather
  // than rendered dead.
  assert.match(html, /data-testid="rail-inbox"/);
  assert.match(html, /data-testid="rail-agents"/);
  assert.doesNotMatch(html, /Projects/);
});

/* ── the surfaces that replaced dead controls ────────────────────────────── */

function hit(overrides = {}) {
  return {
    message: message({ memberId: 2, authorKind: "human", authorName: "Ada" }),
    roomPublicId: "r1",
    roomName: "engineering",
    roomSlug: "engineering",
    roomKind: "channel",
    organizationId: 1,
    mentionsYou: false,
    ...overrides,
  };
}

test("the inbox sorts what names you above what merely arrived", () => {
  const html = renderToStaticMarkup(
    React.createElement(InboxView, {
      unread: [
        hit({ message: message({ id: 1, body: "shipping the survey" }) }),
        hit({
          message: message({ id: 2, body: "@ada can you check the transect?" }),
          mentionsYou: true,
        }),
      ],
      invites: [],
      loading: false,
      onRefresh: () => {},
      onOpen: () => {},
      onRespondToInvite: () => {},
    }),
  );
  const mentions = html.indexOf("Mentions you");
  const unread = html.indexOf("Unread:");
  assert.ok(mentions > -1 && unread > -1, "both sections render");
  assert.ok(mentions < unread, "the line that names you comes first");
  assert.match(html, /check the transect/);
});

test("an empty inbox says so rather than rendering a blank pane", () => {
  const html = renderToStaticMarkup(
    React.createElement(InboxView, {
      unread: [],
      invites: [],
      loading: false,
      onRefresh: () => {},
      onOpen: () => {},
      onRespondToInvite: () => {},
    }),
  );
  assert.match(html, /Nothing waiting/);
});

test("a pending invitation is answerable from the inbox, above the messages", () => {
  const html = renderToStaticMarkup(
    React.createElement(InboxView, {
      unread: [hit({ message: message({ id: 1, body: "shipping the survey" }) })],
      invites: [
        {
          id: 7,
          organizationId: 10,
          organizationName: "Fieldwork",
          role: "member",
          invitedBy: "ada",
          createdAt: "2026-01-01 00:00:00",
        },
      ],
      loading: false,
      onRefresh: () => {},
      onOpen: () => {},
      onRespondToInvite: () => {},
    }),
  );
  // Both answers are present and named: an invitation the reader can see but
  // not act on is the state this whole section exists to prevent.
  assert.match(html, /Accept/);
  assert.match(html, /Decline/);
  assert.match(html, /ada invited you to join this community/);
  // It outranks the unread messages — until it is answered, the rooms behind
  // it cannot be opened at all.
  assert.ok(html.indexOf("Invitations:") < html.indexOf("Unread:"));
});

test("the agents view groups one persona's rooms under one heading", () => {
  const seat = (roomSlug, roomPublicId) => ({
    member: agent,
    roomPublicId,
    roomName: roomSlug,
    roomSlug,
    organizationId: 1,
  });
  const html = renderToStaticMarkup(
    React.createElement(AgentsView, {
      agents: [seat("engineering", "r1"), seat("design", "r2")],
      loading: false,
      onRefresh: () => {},
      onOpenRoom: () => {},
      onRespondToChange: () => {},
    }),
  );
  // One persona, two seats: the handle is named once and says how many rooms.
  assert.equal(html.split("@researcher").length - 1, 1);
  assert.match(html, /2 rooms/);
  assert.match(html, /engineering/);
  assert.match(html, /design/);
  // The respond-to chips carry the sentence they abbreviate.
  assert.match(html, /title="Answers when someone names it by handle"/);
});

/* ── what a route shows before it can paint ──────────────────────────────── */

test("opening Chat paints Buzz's own surface, not a bare window", () => {
  const html = renderToStaticMarkup(React.createElement(BuzzLoading));
  // The gradient, so the wait and the room that follows are one surface —
  // nothing changes colour under the reader when the page arrives.
  assert.match(html, /buzz-theme-gradient-layer-light/);
  assert.match(html, /class="buzz-root/);
  // The shared hand-drawn ring and a line that says where you are going.
  assert.match(html, /class="bb-loader /);
  assert.match(html, /bb-loader-sketch-3/);
  assert.match(html, /Opening Chat/);
  assert.match(html, /role="status"/);
});

test("the shared route loader names its destination", () => {
  const html = renderToStaticMarkup(
    React.createElement(RouteLoading, {
      label: "Opening your calendar",
      hint: "Reading your events.",
    }),
  );
  assert.match(html, /class="bb-loader /);
  assert.match(html, /bb-loader-sketch-3/);
  assert.match(html, /Opening your calendar/);
  assert.match(html, /Reading your events\./);
  assert.match(html, /aria-live="polite"/);
});

/** The panel with one person, Bread, and one specialist seated. */
function renderMembersPanel(overrides = {}) {
  const bread = {
    ...agent,
    id: 3,
    personaSlug: "bread",
    displayName: "Bread",
    handle: "bread",
    respondTo: "always",
  };
  return renderToStaticMarkup(
    React.createElement(MembersPanel, {
      members: [person, bread, agent],
      personas: [
        {
          slug: "researcher",
          name: "Researcher",
          description: "Reads the literature",
          division: "Academic",
          divisionColor: "#8B5CF6",
          color: "#8B5CF6",
          emoji: "",
        },
      ],
      roomPublicId: "r1",
      rosterReady: true,
      onClose: () => {},
      onAddPersona: () => {},
      onAddPerson: () => ({ kind: "seated" }),
      onRemove: () => {},
      onRespondToChange: () => {},
      ...overrides,
    }),
  );
}

test("the panel labels its sections with a colon, in the display face", () => {
  const html = renderMembersPanel();
  assert.match(html, /People<span[^>]*>: 1<\/span>/);
  assert.match(html, /Agents<span[^>]*>: 2<\/span>/);
  // The em dash the counts used to hang off is gone from the headings.
  assert.doesNotMatch(html, /People\s*—/);
  assert.doesNotMatch(html, /Agents\s*—/);
  // `buzz-panel-label` is what `buzz-host.css` hangs the display face on;
  // without the class the headings silently fall back to Inter.
  assert.match(html, /buzz-panel-label/);
  // And the tracked-out micro-caps treatment is not on them any more.
  assert.doesNotMatch(html, /buzz-panel-label[^"]*uppercase/);
});

test("Bread is shown as a seated agent, answering by default", () => {
  const html = renderMembersPanel();
  assert.match(html, /@bread/);
  // Its `always` chip is the checked one — the room answers without anybody
  // learning a handle first.
  const always = html.indexOf("Always");
  assert.ok(always > -1, "the Always chip renders");
});
