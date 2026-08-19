import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { getContactStore } from "@/lib/contacts/instance.ts";
import { readContactPatch } from "@/lib/contacts/payload.ts";
import { ContactError } from "@/lib/contacts/store.ts";
import type { ContactInput } from "@/lib/contacts/types.ts";

export const dynamic = "force-dynamic";

/**
 * The address book. `?query=` filters by name, organization or address;
 * `?email=` answers the single question the rest of the app asks — who is
 * this — and returns `{ contact: null }` rather than a 404 when nobody claims
 * the address, because "not in the book" is an ordinary answer.
 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const store = getContactStore();

    const email = url.searchParams.get("email");
    if (email) {
      return NextResponse.json({ contact: store.findByEmail(userId, email) });
    }

    const limitParam = url.searchParams.get("limit");
    const contacts = store.listContacts(userId, {
      query: url.searchParams.get("query") ?? undefined,
      limit: limitParam ? Number(limitParam) : undefined,
    });

    return NextResponse.json({ contacts, total: store.countContacts(userId) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUserId();
    const body = await readJsonBody(request);

    const patch = readContactPatch(body);
    if (patch.name === undefined) throw new ContactError(400, "Name is required.");

    // The store rejects a payload missing any required field, so the cast only
    // shapes the type — it does not skip validation.
    const contact = getContactStore().createContact(userId, patch as ContactInput);

    return NextResponse.json({ contact }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
