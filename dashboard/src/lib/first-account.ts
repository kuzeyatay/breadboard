import db from '@/lib/db';

/**
 * A desktop install serves the dashboard on loopback only, and nobody can hand
 * the person an invite code before they have an account to read it from. While
 * such an install has no users yet, the first account is created without one;
 * the invite code in the desktop Help menu stays the way to add a second.
 *
 * Hosted deployments never set the flag and keep the invite-only flow.
 */
export function firstAccountOpen(): boolean {
  if (process.env.BREADBOARD_OPEN_FIRST_ACCOUNT !== '1') return false;
  return countUsers() === 0;
}

export function countUsers(): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  return row.count;
}
