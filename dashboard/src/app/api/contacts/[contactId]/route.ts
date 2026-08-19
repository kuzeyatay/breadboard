import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { apiErrorResponse, readJsonBody } from "@/lib/hermes/route-helpers.ts";
import { getContactStore } from "@/lib/contacts/instance.ts";
import { readContactPatch } from "@/lib/contacts/payload.ts";
import { ContactError } from "@/lib/contacts/store.ts";

export const dynamic = "force-dynamic";

function contactId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ContactError(400, "That contact id is not valid.");
  }
  return id;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ contactId: string }> },
) {
  try {
    const userId = await requireUserId();
    const id = contactId((await params).contactId);
    return NextResponse.json({ contact: getContactStore().getContact(userId, id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ contactId: string }> },
) {
  try {
    const userId = await requireUserId();
    const id = contactId((await params).contactId);
    const body = await readJsonBody(request);

    const contact = getContactStore().updateContact(userId, id, readContactPatch(body));

    return NextResponse.json({ contact });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ contactId: string }> },
) {
  try {
    const userId = await requireUserId();
    const id = contactId((await params).contactId);
    getContactStore().deleteContact(userId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
