import { NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import db from '@/lib/db';
import { countUsers } from '@/lib/first-account';
import { normalizeName } from '@/lib/profile/identity-store';

/** Creates the computer's one account the first time Breadboard opens. */
export async function POST(request: Request) {
  try {
    const { name, password } = await request.json() as { name?: unknown; password?: unknown };
    const cleanName = normalizeName(name);
    if (!cleanName) return NextResponse.json({ error: 'Enter your name.' }, { status: 400 });
    if (typeof password !== 'string' || password.length < 4) {
      return NextResponse.json({ error: 'Use at least 4 characters.' }, { status: 400 });
    }
    // Usernames and emails are internal keys now; nobody types them.
    const username = cleanName.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'me';
    const passwordHash = await bcrypt.hash(password, 12);

    const created = db.transaction(() => {
      if (countUsers() > 0) return false;
      db.prepare(
        'INSERT INTO users (username, email, password_hash, first_name, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(username, `${username}@breadboard.local`, passwordHash, cleanName, new Date().toISOString());
      return true;
    })();
    if (!created) return NextResponse.json({ error: 'This computer already has an account.' }, { status: 409 });
    return NextResponse.json({ success: true }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 500 });
  }
}
