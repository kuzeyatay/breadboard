import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { createInviteCode, formatInviteCode } from '@/lib/invites';
import { requireUserId, routeErrorResponse } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

interface InviteRow {
  id: number;
  code: string;
  created_at: string;
  used_at: string | null;
}

function insertInviteCode(createdByUserId: number): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = createInviteCode();
    try {
      db.prepare(
        'INSERT INTO invite_codes (code, created_by_user_id, created_at) VALUES (?, ?, ?)',
      ).run(code, createdByUserId, new Date().toISOString());
      return code;
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new Error('Could not create a unique invite code');
}

export async function GET() {
  try {
    const userId = await requireUserId();
    const rows = db
      .prepare(
        `SELECT id, code, created_at, used_at
         FROM invite_codes
         WHERE created_by_user_id = ?
         ORDER BY created_at DESC
         LIMIT 12`,
      )
      .all(userId) as InviteRow[];

    return NextResponse.json({
      invites: rows.map((row) => ({
        id: row.id,
        code: formatInviteCode(row.code),
        created_at: row.created_at,
        used_at: row.used_at,
      })),
    });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

export async function POST() {
  try {
    const userId = await requireUserId();
    const code = insertInviteCode(userId);
    return NextResponse.json({ code: formatInviteCode(code) }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
