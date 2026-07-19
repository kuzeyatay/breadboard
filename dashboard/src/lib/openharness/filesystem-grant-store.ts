// Application-bound filesystem grant store.
//
// Kept separate from `filesystem-grants.ts` so importing the authorization
// logic (in tests, or in any pure context) never opens brain.db.

import db from "@/lib/db";
import {
  createFilesystemGrantStore,
  type FilesystemGrantStore,
  type FilesystemOperation,
  type GrantRequest,
} from "./filesystem-grants.ts";

interface DatabaseHandle {
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number };
  };
}

let bound: FilesystemGrantStore | null = null;

function store(): FilesystemGrantStore {
  bound ??= createFilesystemGrantStore(db as unknown as DatabaseHandle);
  return bound;
}

export const grantFilesystemRoot = (request: GrantRequest) => store().grant(request);
export const listFilesystemGrants = (userId: number, includeRevoked = false) =>
  store().list(userId, includeRevoked);
export const revokeFilesystemGrant = (userId: number, grantId: string) =>
  store().revoke(userId, grantId);
export const expireOneTimeGrants = (userId: number) => store().expireOneTime(userId);
export const authorizePath = (
  userId: number,
  requestedPath: string,
  operation: FilesystemOperation,
) => store().authorize(userId, requestedPath, operation);
export const resolveGrantForAlias = (userId: number, alias: string) =>
  store().resolveAlias(userId, alias);
