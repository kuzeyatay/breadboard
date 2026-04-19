import crypto from 'crypto';

export function normalizeInviteCode(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

export function formatInviteCode(code: string): string {
  const normalized = normalizeInviteCode(code);
  const groups = normalized.match(/.{1,4}/g) ?? [];
  return groups.join('-');
}

export function createInviteCode(): string {
  return `SB${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
}
