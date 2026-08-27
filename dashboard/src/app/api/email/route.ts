import { NextResponse } from "next/server";

import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import {
  clearAccount,
  describeAccount,
  looksLikeAddress,
  readAccount,
  writeAccount,
} from "@/lib/email/credentials";
import {
  emailStatus,
  pollEmailOnce,
} from "@/lib/email/service";
import { readSettings, saveSettings } from "@/lib/email/store";
import { verifyImap } from "@/lib/email/imap";
import { verifySmtp } from "@/lib/email/smtp";
import {
  reconcileRuntimeSchedule,
  runtimeScheduleEnabled,
} from "@/lib/runtime-v2/gateway-control";

export const dynamic = "force-dynamic";

// Linking a mailbox, and controlling the channel that reads it.
//
// The password only ever travels inbound. Every response describes the account
// — address, hosts, username — and never the secret, which is on disk in
// Hermes's private directory rather than in the database.

async function payload(userId: number) {
  return {
    ...emailStatus(await runtimeScheduleEnabled("email-poll", userId)),
    account: describeAccount(),
  };
}

export async function GET() {
  try {
    const userId = await requireUserId();
    return NextResponse.json({ ok: true, ...(await payload(userId)) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = (await request.json()) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "link";

    if (action === "start") {
      if (!readAccount()) {
        return NextResponse.json(
          { ok: false, error: "Link a mailbox before starting the channel." },
          { status: 400 },
        );
      }
      await reconcileRuntimeSchedule("email-poll", "running", userId);
      return NextResponse.json({ ok: true, ...(await payload(userId)) });
    }

    if (action === "stop") {
      await reconcileRuntimeSchedule("email-poll", "stopped", userId);
      return NextResponse.json({ ok: true, ...(await payload(userId)) });
    }

    if (action === "poll") {
      return NextResponse.json({
        ok: true,
        result: await pollEmailOnce(),
        ...(await payload(userId)),
      });
    }

    if (action === "unlink") {
      await reconcileRuntimeSchedule("email-poll", "stopped", userId);
      clearAccount();
      saveSettings({ address: null, linkedAt: null, autostart: false, lastError: null });
      return NextResponse.json({ ok: true, ...(await payload(userId)) });
    }

    if (action === "allow") {
      const raw = Array.isArray(body.senders) ? body.senders : [];
      const senders = raw
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => looksLikeAddress(entry))
        .slice(0, 50);
      saveSettings({ allowedSenders: senders });
      return NextResponse.json({ ok: true, ...(await payload(userId)) });
    }

    if (action === "autostart") {
      saveSettings({ autostart: body.enabled === true });
      return NextResponse.json({ ok: true, ...(await payload(userId)) });
    }

    if (action !== "link") {
      return NextResponse.json({ ok: false, error: `unknown action "${action}"` }, { status: 400 });
    }

    const account = {
      address: String(body.address ?? "").trim(),
      displayName: String(body.displayName ?? "").trim(),
      imapHost: String(body.imapHost ?? "").trim(),
      imapPort: Number(body.imapPort ?? 993),
      imapSecure: body.imapSecure !== false,
      smtpHost: String(body.smtpHost ?? "").trim(),
      smtpPort: Number(body.smtpPort ?? 465),
      smtpSecure: body.smtpSecure !== false,
      user: String(body.user ?? body.address ?? "").trim(),
      password: String(body.password ?? ""),
      allowSelfSigned: body.allowSelfSigned === true,
    };

    // Both directions are checked before anything is written. Half a working
    // mailbox — reads mail, cannot reply — is the most confusing state to be
    // in, and the one a "saved!" message would hide.
    const imap = await verifyImap({
      host: account.imapHost,
      port: account.imapPort,
      user: account.user,
      password: account.password,
      secure: account.imapSecure,
      allowSelfSigned: account.allowSelfSigned,
    });
    if (!imap.ok) {
      return NextResponse.json(
        { ok: false, error: `Reading mail failed: ${imap.error}` },
        { status: 400 },
      );
    }

    const smtp = await verifySmtp({
      host: account.smtpHost,
      port: account.smtpPort,
      user: account.user,
      password: account.password,
      secure: account.smtpSecure,
      allowSelfSigned: account.allowSelfSigned,
    });
    if (!smtp.ok) {
      return NextResponse.json(
        { ok: false, error: `Sending mail failed: ${smtp.error}` },
        { status: 400 },
      );
    }

    writeAccount(account);
    saveSettings({
      ownerUserId: userId,
      address: account.address.toLowerCase(),
      linkedAt: new Date().toISOString(),
      lastError: null,
      // The owner's own address is always allowed; anyone else has to be added
      // deliberately. Nothing here opens the mailbox to strangers.
      allowedSenders: readSettings().allowedSenders,
    });

    return NextResponse.json({ ok: true, ...(await payload(userId)) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
