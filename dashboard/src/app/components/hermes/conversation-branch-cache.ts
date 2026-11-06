import { branchTurnBounds, type BranchableMessage, type ConversationBranchGroup } from "./conversation-branches.ts";

export const BRANCH_STORAGE_PREFIX = "breadboard:conversation-branches:";
type BranchGroups<T extends BranchableMessage> = Record<string, ConversationBranchGroup<T>>;
const DATABASE = "breadboard-conversation-branches";
const STORE = "conversations";
let database: Promise<IDBDatabase> | undefined;

/** Branch arrows replace one turn; unrelated PDF attachments need no copies. */
export function compactConversationBranches<T extends BranchableMessage>(groups: BranchGroups<T>): BranchGroups<T> {
  return Object.fromEntries(Object.entries(groups).map(([key, group]) => [key, {
    ...group,
    variants: group.variants.map(messages => {
      const bounds = branchTurnBounds(messages, group.id);
      // Preserve legacy snapshots whose anchor cannot be resolved safely.
      if (!bounds) return messages;
      const turn = messages.slice(bounds.start, bounds.end);
      // Legacy messages may use their original transcript index as identity.
      // Keep that anchor when the turn moves to index zero in the cache.
      turn[0] = { ...turn[0], branchGroupId: group.id };
      return turn;
    }),
  }]));
}

function normalizeGroups<T extends BranchableMessage>(value: unknown): BranchGroups<T> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, group]) =>
    group && typeof group.id === "string" && Number.isInteger(group.activeIndex) &&
    Array.isArray(group.variants) && group.variants.length > 1 &&
    group.activeIndex >= 0 && group.activeIndex < group.variants.length &&
    group.variants.every((variant: unknown) => Array.isArray(variant) && variant.every(message =>
      message && typeof message.role === "string" && typeof message.content === "string")),
  ));
}

function openDatabase(): Promise<IDBDatabase> {
  return database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); database = undefined; };
      resolve(db);
    };
  }).catch(error => { database = undefined; throw error; });
}

/** IndexedDB does not broadcast entire attachment snapshots to every open tab. */
export async function saveConversationBranches<T extends BranchableMessage>(sessionId: string, groups: BranchGroups<T>): Promise<void> {
  const db = await openDatabase();
  const snapshot = compactConversationBranches(groups);
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
    transaction.objectStore(STORE).put(snapshot, sessionId);
  });
}

export async function loadConversationBranches<T extends BranchableMessage>(sessionId: string): Promise<BranchGroups<T>> {
  let legacyRaw: string | null = null;
  let legacy: BranchGroups<T> = {};
  try {
    legacyRaw = localStorage.getItem(BRANCH_STORAGE_PREFIX + sessionId);
    legacy = normalizeGroups<T>(JSON.parse(legacyRaw ?? "{}"));
  } catch { /* An invalid old cache must not prevent opening the chat. */ }
  try {
    const db = await openDatabase();
    const saved = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(sessionId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const groups = compactConversationBranches({ ...legacy, ...normalizeGroups<T>(saved) });
    if (legacyRaw !== null) {
      await saveConversationBranches(sessionId, groups);
      // Only retire the exact legacy snapshot that was successfully migrated.
      if (localStorage.getItem(BRANCH_STORAGE_PREFIX + sessionId) === legacyRaw) {
        localStorage.removeItem(BRANCH_STORAGE_PREFIX + sessionId);
      }
    }
    return groups;
  } catch {
    // Keep the original cache intact if IndexedDB is unavailable or full.
    return compactConversationBranches(legacy);
  }
}
