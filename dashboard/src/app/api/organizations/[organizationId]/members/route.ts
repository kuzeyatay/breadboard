import { NextResponse } from "next/server";
import { requireUserId, routeErrorResponse } from "@/lib/server-auth";
import {
  inviteMember,
  removeMember,
  setMemberRole,
  type OrganizationRole,
} from "@/lib/organizations/store";

export const dynamic = "force-dynamic";

function asRole(value: unknown): OrganizationRole {
  return value === "owner" || value === "admin" ? value : "member";
}

/** Invite someone by username or email. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { organizationId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      handle?: unknown;
      role?: unknown;
    };
    const invited = inviteMember(
      Number(organizationId),
      userId,
      typeof body.handle === "string" ? body.handle : "",
      asRole(body.role),
    );
    return NextResponse.json(invited, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { organizationId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      userId?: unknown;
      role?: unknown;
    };
    setMemberRole(
      Number(organizationId),
      userId,
      Number(body.userId),
      asRole(body.role),
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

/** Remove a member, or leave when the target is the caller. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const userId = await requireUserId();
    const { organizationId } = await params;
    const target = Number(
      new URL(request.url).searchParams.get("userId") ?? userId,
    );
    removeMember(Number(organizationId), userId, target);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
