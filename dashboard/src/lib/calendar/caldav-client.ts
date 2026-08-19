// A CalDAV client, in the shape this app actually needs.
//
// Subscribing to a calendar (./subscription.ts) is a plain GET of an ICS
// document. Two-way sync is the other half, and it needs the parts of RFC 4791
// that let a client find collections, notice what changed, and write back:
//
//   PROPFIND  current-user-principal → calendar-home-set → the collections
//   PROPFIND  getctag  — "has anything in this collection changed at all?"
//   PROPFIND  getetag  — "which objects changed?", one line per object
//   REPORT    calendar-multiget — fetch those objects in a single round trip
//   PUT/DELETE with If-Match — write back without clobbering a newer version
//
// Everything here is stateless and takes an injected `fetch`, so the sync layer
// above can be tested against a scripted server rather than a real one.

import { normalizeSubscriptionUrl } from "./ics.ts";
import { descendants, parseMultistatus, textOf, type XmlNode } from "./caldav-xml.ts";

export const CALDAV_TIMEOUT_MS = 20_000;

/** A calendar collection of any realistic size fits well inside this. */
export const MAX_CALDAV_RESPONSE_BYTES = 16 * 1024 * 1024;

/** Objects fetched per calendar-multiget. Keeps one request from going huge. */
export const MULTIGET_BATCH = 50;

export class CaldavError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "CaldavError";
    this.status = status;
  }
}

export interface CaldavAccount {
  /** The server address as the user typed it: a base URL, home or collection. */
  url: string;
  username: string;
  password: string;
}

export interface CaldavOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** A calendar collection on the server. */
export interface RemoteCalendar {
  /** Absolute URL of the collection. */
  href: string;
  name: string;
  color: string | null;
  /** True when the server says we may read but not write. */
  readOnly: boolean;
  /** Collection tag: changes whenever anything inside the collection changes. */
  ctag: string | null;
}

/** One calendar object resource — in practice one VCALENDAR, one UID. */
export interface RemoteObject {
  href: string;
  etag: string | null;
  ics: string;
}

const XML_HEADER = '<?xml version="1.0" encoding="utf-8" ?>';
const NS = 'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/"';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function authorization(account: CaldavAccount): string {
  return `Basic ${Buffer.from(`${account.username}:${account.password}`, "utf8").toString("base64")}`;
}

interface DavReply {
  status: number;
  body: string;
  etag: string | null;
  headers: Headers;
}

async function davRequest(
  account: CaldavAccount,
  url: string,
  init: { method: string; depth?: "0" | "1"; body?: string; headers?: Record<string, string> },
  options: CaldavOptions = {},
): Promise<DavReply> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? CALDAV_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      method: init.method,
      headers: {
        Authorization: authorization(account),
        ...(init.depth ? { Depth: init.depth } : {}),
        ...(init.body ? { "Content-Type": "application/xml; charset=utf-8" } : {}),
        ...init.headers,
      },
      body: init.body,
      redirect: "follow",
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      throw new CaldavError(
        401,
        "The server did not accept that username and password. App passwords often work where the account password does not.",
      );
    }

    const body = response.status === 204 ? "" : await response.text();
    if (body.length > MAX_CALDAV_RESPONSE_BYTES) {
      throw new CaldavError(413, "That calendar is too large to sync.");
    }

    return {
      status: response.status,
      body,
      etag: response.headers.get("etag"),
      headers: response.headers,
    };
  } catch (error) {
    if (error instanceof CaldavError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new CaldavError(504, "The calendar server took too long to answer.");
    }
    throw new CaldavError(502, "Could not reach the calendar server.");
  } finally {
    clearTimeout(timer);
  }
}

/** Hrefs come back as paths far more often than as absolute URLs. */
export function resolveHref(base: string, href: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function propfind(props: string): string {
  return `${XML_HEADER}<d:propfind ${NS}><d:prop>${props}</d:prop></d:propfind>`;
}

/** Does this response describe a collection whose contents are calendar events? */
function isCalendarCollection(resourcetype: XmlNode | null): boolean {
  return descendants(resourcetype, "calendar").length > 0;
}

/**
 * Whether the server said we may write here.
 *
 * A server that does not report privileges at all is treated as writable: most
 * do not send `current-user-privilege-set` unless asked in exactly the right
 * way, and refusing to write to every calendar on a quiet server would break
 * the feature for the servers that work fine.
 */
function isWritable(privileges: XmlNode | null): boolean {
  if (!privileges) return true;
  const names = descendants(privileges, "privilege").flatMap((privilege) =>
    privilege.children.map((node) => node.name),
  );
  if (!names.length) return true;
  return names.some((name) => name === "write" || name === "write-content" || name === "all");
}

/** VEVENT support, defaulting to yes when the server does not say. */
function supportsEvents(componentSet: XmlNode | null): boolean {
  if (!componentSet) return true;
  const comps = descendants(componentSet, "comp")
    .map((comp) => (comp.attrs.name ?? "").toUpperCase())
    .filter(Boolean);
  return comps.length === 0 || comps.includes("VEVENT");
}

async function findPrincipal(
  account: CaldavAccount,
  url: string,
  options: CaldavOptions,
): Promise<string | null> {
  const reply = await davRequest(
    account,
    url,
    { method: "PROPFIND", depth: "0", body: propfind("<d:current-user-principal/>") },
    options,
  );
  if (reply.status >= 400) return null;

  for (const response of parseMultistatus(reply.body)) {
    const principal = response.props.get("current-user-principal");
    const href = textOf(descendants(principal ?? null, "href")[0] ?? null);
    if (href) return resolveHref(url, href);
  }
  return null;
}

async function findCalendarHome(
  account: CaldavAccount,
  principalUrl: string,
  options: CaldavOptions,
): Promise<string | null> {
  const reply = await davRequest(
    account,
    principalUrl,
    { method: "PROPFIND", depth: "0", body: propfind("<c:calendar-home-set/>") },
    options,
  );
  if (reply.status >= 400) return null;

  for (const response of parseMultistatus(reply.body)) {
    const home = response.props.get("calendar-home-set");
    const href = textOf(descendants(home ?? null, "href")[0] ?? null);
    if (href) return resolveHref(principalUrl, href);
  }
  return null;
}

async function listCollections(
  account: CaldavAccount,
  homeUrl: string,
  options: CaldavOptions,
): Promise<RemoteCalendar[]> {
  const reply = await davRequest(
    account,
    homeUrl,
    {
      method: "PROPFIND",
      depth: "1",
      body: propfind(
        "<d:resourcetype/><d:displayname/><cs:getctag/>" +
          "<c:supported-calendar-component-set/><d:current-user-privilege-set/>" +
          "<ical:calendar-color xmlns:ical=\"http://apple.com/ns/ical/\"/>",
      ),
    },
    options,
  );
  if (reply.status >= 400) return [];

  const calendars: RemoteCalendar[] = [];
  for (const response of parseMultistatus(reply.body)) {
    if (!isCalendarCollection(response.props.get("resourcetype") ?? null)) continue;
    if (!supportsEvents(response.props.get("supported-calendar-component-set") ?? null)) continue;

    const href = resolveHref(homeUrl, response.href);
    const name = textOf(response.props.get("displayname") ?? null);
    const color = textOf(response.props.get("calendar-color") ?? null) || null;

    calendars.push({
      href,
      // A nameless collection still has to be pickable in a list, and its last
      // path segment is what every other client falls back to.
      name: name || decodeURIComponent(href.replace(/\/+$/, "").split("/").pop() || "Calendar"),
      color,
      readOnly: !isWritable(response.props.get("current-user-privilege-set") ?? null),
      ctag: textOf(response.props.get("getctag") ?? null) || null,
    });
  }
  return calendars;
}

/**
 * Every calendar collection the account can see.
 *
 * The user is asked for one address, and which address they have depends on
 * which client told them: a server root, their principal, their calendar home,
 * or one specific calendar. All four are made to work — discovery walks
 * forward from whatever it was given, and falls back to treating that address
 * as the home when the server does not advertise a principal.
 */
export async function discoverCalendars(
  account: CaldavAccount,
  options: CaldavOptions = {},
): Promise<RemoteCalendar[]> {
  // A typo in the address is the most likely way this fails on a first run, so
  // it is reported as a bad request with the reason rather than as a surprise.
  let base: string;
  try {
    base = normalizeSubscriptionUrl(account.url).toString();
  } catch (error) {
    throw new CaldavError(400, error instanceof Error ? error.message : "Bad URL");
  }

  let principal = await findPrincipal(account, base, options);
  if (!principal) {
    const wellKnown = new URL("/.well-known/caldav", base).toString();
    principal = await findPrincipal(account, wellKnown, options);
  }

  const home = principal ? await findCalendarHome(account, principal, options) : null;

  const fromHome = home ? await listCollections(account, home, options) : [];
  if (fromHome.length) return fromHome;

  // Either the server told us nothing useful, or the address the user pasted is
  // itself the home — or one calendar, which a Depth: 1 PROPFIND still reports.
  return listCollections(account, base, options);
}

/**
 * The collection's ctag, which changes whenever anything inside it does.
 *
 * This is the cheap half of sync: an unchanged ctag means the whole listing
 * step can be skipped. Servers that do not implement it return null, and the
 * caller then lists etags every time, which is correct but chattier.
 */
export async function readCtag(
  account: CaldavAccount,
  collectionHref: string,
  options: CaldavOptions = {},
): Promise<string | null> {
  const reply = await davRequest(
    account,
    collectionHref,
    { method: "PROPFIND", depth: "0", body: propfind("<cs:getctag/>") },
    options,
  );
  if (reply.status >= 400) return null;

  for (const response of parseMultistatus(reply.body)) {
    const ctag = textOf(response.props.get("getctag") ?? null);
    if (ctag) return ctag;
  }
  return null;
}

/**
 * Every object in the collection and its current etag, keyed by absolute href.
 *
 * The collection itself comes back in the same Depth: 1 listing and is dropped:
 * it is a collection, not an event, and it has no etag of its own.
 */
export async function listRemoteEtags(
  account: CaldavAccount,
  collectionHref: string,
  options: CaldavOptions = {},
): Promise<Map<string, string>> {
  const reply = await davRequest(
    account,
    collectionHref,
    { method: "PROPFIND", depth: "1", body: propfind("<d:getetag/><d:resourcetype/>") },
    options,
  );
  if (reply.status >= 400) {
    throw new CaldavError(reply.status, "The calendar server refused to list that calendar.");
  }

  const etags = new Map<string, string>();
  const collection = resolveHref(collectionHref, collectionHref).replace(/\/+$/, "");

  for (const response of parseMultistatus(reply.body)) {
    if (!response.href) continue;
    const href = resolveHref(collectionHref, response.href);
    if (href.replace(/\/+$/, "") === collection) continue;
    if (descendants(response.props.get("resourcetype") ?? null, "collection").length) continue;

    const etag = textOf(response.props.get("getetag") ?? null);
    etags.set(href, etag);
  }
  return etags;
}

/** Fetch objects by href, in batches, with their calendar data. */
export async function fetchRemoteObjects(
  account: CaldavAccount,
  collectionHref: string,
  hrefs: readonly string[],
  options: CaldavOptions = {},
): Promise<RemoteObject[]> {
  const objects: RemoteObject[] = [];

  for (let start = 0; start < hrefs.length; start += MULTIGET_BATCH) {
    const batch = hrefs.slice(start, start + MULTIGET_BATCH);
    const body =
      `${XML_HEADER}<c:calendar-multiget ${NS}>` +
      "<d:prop><d:getetag/><c:calendar-data/></d:prop>" +
      batch.map((href) => `<d:href>${escapeXml(href)}</d:href>`).join("") +
      "</c:calendar-multiget>";

    const reply = await davRequest(
      account,
      collectionHref,
      { method: "REPORT", depth: "1", body },
      options,
    );

    // Not every server implements calendar-multiget. A plain GET per object is
    // slower but universal, so it is worth falling back to rather than failing.
    if (reply.status === 415 || reply.status === 501 || reply.status >= 500) {
      for (const href of batch) {
        const single = await davRequest(account, href, { method: "GET" }, options);
        if (single.status >= 400) continue;
        objects.push({ href, etag: single.etag, ics: single.body });
      }
      continue;
    }
    if (reply.status >= 400) {
      throw new CaldavError(reply.status, "The calendar server refused to send those events.");
    }

    for (const response of parseMultistatus(reply.body)) {
      const ics = textOf(response.props.get("calendar-data") ?? null);
      if (!ics) continue;
      objects.push({
        href: resolveHref(collectionHref, response.href),
        etag: textOf(response.props.get("getetag") ?? null) || null,
        ics,
      });
    }
  }

  return objects;
}

export interface WriteResult {
  etag: string | null;
  /** The server has a version we did not base this write on. */
  conflict: boolean;
}

/**
 * Write one calendar object.
 *
 * `etag` is the version this write is based on. Sending it as If-Match is what
 * makes the write safe: if the object changed on the server since we read it,
 * the server answers 412 and our copy loses instead of silently overwriting
 * someone else's edit. A new object uses If-None-Match: * for the same reason,
 * one step earlier — it must not overwrite an object we did not know existed.
 */
export async function putRemoteObject(
  account: CaldavAccount,
  href: string,
  ics: string,
  options: CaldavOptions & { etag?: string | null } = {},
): Promise<WriteResult> {
  const reply = await davRequest(
    account,
    href,
    {
      method: "PUT",
      body: ics,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        ...(options.etag ? { "If-Match": options.etag } : { "If-None-Match": "*" }),
      },
    },
    options,
  );

  if (reply.status === 412 || reply.status === 409) return { etag: null, conflict: true };
  if (reply.status >= 400) {
    throw new CaldavError(reply.status, "The calendar server refused that change.");
  }
  return { etag: reply.etag, conflict: false };
}

export interface DeleteResult {
  conflict: boolean;
}

/**
 * Remove one calendar object. A 404 counts as success: the goal was for the
 * object not to be there, and it is not there.
 */
export async function deleteRemoteObject(
  account: CaldavAccount,
  href: string,
  options: CaldavOptions & { etag?: string | null } = {},
): Promise<DeleteResult> {
  const reply = await davRequest(
    account,
    href,
    {
      method: "DELETE",
      headers: options.etag ? { "If-Match": options.etag } : {},
    },
    options,
  );

  if (reply.status === 412) return { conflict: true };
  if (reply.status === 404 || reply.status === 410) return { conflict: false };
  if (reply.status >= 400) {
    throw new CaldavError(reply.status, "The calendar server refused that deletion.");
  }
  return { conflict: false };
}

/** Where a new object goes: the collection, plus a name derived from its UID. */
export function objectHrefForUid(collectionHref: string, uid: string): string {
  const base = collectionHref.endsWith("/") ? collectionHref : `${collectionHref}/`;
  return `${base}${encodeURIComponent(uid)}.ics`;
}
