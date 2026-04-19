import { NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import db from '@/lib/db';
import { normalizeInviteCode } from '@/lib/invites';

interface InviteRow {
  id: number;
  used_at: string | null;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { username, email, password, inviteCode } = body as {
      username?: unknown;
      email?: unknown;
      password?: unknown;
      inviteCode?: unknown;
    };

    if (typeof username !== 'string' || !username.trim()) {
      return NextResponse.json({ error: 'Username is required' }, { status: 400 });
    }
    const cleanUsername = username.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9_-]{2,29}$/.test(cleanUsername)) {
      return NextResponse.json(
        { error: 'Username must be 3-30 characters and use letters, numbers, hyphens, or underscores' },
        { status: 400 },
      );
    }
    if (typeof email !== 'string' || !email.trim()) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 },
      );
    }

    const normalizedInviteCode =
      typeof inviteCode === 'string' ? normalizeInviteCode(inviteCode) : '';

    if (!normalizedInviteCode) {
      return NextResponse.json({ error: 'Invite code is required' }, { status: 400 });
    }

    const invite = normalizedInviteCode
      ? (db
          .prepare('SELECT id, used_at FROM invite_codes WHERE code = ?')
          .get(normalizedInviteCode) as InviteRow | undefined)
      : undefined;

    if (normalizedInviteCode && (!invite || invite.used_at)) {
      return NextResponse.json({ error: 'Invite code is invalid or already used' }, { status: 403 });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    try {
      const createUser = db.transaction(() => {
        const result = db.prepare(
          'INSERT INTO users (username, email, password_hash, created_at) VALUES (?, ?, ?, ?)',
        ).run(cleanUsername, email.toLowerCase().trim(), passwordHash, new Date().toISOString());

        const userId = Number(result.lastInsertRowid);

        if (invite) {
          const inviteUpdate = db.prepare(
            'UPDATE invite_codes SET used_by_user_id = ?, used_at = ? WHERE id = ? AND used_at IS NULL',
          ).run(userId, new Date().toISOString(), invite.id);

          if (inviteUpdate.changes !== 1) {
            throw new Error('Invite code is invalid or already used');
          }
        }
      });

      createUser();
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        'code' in err &&
        (err as { code: string }).code === 'SQLITE_CONSTRAINT_UNIQUE'
      ) {
        const existingEmail = db
          .prepare('SELECT 1 FROM users WHERE email = ?')
          .get(email.toLowerCase().trim());
        return NextResponse.json(
          { error: existingEmail ? 'Email already in use' : 'Username already in use' },
          { status: 409 },
        );
      }
      if (err instanceof Error && err.message === 'Invite code is invalid or already used') {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      throw err;
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
