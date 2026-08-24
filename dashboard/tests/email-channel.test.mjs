// Email as a channel: the two protocol clients, and the rules around them.
//
// The IMAP and SMTP clients are hand-written, so they are tested against fake
// servers that speak the real protocols over a real socket rather than against
// mocks of themselves. The parsing tests use messages in the shapes mail
// actually arrives in — base64 bodies, encoded subjects, multipart, quoted
// replies — because those are where a small client goes wrong.

import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test, { after, beforeEach } from "node:test";

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadboard-email-"));
const credentialsFile = path.join(dataRoot, "account.json");
process.env.BREADBOARD_DATA_DIR = dataRoot;
process.env.BREADBOARD_EMAIL_CREDENTIALS_FILE = credentialsFile;

const { default: db } = await import("../src/lib/db.ts");
const imap = await import("../src/lib/email/imap.ts");
const smtp = await import("../src/lib/email/smtp.ts");
const credentials = await import("../src/lib/email/credentials.ts");
const store = await import("../src/lib/email/store.ts");

after(() => {
  db.close();
  fs.rmSync(dataRoot, { recursive: true, force: true });
});

beforeEach(() => {
  db.exec(`
    DELETE FROM email_seen_messages;
    DELETE FROM email_threads;
    UPDATE email_settings SET owner_user_id = NULL, allowed_senders = '', address = NULL;
    DELETE FROM conversations;
    DELETE FROM users;
    DELETE FROM sqlite_sequence;
  `);
  db.prepare(
    "INSERT INTO users(id, username, email, password_hash) VALUES (1, 'alice', 'alice@example.test', 'x')",
  ).run();
  fs.rmSync(credentialsFile, { force: true });
});

/** A server that plays a scripted conversation, recording what it was told. */
function fakeServer(handler) {
  return new Promise((resolve) => {
    const received = [];
    const server = net.createServer((socket) => {
      socket.setEncoding("utf8");
      let buffer = "";
      const send = (text) => socket.write(text);
      handler.greet(send);
      socket.on("data", (chunk) => {
        buffer += chunk;
        let index = buffer.indexOf("\r\n");
        while (index !== -1) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          received.push(line);
          handler.line(line, send, socket);
          index = buffer.indexOf("\r\n");
        }
      });
    });
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: server.address().port,
        received,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

const RAW_MESSAGE = [
  "From: Ayse Kaya <ayse@example.test>",
  "To: assistant@example.test",
  "Subject: =?UTF-8?B?UHVtcCByaWcgLSB1cGRhdGU=?=",
  "Message-ID: <abc123@example.test>",
  "Date: Mon, 24 Aug 2026 09:00:00 +0000",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Can you check the pressure log?",
  "",
  "On Sun, 23 Aug 2026, Assistant wrote:",
  "> the previous answer nobody needs to re-read",
].join("\r\n");

// ── IMAP ──────────────────────────────────────────────────────────────

test("a full unread fetch logs in, searches, fetches and marks seen", async () => {
  const server = await fakeServer({
    greet: (send) => send("* OK fake IMAP ready\r\n"),
    line: (line, send) => {
      const [tag, ...rest] = line.split(" ");
      const command = rest.join(" ").toUpperCase();
      if (command.startsWith("LOGIN")) return send(`${tag} OK logged in\r\n`);
      if (command.startsWith("SELECT")) {
        send("* 1 EXISTS\r\n");
        return send(`${tag} OK selected\r\n`);
      }
      if (command.startsWith("UID SEARCH")) {
        send("* SEARCH 42\r\n");
        return send(`${tag} OK search done\r\n`);
      }
      if (command.startsWith("UID FETCH")) {
        send(`${RAW_MESSAGE}\r\n`);
        return send(`${tag} OK fetch done\r\n`);
      }
      if (command.startsWith("UID STORE")) return send(`${tag} OK stored\r\n`);
      if (command.startsWith("LOGOUT")) return send(`${tag} OK bye\r\n`);
      return send(`${tag} BAD unknown\r\n`);
    },
  });

  try {
    const messages = await imap.fetchUnread({
      host: "127.0.0.1",
      port: server.port,
      user: "assistant@example.test",
      password: "secret",
      secure: false,
      allowPlaintext: true,
      timeoutMs: 5_000,
    });

    assert.equal(messages.length, 1);
    const [message] = messages;
    assert.equal(message.uid, 42);
    assert.equal(message.from, "ayse@example.test");
    assert.equal(message.fromName, "Ayse Kaya");
    assert.equal(message.subject, "Pump rig - update", "an encoded subject is decoded");
    assert.equal(message.messageId, "abc123@example.test");
    assert.match(message.text, /pressure log/);
    assert.doesNotMatch(message.text, /nobody needs to re-read/, "quoted history is stripped");

    assert.ok(
      server.received.some((line) => /UID STORE 42 \+FLAGS \(\\Seen\)/.test(line)),
      "the message must be marked read or it is answered forever",
    );
    assert.ok(
      server.received.some((line) => /BODY\.PEEK/.test(line)),
      "PEEK, so a failed fetch does not silently consume the mail",
    );
  } finally {
    await server.close();
  }
});

test("a login failure is reported, not swallowed", async () => {
  const server = await fakeServer({
    greet: (send) => send("* OK fake IMAP ready\r\n"),
    line: (line, send) => {
      const [tag] = line.split(" ");
      send(`${tag} NO [AUTHENTICATIONFAILED] wrong password\r\n`);
    },
  });
  try {
    const result = await imap.verifyImap({
      host: "127.0.0.1",
      port: server.port,
      user: "a@b.test",
      password: "wrong",
      secure: false,
      allowPlaintext: true,
      timeoutMs: 5_000,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /wrong password/);
  } finally {
    await server.close();
  }
});

// ── message parsing ───────────────────────────────────────────────────

test("a base64 body is decoded", () => {
  const raw = [
    "Subject: test",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from("Hello — this has an em dash.", "utf8").toString("base64"),
  ].join("\r\n");
  assert.match(imap.extractPlainText(raw), /Hello — this has an em dash/);
});

test("quoted-printable is decoded", () => {
  const raw = [
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "Caf=C3=A9 meeting at 3",
  ].join("\r\n");
  assert.match(imap.extractPlainText(raw), /Caf/);
});

test("multipart prefers the plain-text part", () => {
  const raw = [
    'Content-Type: multipart/alternative; boundary="XYZ"',
    "",
    "--XYZ",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "the plain version",
    "--XYZ",
    "Content-Type: text/html; charset=utf-8",
    "",
    "<p>the html version</p>",
    "--XYZ--",
  ].join("\r\n");
  const text = imap.extractPlainText(raw);
  assert.match(text, /the plain version/);
  assert.doesNotMatch(text, /html version/);
});

test("an html-only message is reduced to readable text", () => {
  const raw = [
    "Content-Type: text/html; charset=utf-8",
    "",
    "<html><body><style>p{color:red}</style><p>Check the <b>pump</b> rig</p></body></html>",
  ].join("\r\n");
  const text = imap.extractPlainText(raw);
  assert.match(text, /Check the pump rig/);
  assert.doesNotMatch(text, /color:red/);
});

test("headers folded across lines are rejoined", () => {
  const raw = ["Subject: a very long subject", " continued on the next line", "", "body"].join(
    "\r\n",
  );
  assert.equal(
    imap.parseHeaders(raw).get("subject"),
    "a very long subject continued on the next line",
  );
});

test("a reply with no new text keeps something rather than nothing", () => {
  const body = "> only quoted text here";
  assert.ok(imap.stripQuotedText(body).length > 0);
});

// ── SMTP ──────────────────────────────────────────────────────────────

test("sending walks the protocol and delivers the body", async () => {
  let inData = false;
  // AUTH LOGIN is three exchanges: the command, the username, the password.
  // The fake has to count them, or it answers the password with another prompt.
  let authStep = 0;
  const body = [];
  const credentials = [];
  const server = await fakeServer({
    greet: (send) => send("220 fake SMTP ready\r\n"),
    line: (line, send) => {
      if (inData) {
        if (line === ".") {
          inData = false;
          return send("250 queued\r\n");
        }
        body.push(line);
        return undefined;
      }
      const command = line.toUpperCase();
      if (command.startsWith("EHLO")) {
        send("250-fake greets you\r\n");
        return send("250 AUTH LOGIN PLAIN\r\n");
      }
      if (command.startsWith("AUTH LOGIN")) {
        authStep = 1;
        return send("334 VXNlcm5hbWU6\r\n");
      }
      if (authStep === 1) {
        authStep = 2;
        credentials.push(Buffer.from(line, "base64").toString("utf8"));
        return send("334 UGFzc3dvcmQ6\r\n");
      }
      if (authStep === 2) {
        authStep = 3;
        credentials.push(Buffer.from(line, "base64").toString("utf8"));
        return send("235 authenticated\r\n");
      }
      if (command.startsWith("MAIL FROM")) return send("250 sender ok\r\n");
      if (command.startsWith("RCPT TO")) return send("250 recipient ok\r\n");
      if (command === "DATA") {
        inData = true;
        return send("354 go ahead\r\n");
      }
      if (command === "QUIT") return send("221 bye\r\n");
      return send("500 unknown\r\n");
    },
  });

  try {
    await smtp.sendMail(
      {
        host: "127.0.0.1",
        port: server.port,
        user: "assistant@example.test",
        password: "secret",
        secure: false,
        allowPlaintext: true,
        timeoutMs: 5_000,
      },
      {
        from: "assistant@example.test",
        fromName: "Breadboard",
        to: "ayse@example.test",
        subject: "Re: Pump rig",
        text: "The pressure log looks fine.",
        inReplyTo: "abc123@example.test",
      },
    );

    assert.deepEqual(credentials, ["assistant@example.test", "secret"]);
    assert.ok(server.received.some((line) => /^MAIL FROM:<assistant@example\.test>/.test(line)));
    assert.ok(server.received.some((line) => /^RCPT TO:<ayse@example\.test>/.test(line)));
    const message = body.join("\n");
    assert.match(message, /Subject: Re: Pump rig/);
    assert.match(message, /In-Reply-To: <abc123@example\.test>/);
    assert.match(message, /Auto-Submitted: auto-replied/);
    assert.match(message, /The pressure log looks fine\./);
  } finally {
    await server.close();
  }
});

test("a non-ascii subject is encoded", () => {
  const encoded = smtp.encodeHeader("Café — update");
  assert.match(encoded, /^=\?UTF-8\?B\?/);
  assert.equal(
    Buffer.from(encoded.replace(/^=\?UTF-8\?B\?/, "").replace(/\?=$/, ""), "base64").toString("utf8"),
    "Café — update",
  );
});

test("an ascii subject is left alone", () => {
  assert.equal(smtp.encodeHeader("Plain subject"), "Plain subject");
});

test("a body line starting with a dot is stuffed", () => {
  // Without this, a line reading "." ends the DATA block early and truncates
  // the mail at that point.
  assert.match(smtp.encodeBody("first\n.hidden\nlast"), /\r\n\.\.hidden\r\n/);
});

test("the built message ends with the DATA terminator", () => {
  const message = smtp.buildMessage({
    from: "a@b.test",
    to: "c@d.test",
    subject: "hi",
    text: "body",
  });
  assert.ok(message.endsWith("\r\n.\r\n"));
});

// ── credentials ───────────────────────────────────────────────────────

test("the password is stored but never described", () => {
  credentials.writeAccount({
    address: "assistant@example.test",
    imapHost: "imap.example.test",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.example.test",
    smtpPort: 465,
    smtpSecure: true,
    user: "assistant@example.test",
    password: "hunter2",
    allowSelfSigned: false,
  });

  assert.equal(credentials.readAccount().password, "hunter2");
  const described = credentials.describeAccount();
  assert.equal(described.address, "assistant@example.test");
  assert.ok(!("password" in described), "the settings payload must not carry the secret");
  assert.equal(JSON.stringify(described).includes("hunter2"), false);
});

test("an incomplete account is rejected", () => {
  assert.throws(() =>
    credentials.writeAccount({
      address: "not-an-address",
      imapHost: "imap.example.test",
      imapPort: 993,
      imapSecure: true,
      smtpHost: "smtp.example.test",
      smtpPort: 465,
      smtpSecure: true,
      user: "x",
      password: "y",
      allowSelfSigned: false,
    }),
  );
  assert.equal(credentials.hasAccount(), false);
});

// ── who may write ─────────────────────────────────────────────────────

test("nobody is allowed until a mailbox has an owner", () => {
  const settings = store.readSettings();
  assert.equal(store.senderIsAllowed("anyone@example.test", settings, null), false);
});

test("the owner's own address is always allowed", () => {
  store.saveSettings({ ownerUserId: 1, address: "assistant@example.test" });
  const settings = store.readSettings();
  assert.equal(
    store.senderIsAllowed("assistant@example.test", settings, "assistant@example.test"),
    true,
  );
});

test("a stranger is not allowed by default", () => {
  store.saveSettings({ ownerUserId: 1, address: "assistant@example.test" });
  const settings = store.readSettings();
  assert.equal(store.senderIsAllowed("stranger@example.test", settings, "assistant@example.test"), false);
});

test("an address is allowed once it is listed", () => {
  store.saveSettings({
    ownerUserId: 1,
    address: "assistant@example.test",
    allowedSenders: ["ayse@example.test"],
  });
  const settings = store.readSettings();
  assert.equal(store.senderIsAllowed("AYSE@example.test", settings, "assistant@example.test"), true);
});

// ── delivered once ────────────────────────────────────────────────────

test("a message id is claimable exactly once", () => {
  assert.equal(store.claimMessage("abc123@example.test"), true);
  assert.equal(store.claimMessage("abc123@example.test"), false);
});

test("a thread remembers the correspondent and their last message", () => {
  store.recordInbound({
    address: "Ayse@example.test",
    userId: 1,
    label: "Ayse Kaya",
    messageId: "m1@example.test",
    subject: "Pump rig",
  });
  const first = store.getThread("ayse@example.test");
  assert.equal(first.message_count, 1);
  assert.equal(first.contact_label, "Ayse Kaya");

  store.recordInbound({
    address: "ayse@example.test",
    userId: 1,
    label: "",
    messageId: "m2@example.test",
    subject: "Re: Pump rig",
  });
  const second = store.getThread("ayse@example.test");
  assert.equal(second.message_count, 2);
  assert.equal(second.last_message_id, "m2@example.test");
  assert.equal(second.contact_label, "Ayse Kaya", "an unnamed follow-up keeps the known name");
});
