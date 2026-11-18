import db from '@/lib/db';
import { parseComposerSwitches } from '@/lib/hermes/composer-switches';

export interface LocalOwner {
  id: number;
  email: string;
  password_hash: string;
  name: string;
}

/**
 * Breadboard has one account per computer: the first one made on it. Older
 * installs can hold more rows; only the first one signs in.
 */
export function localOwner(): LocalOwner | undefined {
  return db.prepare(
    `SELECT id, email, password_hash,
            COALESCE(NULLIF(nickname, ''), NULLIF(first_name, ''), username) AS name
       FROM users ORDER BY id LIMIT 1`,
  ).get() as LocalOwner | undefined;
}

export function countUsers(): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  return row.count;
}

/**
 * On unless the owner turned it off in Settings. Only the desktop app, which
 * serves the dashboard on loopback, may skip it; a hosted server always asks.
 */
export function askPasswordAtStartup(userId: number): boolean {
  if (process.env.BREADBOARD_LOCAL_ACCOUNT !== '1') return true;
  const row = db.prepare('SELECT composer_switches FROM hermes_user_settings WHERE user_id = ?')
    .get(userId) as { composer_switches: string | null } | undefined;
  return parseComposerSwitches(row?.composer_switches).askPasswordAtStartup !== false;
}
