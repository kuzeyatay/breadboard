import type { ConnectedAppProxyRequest } from "../connected-apps/types.ts";
import { ApiError } from "../hermes/route-core.ts";

// The exported identifier is retained for source compatibility; agents see a
// provider-neutral built-in namespace.
export const NANGO_RUNTIME_NAME = "connected-apps";

export type NangoActionRisk = "read" | "write";

export interface NangoActionInputSchema {
  type: "object";
  properties: Record<string, Record<string, unknown>>;
  required?: string[];
  additionalProperties: boolean;
}

export interface NangoActionDefinition {
  name: string;
  title: string;
  description: string;
  /**
   * Fixed for provider-specific actions and null for universal provider
   * actions, whose target connection is supplied in the input.
   */
  fixedConnectionSlug: string | null;
  risk: NangoActionRisk;
  readOnly: boolean;
  isReadOnly: boolean;
  inputSchema: NangoActionInputSchema;
  /** Compact, system-prompt-friendly description of accepted arguments. */
  argumentDescription: string;
  /** Alias retained for consumers that render an `arguments` field. */
  arguments: string;
  connectionSlug(args: unknown): string;
  resolveConnectionSlug(args: unknown): string;
  buildRequest(args: unknown): ConnectedAppProxyRequest;
}

export interface NangoActionSummary {
  name: string;
  title: string;
  description: string;
  fixedConnectionSlug: string | null;
  risk: NangoActionRisk;
  readOnly: boolean;
  isReadOnly: boolean;
  inputSchema: NangoActionInputSchema;
  argumentDescription: string;
  arguments: string;
}

export interface NangoActionInvocation {
  action: NangoActionDefinition;
  connectionSlug: string;
  request: ConnectedAppProxyRequest;
}

type Args = Record<string, unknown>;
type ActionBuilder = (args: Args) => ConnectedAppProxyRequest;

const MAX_TEXT_LENGTH = 200_000;
const MAX_GENERIC_BODY_BYTES = 240_000;
const CONNECTION_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;
const IDENTIFIER_RE = /^[A-Za-z0-9_.:@+-]{1,500}$/;

const stringProperty = (
  description: string,
  options: Record<string, unknown> = {},
): Record<string, unknown> => ({
  type: "string",
  description,
  ...options,
});

const integerProperty = (
  description: string,
  minimum: number,
  maximum: number,
): Record<string, unknown> => ({
  type: "integer",
  description,
  minimum,
  maximum,
});

const booleanProperty = (description: string): Record<string, unknown> => ({
  type: "boolean",
  description,
});

const stringArrayProperty = (
  description: string,
  maxItems = 100,
): Record<string, unknown> => ({
  type: "array",
  description,
  items: { type: "string" },
  maxItems,
});

const objectProperty = (description: string): Record<string, unknown> => ({
  type: "object",
  description,
  additionalProperties: true,
});

const jsonProperty = (description: string): Record<string, unknown> => ({
  description,
});

const arrayProperty = (description: string): Record<string, unknown> => ({
  type: "array",
  description,
  items: {},
});

function schema(
  properties: Record<string, Record<string, unknown>>,
  required: string[] = [],
): NangoActionInputSchema {
  return {
    type: "object",
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  };
}

function describeArguments(input: NangoActionInputSchema): string {
  const required = new Set(input.required ?? []);
  const entries = Object.entries(input.properties);
  if (!entries.length) return "No arguments.";
  return entries
    .map(([name, property]) => {
      const description =
        typeof property.description === "string"
          ? property.description.trim()
          : "";
      return `${name}${required.has(name) ? " (required)" : " (optional)"}${description ? `: ${description}` : ""}`;
    })
    .join(" ");
}

function invalid(field: string, message: string): never {
  throw new ApiError(
    400,
    "invalid_nango_action_arguments",
    `Field "${field}" ${message}.`,
  );
}

function argsRecord(value: unknown): Args {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(
      400,
      "invalid_nango_action_arguments",
      "Connected-app action arguments must be a JSON object.",
    );
  }
  return value as Args;
}

function only(args: Args, names: readonly string[]): void {
  const allowed = new Set(names);
  const unexpected = Object.keys(args).find((key) => !allowed.has(key));
  if (unexpected) invalid(unexpected, "is not supported");
}

function requiredString(
  args: Args,
  field: string,
  maxLength = 10_000,
): string {
  const value = args[field];
  if (typeof value !== "string" || !value.trim()) {
    return invalid(field, "is required");
  }
  if (value.length > maxLength) return invalid(field, "is too long");
  return value.trim();
}

function optionalString(
  args: Args,
  field: string,
  maxLength = 10_000,
): string | undefined {
  const value = args[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") return invalid(field, "must be text");
  if (value.length > maxLength) return invalid(field, "is too long");
  const normalized = value.trim();
  return normalized || undefined;
}

function identifier(args: Args, field: string): string {
  const value = requiredString(args, field, 500);
  if (!IDENTIFIER_RE.test(value)) {
    return invalid(field, "contains unsupported characters");
  }
  return value;
}

function optionalInteger(
  args: Args,
  field: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const value = args[field];
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return invalid(
      field,
      `must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function optionalBoolean(args: Args, field: string): boolean | undefined {
  const value = args[field];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") return invalid(field, "must be true or false");
  return value;
}

function optionalStringArray(
  args: Args,
  field: string,
  maxItems = 100,
  maxItemLength = 1_000,
): string[] | undefined {
  const value = args[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxItems) {
    return invalid(field, `must be a list of at most ${maxItems} text values`);
  }
  const normalized = value.map((item) => {
    if (
      typeof item !== "string" ||
      !item.trim() ||
      item.length > maxItemLength
    ) {
      return invalid(field, "contains an invalid text value");
    }
    return item.trim();
  });
  return normalized;
}

function requiredObject(args: Args, field: string): Record<string, unknown> {
  const value = args[field];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid(field, "must be an object");
  }
  assertJsonSafe(value, field);
  return value as Record<string, unknown>;
}

function optionalObject(
  args: Args,
  field: string,
): Record<string, unknown> | undefined {
  const value = args[field];
  if (value === undefined) return undefined;
  return requiredObject(args, field);
}

function optionalArray(args: Args, field: string): unknown[] | undefined {
  const value = args[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return invalid(field, "must be a list");
  assertJsonSafe(value, field);
  return value;
}

function optionalJson(args: Args, field: string): unknown {
  const value = args[field];
  if (value === undefined) return undefined;
  assertJsonSafe(value, field);
  return value;
}

function assertJsonSafe(
  value: unknown,
  field: string,
  depth = 0,
  seen = new Set<object>(),
): void {
  if (depth > 16) return invalid(field, "is nested too deeply");
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    if (typeof value === "string" && value.length > MAX_TEXT_LENGTH) {
      invalid(field, "contains text that is too long");
    }
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid(field, "contains an invalid number");
    return;
  }
  if (typeof value !== "object") {
    return invalid(field, "must contain only JSON values");
  }
  if (seen.has(value)) return invalid(field, "must not contain cycles");
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > 5_000) invalid(field, "contains too many values");
    for (const item of value) assertJsonSafe(item, field, depth + 1, seen);
  } else {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 5_000) invalid(field, "contains too many fields");
    for (const [key, nested] of entries) {
      if (
        key === "__proto__" ||
        key === "prototype" ||
        key === "constructor"
      ) {
        invalid(field, "contains an unsafe field name");
      }
      assertJsonSafe(nested, field, depth + 1, seen);
    }
  }
  seen.delete(value);
}

function ensureBodySize(value: unknown, field = "body"): void {
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > MAX_GENERIC_BODY_BYTES) {
    invalid(field, "is too large");
  }
}

function pathSegment(value: string): string {
  return encodeURIComponent(value);
}

function contentPath(value: string): string {
  const normalized = value.trim().replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized.length > 2_000) {
    return invalid("path", "is invalid");
  }
  const segments = normalized.split("/");
  if (
    segments.some(
      (segment) => !segment || segment === "." || segment === "..",
    )
  ) {
    return invalid("path", "is invalid");
  }
  return segments.map(pathSegment).join("/");
}

function compactQuery(
  values: Record<string, string | number | boolean | undefined>,
): Record<string, string | number | boolean | undefined> | undefined {
  const entries = Object.entries(values).filter(
    ([, value]) => value !== undefined,
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function withoutUndefined(
  values: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  );
}

function fixedAction(input: {
  name: string;
  title: string;
  description: string;
  connectionSlug: string;
  risk: NangoActionRisk;
  inputSchema: NangoActionInputSchema;
  build: ActionBuilder;
}): NangoActionDefinition {
  const argumentDescription = describeArguments(input.inputSchema);
  const resolveConnectionSlug = (args: unknown): string => {
    argsRecord(args);
    return input.connectionSlug;
  };
  return Object.freeze({
    name: input.name,
    title: input.title,
    description: input.description,
    fixedConnectionSlug: input.connectionSlug,
    risk: input.risk,
    readOnly: input.risk === "read",
    isReadOnly: input.risk === "read",
    inputSchema: input.inputSchema,
    argumentDescription,
    arguments: argumentDescription,
    connectionSlug: resolveConnectionSlug,
    resolveConnectionSlug,
    buildRequest(args: unknown) {
      return input.build(argsRecord(args));
    },
  });
}

function universalAction(input: {
  name: string;
  title: string;
  description: string;
  risk: NangoActionRisk;
  inputSchema: NangoActionInputSchema;
  build: ActionBuilder;
}): NangoActionDefinition {
  const argumentDescription = describeArguments(input.inputSchema);
  const resolveConnectionSlug = (argsValue: unknown): string => {
    const args = argsRecord(argsValue);
    const connection = requiredString(args, "connection", 100).toLowerCase();
    if (!CONNECTION_SLUG_RE.test(connection)) {
      return invalid("connection", "is invalid");
    }
    return connection;
  };
  return Object.freeze({
    name: input.name,
    title: input.title,
    description: input.description,
    fixedConnectionSlug: null,
    risk: input.risk,
    readOnly: input.risk === "read",
    isReadOnly: input.risk === "read",
    inputSchema: input.inputSchema,
    argumentDescription,
    arguments: argumentDescription,
    connectionSlug: resolveConnectionSlug,
    resolveConnectionSlug,
    buildRequest(args: unknown) {
      return input.build(argsRecord(args));
    },
  });
}

function noArgs(
  args: Args,
  method: ConnectedAppProxyRequest["method"],
  endpoint: string,
): ConnectedAppProxyRequest {
  only(args, []);
  return { method, endpoint };
}

function queryAction(
  args: Args,
  allowed: readonly string[],
  endpoint: string,
  query: Record<string, string | number | boolean | undefined>,
): ConnectedAppProxyRequest {
  only(args, allowed);
  return { method: "GET", endpoint, query: compactQuery(query) };
}

function newlineSafe(value: string, field: string): string {
  if (/[\r\n]/.test(value)) return invalid(field, "must not contain new lines");
  return value;
}

function emailAddressList(
  args: Args,
  field: string,
  required: boolean,
): string[] | undefined {
  const values = optionalStringArray(args, field, 100, 500);
  if (required && !values?.length) return invalid(field, "is required");
  return values?.map((value) => newlineSafe(value, field));
}

function rawGmailMessage(args: Args): string {
  const to = emailAddressList(args, "to", true) ?? [];
  const cc = emailAddressList(args, "cc", false);
  const bcc = emailAddressList(args, "bcc", false);
  const subject = newlineSafe(requiredString(args, "subject", 998), "subject");
  const body = requiredString(args, "body", MAX_TEXT_LENGTH);
  const contentType =
    optionalString(args, "contentType", 20) ?? "text/plain";
  if (!["text/plain", "text/html"].includes(contentType)) {
    invalid("contentType", "must be text/plain or text/html");
  }
  const lines = [
    `To: ${to.join(", ")}`,
    ...(cc?.length ? [`Cc: ${cc.join(", ")}`] : []),
    ...(bcc?.length ? [`Bcc: ${bcc.join(", ")}`] : []),
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    `Content-Type: ${contentType}; charset=UTF-8`,
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

const mailComposeProperties = {
  to: stringArrayProperty("Recipient email addresses.", 100),
  cc: stringArrayProperty("Optional CC recipient email addresses.", 100),
  bcc: stringArrayProperty("Optional BCC recipient email addresses.", 100),
  subject: stringProperty("Message subject.", { maxLength: 998 }),
  body: stringProperty("Plain-text or HTML message body.", {
    maxLength: MAX_TEXT_LENGTH,
  }),
  contentType: stringProperty("Body format.", {
    enum: ["text/plain", "text/html"],
    default: "text/plain",
  }),
  threadId: stringProperty(
    "Optional Gmail thread ID to keep a reply in a thread.",
  ),
};

function gmailSendBody(args: Args): Record<string, unknown> {
  const threadId = optionalString(args, "threadId", 500);
  return withoutUndefined({
    raw: rawGmailMessage(args),
    threadId,
  });
}

function calendarTemporal(
  value: string,
  allDay: boolean,
  timeZone?: string,
): Record<string, string> {
  if (allDay) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      invalid("start/end", "must use YYYY-MM-DD for an all-day event");
    }
    return { date: value };
  }
  if (!Number.isFinite(Date.parse(value))) {
    invalid("start/end", "must use an ISO 8601 date and time");
  }
  return withoutUndefined({
    dateTime: value,
    timeZone,
  }) as Record<string, string>;
}

function googleEventBody(args: Args, partial: boolean): Record<string, unknown> {
  const summary = partial
    ? optionalString(args, "summary", 10_000)
    : requiredString(args, "summary", 10_000);
  const start = optionalString(args, "start", 100);
  const end = optionalString(args, "end", 100);
  if (!partial && (!start || !end)) {
    invalid(!start ? "start" : "end", "is required");
  }
  if ((start && !end) || (!start && end)) {
    invalid("start/end", "must be supplied together");
  }
  const allDay = optionalBoolean(args, "allDay") ?? false;
  const timeZone = optionalString(args, "timeZone", 100);
  const attendeeEmails = optionalStringArray(args, "attendees", 200, 500);
  const body = withoutUndefined({
    summary,
    description: optionalString(args, "description", MAX_TEXT_LENGTH),
    location: optionalString(args, "location", 10_000),
    start: start ? calendarTemporal(start, allDay, timeZone) : undefined,
    end: end ? calendarTemporal(end, allDay, timeZone) : undefined,
    attendees: attendeeEmails?.map((email) => ({ email })),
  });
  if (partial && Object.keys(body).length === 0) {
    invalid("event", "must include at least one change");
  }
  return body;
}

function graphEventBody(args: Args, partial: boolean): Record<string, unknown> {
  const subject = partial
    ? optionalString(args, "subject", 10_000)
    : requiredString(args, "subject", 10_000);
  const start = optionalString(args, "start", 100);
  const end = optionalString(args, "end", 100);
  if (!partial && (!start || !end)) {
    invalid(!start ? "start" : "end", "is required");
  }
  if ((start && !end) || (!start && end)) {
    invalid("start/end", "must be supplied together");
  }
  if (start && !Number.isFinite(Date.parse(start))) {
    invalid("start", "must use an ISO 8601 date and time");
  }
  if (end && !Number.isFinite(Date.parse(end))) {
    invalid("end", "must use an ISO 8601 date and time");
  }
  const timeZone = optionalString(args, "timeZone", 100) ?? "UTC";
  const attendees = optionalStringArray(args, "attendees", 200, 500);
  const body = withoutUndefined({
    subject,
    body: optionalString(args, "body", MAX_TEXT_LENGTH)
      ? {
          contentType: "HTML",
          content: optionalString(args, "body", MAX_TEXT_LENGTH),
        }
      : undefined,
    location: optionalString(args, "location", 10_000)
      ? { displayName: optionalString(args, "location", 10_000) }
      : undefined,
    start: start ? { dateTime: start, timeZone } : undefined,
    end: end ? { dateTime: end, timeZone } : undefined,
    attendees: attendees?.map((address) => ({
      emailAddress: { address },
      type: "required",
    })),
  });
  if (partial && Object.keys(body).length === 0) {
    invalid("event", "must include at least one change");
  }
  return body;
}

const googleEventProperties = {
  calendarId: stringProperty("Calendar ID; defaults to primary."),
  summary: stringProperty("Event title.", { maxLength: 10_000 }),
  description: stringProperty("Optional event description.", {
    maxLength: MAX_TEXT_LENGTH,
  }),
  location: stringProperty("Optional event location."),
  start: stringProperty(
    "ISO 8601 start time, or YYYY-MM-DD when allDay is true.",
  ),
  end: stringProperty(
    "ISO 8601 end time, or YYYY-MM-DD when allDay is true.",
  ),
  allDay: booleanProperty("Treat start and end as all-day dates."),
  timeZone: stringProperty("Optional IANA time zone."),
  attendees: stringArrayProperty("Optional attendee email addresses.", 200),
};

const graphEventProperties = {
  subject: stringProperty("Event title.", { maxLength: 10_000 }),
  body: stringProperty("Optional HTML event description.", {
    maxLength: MAX_TEXT_LENGTH,
  }),
  location: stringProperty("Optional event location."),
  start: stringProperty("ISO 8601 start date and time."),
  end: stringProperty("ISO 8601 end date and time."),
  timeZone: stringProperty("Microsoft Graph time zone; defaults to UTC."),
  attendees: stringArrayProperty("Optional attendee email addresses.", 200),
};

const actions: NangoActionDefinition[] = [
  // Gmail
  fixedAction({
    name: "gmail_get_profile",
    title: "Get Gmail profile",
    description:
      "Read the connected Gmail account address and mailbox message totals.",
    connectionSlug: "gmail",
    risk: "read",
    inputSchema: schema({}),
    build: (args) =>
      noArgs(args, "GET", "/gmail/v1/users/me/profile"),
  }),
  fixedAction({
    name: "gmail_list_messages",
    title: "List Gmail messages",
    description:
      "List Gmail message IDs, optionally filtered with Gmail search syntax.",
    connectionSlug: "gmail",
    risk: "read",
    inputSchema: schema({
      query: stringProperty("Optional Gmail search query."),
      maxResults: integerProperty("Maximum messages to return.", 1, 500),
      pageToken: stringProperty("Pagination token from a previous result."),
      labelId: stringProperty("Optional single Gmail label ID."),
      includeSpamTrash: booleanProperty("Include spam and trash."),
    }),
    build: (args) =>
      queryAction(
        args,
        ["query", "maxResults", "pageToken", "labelId", "includeSpamTrash"],
        "/gmail/v1/users/me/messages",
        {
          q: optionalString(args, "query", 10_000),
          maxResults: optionalInteger(args, "maxResults", 1, 500),
          pageToken: optionalString(args, "pageToken", 2_000),
          labelIds: optionalString(args, "labelId", 500),
          includeSpamTrash: optionalBoolean(args, "includeSpamTrash"),
        },
      ),
  }),
  fixedAction({
    name: "gmail_get_message",
    title: "Get Gmail message",
    description:
      "Read a Gmail message, including headers and payload, by message ID.",
    connectionSlug: "gmail",
    risk: "read",
    inputSchema: schema(
      {
        messageId: stringProperty("Gmail message ID."),
        format: stringProperty("Response format.", {
          enum: ["minimal", "full", "raw", "metadata"],
          default: "full",
        }),
      },
      ["messageId"],
    ),
    build: (args) => {
      only(args, ["messageId", "format"]);
      const messageId = identifier(args, "messageId");
      const format = optionalString(args, "format", 20) ?? "full";
      if (!["minimal", "full", "raw", "metadata"].includes(format)) {
        invalid("format", "is invalid");
      }
      return {
        method: "GET",
        endpoint: `/gmail/v1/users/me/messages/${pathSegment(messageId)}`,
        query: { format },
      };
    },
  }),
  fixedAction({
    name: "gmail_get_thread",
    title: "Get Gmail thread",
    description: "Read every message in a Gmail thread by thread ID.",
    connectionSlug: "gmail",
    risk: "read",
    inputSchema: schema(
      {
        threadId: stringProperty("Gmail thread ID."),
        format: stringProperty("Response format.", {
          enum: ["minimal", "full", "metadata"],
          default: "full",
        }),
      },
      ["threadId"],
    ),
    build: (args) => {
      only(args, ["threadId", "format"]);
      const threadId = identifier(args, "threadId");
      const format = optionalString(args, "format", 20) ?? "full";
      if (!["minimal", "full", "metadata"].includes(format)) {
        invalid("format", "is invalid");
      }
      return {
        method: "GET",
        endpoint: `/gmail/v1/users/me/threads/${pathSegment(threadId)}`,
        query: { format },
      };
    },
  }),
  fixedAction({
    name: "gmail_modify_message",
    title: "Change Gmail labels",
    description:
      "Add or remove labels on a Gmail message, including read, starred, inbox, and archive state.",
    connectionSlug: "gmail",
    risk: "write",
    inputSchema: schema(
      {
        messageId: stringProperty("Gmail message ID."),
        addLabelIds: stringArrayProperty("Label IDs to add."),
        removeLabelIds: stringArrayProperty("Label IDs to remove."),
      },
      ["messageId"],
    ),
    build: (args) => {
      only(args, ["messageId", "addLabelIds", "removeLabelIds"]);
      const messageId = identifier(args, "messageId");
      const addLabelIds = optionalStringArray(args, "addLabelIds", 100, 500);
      const removeLabelIds = optionalStringArray(
        args,
        "removeLabelIds",
        100,
        500,
      );
      if (!addLabelIds?.length && !removeLabelIds?.length) {
        invalid("labels", "must include a label to add or remove");
      }
      return {
        method: "POST",
        endpoint: `/gmail/v1/users/me/messages/${pathSegment(messageId)}/modify`,
        body: {
          addLabelIds: addLabelIds ?? [],
          removeLabelIds: removeLabelIds ?? [],
        },
      };
    },
  }),
  fixedAction({
    name: "gmail_send_message",
    title: "Send Gmail message",
    description: "Compose and send an email from the connected Gmail account.",
    connectionSlug: "gmail",
    risk: "write",
    inputSchema: schema(mailComposeProperties, [
      "to",
      "subject",
      "body",
    ]),
    build: (args) => {
      only(args, Object.keys(mailComposeProperties));
      return {
        method: "POST",
        endpoint: "/gmail/v1/users/me/messages/send",
        body: gmailSendBody(args),
      };
    },
  }),
  fixedAction({
    name: "gmail_create_draft",
    title: "Create Gmail draft",
    description:
      "Compose an email and save it as a Gmail draft without sending it.",
    connectionSlug: "gmail",
    risk: "write",
    inputSchema: schema(mailComposeProperties, [
      "to",
      "subject",
      "body",
    ]),
    build: (args) => {
      only(args, Object.keys(mailComposeProperties));
      return {
        method: "POST",
        endpoint: "/gmail/v1/users/me/drafts",
        body: { message: gmailSendBody(args) },
      };
    },
  }),
  fixedAction({
    name: "gmail_trash_message",
    title: "Move Gmail message to trash",
    description: "Move a Gmail message to trash by message ID.",
    connectionSlug: "gmail",
    risk: "write",
    inputSchema: schema(
      { messageId: stringProperty("Gmail message ID.") },
      ["messageId"],
    ),
    build: (args) => {
      only(args, ["messageId"]);
      const messageId = identifier(args, "messageId");
      return {
        method: "POST",
        endpoint: `/gmail/v1/users/me/messages/${pathSegment(messageId)}/trash`,
      };
    },
  }),

  // Slack
  fixedAction({
    name: "slack_list_conversations",
    title: "List Slack conversations",
    description:
      "List channels and direct-message conversations visible to the connected Slack account.",
    connectionSlug: "slack",
    risk: "read",
    inputSchema: schema({
      types: stringProperty(
        "Comma-separated Slack conversation types, such as public_channel,private_channel.",
      ),
      limit: integerProperty("Maximum conversations to return.", 1, 200),
      cursor: stringProperty("Pagination cursor."),
      excludeArchived: booleanProperty("Exclude archived conversations."),
    }),
    build: (args) =>
      queryAction(
        args,
        ["types", "limit", "cursor", "excludeArchived"],
        "/conversations.list",
        {
          types: optionalString(args, "types", 200),
          limit: optionalInteger(args, "limit", 1, 200),
          cursor: optionalString(args, "cursor", 2_000),
          exclude_archived: optionalBoolean(args, "excludeArchived"),
        },
      ),
  }),
  fixedAction({
    name: "slack_get_history",
    title: "Read Slack conversation history",
    description: "Read recent messages from a Slack conversation.",
    connectionSlug: "slack",
    risk: "read",
    inputSchema: schema(
      {
        channel: stringProperty("Slack conversation ID."),
        limit: integerProperty("Maximum messages to return.", 1, 100),
        cursor: stringProperty("Pagination cursor."),
        oldest: stringProperty("Optional oldest Slack timestamp."),
        latest: stringProperty("Optional latest Slack timestamp."),
        inclusive: booleanProperty("Include messages at oldest/latest bounds."),
      },
      ["channel"],
    ),
    build: (args) =>
      queryAction(
        args,
        ["channel", "limit", "cursor", "oldest", "latest", "inclusive"],
        "/conversations.history",
        {
          channel: identifier(args, "channel"),
          limit: optionalInteger(args, "limit", 1, 100),
          cursor: optionalString(args, "cursor", 2_000),
          oldest: optionalString(args, "oldest", 100),
          latest: optionalString(args, "latest", 100),
          inclusive: optionalBoolean(args, "inclusive"),
        },
      ),
  }),
  fixedAction({
    name: "slack_get_thread",
    title: "Read Slack thread",
    description: "Read replies in a Slack message thread.",
    connectionSlug: "slack",
    risk: "read",
    inputSchema: schema(
      {
        channel: stringProperty("Slack conversation ID."),
        threadTs: stringProperty("Parent message timestamp."),
        limit: integerProperty("Maximum replies to return.", 1, 100),
        cursor: stringProperty("Pagination cursor."),
      },
      ["channel", "threadTs"],
    ),
    build: (args) =>
      queryAction(
        args,
        ["channel", "threadTs", "limit", "cursor"],
        "/conversations.replies",
        {
          channel: identifier(args, "channel"),
          ts: requiredString(args, "threadTs", 100),
          limit: optionalInteger(args, "limit", 1, 100),
          cursor: optionalString(args, "cursor", 2_000),
        },
      ),
  }),
  fixedAction({
    name: "slack_search_messages",
    title: "Search Slack messages",
    description:
      "Search Slack messages using Slack search modifiers and syntax.",
    connectionSlug: "slack",
    risk: "read",
    inputSchema: schema(
      {
        query: stringProperty("Slack message search query."),
        count: integerProperty("Maximum matches per page.", 1, 100),
        page: integerProperty("One-based result page.", 1, 100),
        sort: stringProperty("Sort field.", {
          enum: ["score", "timestamp"],
        }),
        sortDirection: stringProperty("Sort direction.", {
          enum: ["asc", "desc"],
        }),
      },
      ["query"],
    ),
    build: (args) => {
      const sort = optionalString(args, "sort", 20);
      const sortDirection = optionalString(args, "sortDirection", 20);
      if (sort && !["score", "timestamp"].includes(sort)) {
        invalid("sort", "is invalid");
      }
      if (sortDirection && !["asc", "desc"].includes(sortDirection)) {
        invalid("sortDirection", "is invalid");
      }
      return queryAction(
        args,
        ["query", "count", "page", "sort", "sortDirection"],
        "/search.messages",
        {
          query: requiredString(args, "query", 10_000),
          count: optionalInteger(args, "count", 1, 100),
          page: optionalInteger(args, "page", 1, 100),
          sort,
          sort_dir: sortDirection,
        },
      );
    },
  }),
  fixedAction({
    name: "slack_list_users",
    title: "List Slack users",
    description: "List members visible in the connected Slack workspace.",
    connectionSlug: "slack",
    risk: "read",
    inputSchema: schema({
      limit: integerProperty("Maximum users to return.", 1, 200),
      cursor: stringProperty("Pagination cursor."),
    }),
    build: (args) =>
      queryAction(args, ["limit", "cursor"], "/users.list", {
        limit: optionalInteger(args, "limit", 1, 200),
        cursor: optionalString(args, "cursor", 2_000),
      }),
  }),
  fixedAction({
    name: "slack_post_message",
    title: "Post Slack message",
    description: "Post a new message or thread reply in Slack.",
    connectionSlug: "slack",
    risk: "write",
    inputSchema: schema(
      {
        channel: stringProperty("Slack conversation ID."),
        text: stringProperty("Message text.", { maxLength: 40_000 }),
        threadTs: stringProperty("Optional parent timestamp for a reply."),
        unfurlLinks: booleanProperty("Unfurl links in the message."),
      },
      ["channel", "text"],
    ),
    build: (args) => {
      only(args, ["channel", "text", "threadTs", "unfurlLinks"]);
      return {
        method: "POST",
        endpoint: "/chat.postMessage",
        body: withoutUndefined({
          channel: identifier(args, "channel"),
          text: requiredString(args, "text", 40_000),
          thread_ts: optionalString(args, "threadTs", 100),
          unfurl_links: optionalBoolean(args, "unfurlLinks"),
        }),
      };
    },
  }),
  fixedAction({
    name: "slack_update_message",
    title: "Update Slack message",
    description: "Edit an existing Slack message.",
    connectionSlug: "slack",
    risk: "write",
    inputSchema: schema(
      {
        channel: stringProperty("Slack conversation ID."),
        messageTs: stringProperty("Message timestamp."),
        text: stringProperty("Replacement text.", { maxLength: 40_000 }),
      },
      ["channel", "messageTs", "text"],
    ),
    build: (args) => {
      only(args, ["channel", "messageTs", "text"]);
      return {
        method: "POST",
        endpoint: "/chat.update",
        body: {
          channel: identifier(args, "channel"),
          ts: requiredString(args, "messageTs", 100),
          text: requiredString(args, "text", 40_000),
        },
      };
    },
  }),
  fixedAction({
    name: "slack_delete_message",
    title: "Delete Slack message",
    description: "Delete an existing Slack message.",
    connectionSlug: "slack",
    risk: "write",
    inputSchema: schema(
      {
        channel: stringProperty("Slack conversation ID."),
        messageTs: stringProperty("Message timestamp."),
      },
      ["channel", "messageTs"],
    ),
    build: (args) => {
      only(args, ["channel", "messageTs"]);
      return {
        method: "POST",
        endpoint: "/chat.delete",
        body: {
          channel: identifier(args, "channel"),
          ts: requiredString(args, "messageTs", 100),
        },
      };
    },
  }),

  // GitHub
  fixedAction({
    name: "github_get_authenticated_user",
    title: "Get GitHub user",
    description: "Read the profile of the connected GitHub user.",
    connectionSlug: "github",
    risk: "read",
    inputSchema: schema({}),
    build: (args) => noArgs(args, "GET", "/user"),
  }),
  fixedAction({
    name: "github_list_repositories",
    title: "List GitHub repositories",
    description:
      "List repositories accessible to the connected GitHub user.",
    connectionSlug: "github",
    risk: "read",
    inputSchema: schema({
      visibility: stringProperty("Repository visibility.", {
        enum: ["all", "public", "private"],
      }),
      affiliation: stringProperty(
        "Comma-separated owner, collaborator, and organization_member filters.",
      ),
      sort: stringProperty("Sort field.", {
        enum: ["created", "updated", "pushed", "full_name"],
      }),
      direction: stringProperty("Sort direction.", {
        enum: ["asc", "desc"],
      }),
      perPage: integerProperty("Maximum repositories to return.", 1, 100),
      page: integerProperty("One-based page number.", 1, 10_000),
    }),
    build: (args) =>
      queryAction(
        args,
        [
          "visibility",
          "affiliation",
          "sort",
          "direction",
          "perPage",
          "page",
        ],
        "/user/repos",
        {
          visibility: optionalString(args, "visibility", 20),
          affiliation: optionalString(args, "affiliation", 100),
          sort: optionalString(args, "sort", 20),
          direction: optionalString(args, "direction", 10),
          per_page: optionalInteger(args, "perPage", 1, 100),
          page: optionalInteger(args, "page", 1, 10_000),
        },
      ),
  }),
  fixedAction({
    name: "github_get_repository",
    title: "Get GitHub repository",
    description: "Read metadata for a GitHub repository.",
    connectionSlug: "github",
    risk: "read",
    inputSchema: schema(
      {
        owner: stringProperty("Repository owner."),
        repo: stringProperty("Repository name."),
      },
      ["owner", "repo"],
    ),
    build: (args) => {
      only(args, ["owner", "repo"]);
      return {
        method: "GET",
        endpoint: `/repos/${pathSegment(identifier(args, "owner"))}/${pathSegment(identifier(args, "repo"))}`,
      };
    },
  }),
  fixedAction({
    name: "github_get_file_contents",
    title: "Read GitHub file",
    description:
      "Read a file or directory listing from a GitHub repository at an optional ref.",
    connectionSlug: "github",
    risk: "read",
    inputSchema: schema(
      {
        owner: stringProperty("Repository owner."),
        repo: stringProperty("Repository name."),
        path: stringProperty("Repository-relative file or directory path."),
        ref: stringProperty("Optional branch, tag, or commit SHA."),
      },
      ["owner", "repo", "path"],
    ),
    build: (args) => {
      only(args, ["owner", "repo", "path", "ref"]);
      return {
        method: "GET",
        endpoint: `/repos/${pathSegment(identifier(args, "owner"))}/${pathSegment(identifier(args, "repo"))}/contents/${contentPath(requiredString(args, "path", 2_000))}`,
        query: compactQuery({ ref: optionalString(args, "ref", 500) }),
      };
    },
  }),
  fixedAction({
    name: "github_list_issues",
    title: "List GitHub issues",
    description:
      "List issues in a repository. GitHub may also include pull requests in this endpoint.",
    connectionSlug: "github",
    risk: "read",
    inputSchema: schema(
      {
        owner: stringProperty("Repository owner."),
        repo: stringProperty("Repository name."),
        state: stringProperty("Issue state.", {
          enum: ["open", "closed", "all"],
        }),
        labels: stringProperty("Comma-separated label names."),
        assignee: stringProperty("Assignee login, none, or *."),
        since: stringProperty("ISO 8601 lower bound for updates."),
        perPage: integerProperty("Maximum issues to return.", 1, 100),
        page: integerProperty("One-based page number.", 1, 10_000),
      },
      ["owner", "repo"],
    ),
    build: (args) => {
      only(args, [
        "owner",
        "repo",
        "state",
        "labels",
        "assignee",
        "since",
        "perPage",
        "page",
      ]);
      return {
        method: "GET",
        endpoint: `/repos/${pathSegment(identifier(args, "owner"))}/${pathSegment(identifier(args, "repo"))}/issues`,
        query: compactQuery({
          state: optionalString(args, "state", 20),
          labels: optionalString(args, "labels", 2_000),
          assignee: optionalString(args, "assignee", 500),
          since: optionalString(args, "since", 100),
          per_page: optionalInteger(args, "perPage", 1, 100),
          page: optionalInteger(args, "page", 1, 10_000),
        }),
      };
    },
  }),
  fixedAction({
    name: "github_get_issue",
    title: "Get GitHub issue",
    description:
      "Read one GitHub issue or pull request by its repository issue number.",
    connectionSlug: "github",
    risk: "read",
    inputSchema: schema(
      {
        owner: stringProperty("Repository owner."),
        repo: stringProperty("Repository name."),
        issueNumber: integerProperty("Issue or pull request number.", 1, 1e9),
      },
      ["owner", "repo", "issueNumber"],
    ),
    build: (args) => {
      only(args, ["owner", "repo", "issueNumber"]);
      return {
        method: "GET",
        endpoint: `/repos/${pathSegment(identifier(args, "owner"))}/${pathSegment(identifier(args, "repo"))}/issues/${optionalInteger(args, "issueNumber", 1, 1e9) ?? invalid("issueNumber", "is required")}`,
      };
    },
  }),
  fixedAction({
    name: "github_list_pull_requests",
    title: "List GitHub pull requests",
    description: "List pull requests in a GitHub repository.",
    connectionSlug: "github",
    risk: "read",
    inputSchema: schema(
      {
        owner: stringProperty("Repository owner."),
        repo: stringProperty("Repository name."),
        state: stringProperty("Pull request state.", {
          enum: ["open", "closed", "all"],
        }),
        head: stringProperty("Optional head owner:branch filter."),
        base: stringProperty("Optional base branch filter."),
        perPage: integerProperty("Maximum pull requests to return.", 1, 100),
        page: integerProperty("One-based page number.", 1, 10_000),
      },
      ["owner", "repo"],
    ),
    build: (args) => {
      only(args, ["owner", "repo", "state", "head", "base", "perPage", "page"]);
      return {
        method: "GET",
        endpoint: `/repos/${pathSegment(identifier(args, "owner"))}/${pathSegment(identifier(args, "repo"))}/pulls`,
        query: compactQuery({
          state: optionalString(args, "state", 20),
          head: optionalString(args, "head", 500),
          base: optionalString(args, "base", 500),
          per_page: optionalInteger(args, "perPage", 1, 100),
          page: optionalInteger(args, "page", 1, 10_000),
        }),
      };
    },
  }),
  fixedAction({
    name: "github_search_code",
    title: "Search GitHub code",
    description:
      "Search code available to the connected GitHub user with GitHub search syntax.",
    connectionSlug: "github",
    risk: "read",
    inputSchema: schema(
      {
        query: stringProperty("GitHub code search query."),
        perPage: integerProperty("Maximum matches to return.", 1, 100),
        page: integerProperty("One-based page number.", 1, 10),
      },
      ["query"],
    ),
    build: (args) =>
      queryAction(
        args,
        ["query", "perPage", "page"],
        "/search/code",
        {
          q: requiredString(args, "query", 10_000),
          per_page: optionalInteger(args, "perPage", 1, 100),
          page: optionalInteger(args, "page", 1, 10),
        },
      ),
  }),
  fixedAction({
    name: "github_create_issue",
    title: "Create GitHub issue",
    description: "Create a new issue in a GitHub repository.",
    connectionSlug: "github",
    risk: "write",
    inputSchema: schema(
      {
        owner: stringProperty("Repository owner."),
        repo: stringProperty("Repository name."),
        title: stringProperty("Issue title.", { maxLength: 256 }),
        body: stringProperty("Optional issue body.", {
          maxLength: MAX_TEXT_LENGTH,
        }),
        labels: stringArrayProperty("Optional label names.", 100),
        assignees: stringArrayProperty("Optional assignee logins.", 100),
      },
      ["owner", "repo", "title"],
    ),
    build: (args) => {
      only(args, ["owner", "repo", "title", "body", "labels", "assignees"]);
      return {
        method: "POST",
        endpoint: `/repos/${pathSegment(identifier(args, "owner"))}/${pathSegment(identifier(args, "repo"))}/issues`,
        body: withoutUndefined({
          title: requiredString(args, "title", 256),
          body: optionalString(args, "body", MAX_TEXT_LENGTH),
          labels: optionalStringArray(args, "labels", 100, 500),
          assignees: optionalStringArray(args, "assignees", 100, 500),
        }),
      };
    },
  }),
  fixedAction({
    name: "github_comment_on_issue",
    title: "Comment on GitHub issue",
    description: "Add a comment to a GitHub issue or pull request.",
    connectionSlug: "github",
    risk: "write",
    inputSchema: schema(
      {
        owner: stringProperty("Repository owner."),
        repo: stringProperty("Repository name."),
        issueNumber: integerProperty("Issue or pull request number.", 1, 1e9),
        body: stringProperty("Comment body.", {
          maxLength: MAX_TEXT_LENGTH,
        }),
      },
      ["owner", "repo", "issueNumber", "body"],
    ),
    build: (args) => {
      only(args, ["owner", "repo", "issueNumber", "body"]);
      return {
        method: "POST",
        endpoint: `/repos/${pathSegment(identifier(args, "owner"))}/${pathSegment(identifier(args, "repo"))}/issues/${optionalInteger(args, "issueNumber", 1, 1e9) ?? invalid("issueNumber", "is required")}/comments`,
        body: { body: requiredString(args, "body", MAX_TEXT_LENGTH) },
      };
    },
  }),

  // Google Calendar
  fixedAction({
    name: "google_calendar_list_calendars",
    title: "List Google calendars",
    description: "List calendars visible to the connected Google account.",
    connectionSlug: "google-calendar",
    risk: "read",
    inputSchema: schema({
      maxResults: integerProperty("Maximum calendars to return.", 1, 250),
      pageToken: stringProperty("Pagination token."),
      showHidden: booleanProperty("Include hidden calendars."),
    }),
    build: (args) =>
      queryAction(
        args,
        ["maxResults", "pageToken", "showHidden"],
        "/calendar/v3/users/me/calendarList",
        {
          maxResults: optionalInteger(args, "maxResults", 1, 250),
          pageToken: optionalString(args, "pageToken", 2_000),
          showHidden: optionalBoolean(args, "showHidden"),
        },
      ),
  }),
  fixedAction({
    name: "google_calendar_list_events",
    title: "List Google Calendar events",
    description: "Read events from a Google calendar in an optional time range.",
    connectionSlug: "google-calendar",
    risk: "read",
    inputSchema: schema({
      calendarId: stringProperty("Calendar ID; defaults to primary."),
      timeMin: stringProperty("Inclusive ISO 8601 lower time bound."),
      timeMax: stringProperty("Exclusive ISO 8601 upper time bound."),
      query: stringProperty("Free-text event search query."),
      maxResults: integerProperty("Maximum events to return.", 1, 2500),
      pageToken: stringProperty("Pagination token."),
      singleEvents: booleanProperty("Expand recurring events."),
      orderBy: stringProperty("Ordering.", {
        enum: ["startTime", "updated"],
      }),
    }),
    build: (args) => {
      only(args, [
        "calendarId",
        "timeMin",
        "timeMax",
        "query",
        "maxResults",
        "pageToken",
        "singleEvents",
        "orderBy",
      ]);
      const calendarId =
        optionalString(args, "calendarId", 1_000) ?? "primary";
      return {
        method: "GET",
        endpoint: `/calendar/v3/calendars/${pathSegment(calendarId)}/events`,
        query: compactQuery({
          timeMin: optionalString(args, "timeMin", 100),
          timeMax: optionalString(args, "timeMax", 100),
          q: optionalString(args, "query", 10_000),
          maxResults: optionalInteger(args, "maxResults", 1, 2500),
          pageToken: optionalString(args, "pageToken", 2_000),
          singleEvents: optionalBoolean(args, "singleEvents"),
          orderBy: optionalString(args, "orderBy", 20),
        }),
      };
    },
  }),
  fixedAction({
    name: "google_calendar_get_event",
    title: "Get Google Calendar event",
    description: "Read one event from a Google calendar.",
    connectionSlug: "google-calendar",
    risk: "read",
    inputSchema: schema(
      {
        calendarId: stringProperty("Calendar ID; defaults to primary."),
        eventId: stringProperty("Google Calendar event ID."),
      },
      ["eventId"],
    ),
    build: (args) => {
      only(args, ["calendarId", "eventId"]);
      const calendarId =
        optionalString(args, "calendarId", 1_000) ?? "primary";
      return {
        method: "GET",
        endpoint: `/calendar/v3/calendars/${pathSegment(calendarId)}/events/${pathSegment(identifier(args, "eventId"))}`,
      };
    },
  }),
  fixedAction({
    name: "google_calendar_create_event",
    title: "Create Google Calendar event",
    description: "Create an event in a Google calendar.",
    connectionSlug: "google-calendar",
    risk: "write",
    inputSchema: schema(googleEventProperties, ["summary", "start", "end"]),
    build: (args) => {
      only(args, Object.keys(googleEventProperties));
      const calendarId =
        optionalString(args, "calendarId", 1_000) ?? "primary";
      return {
        method: "POST",
        endpoint: `/calendar/v3/calendars/${pathSegment(calendarId)}/events`,
        body: googleEventBody(args, false),
      };
    },
  }),
  fixedAction({
    name: "google_calendar_update_event",
    title: "Update Google Calendar event",
    description: "Change an existing Google Calendar event.",
    connectionSlug: "google-calendar",
    risk: "write",
    inputSchema: schema(
      {
        eventId: stringProperty("Google Calendar event ID."),
        ...googleEventProperties,
      },
      ["eventId"],
    ),
    build: (args) => {
      only(args, ["eventId", ...Object.keys(googleEventProperties)]);
      const eventId = identifier(args, "eventId");
      const calendarId =
        optionalString(args, "calendarId", 1_000) ?? "primary";
      return {
        method: "PATCH",
        endpoint: `/calendar/v3/calendars/${pathSegment(calendarId)}/events/${pathSegment(eventId)}`,
        body: googleEventBody(args, true),
      };
    },
  }),
  fixedAction({
    name: "google_calendar_delete_event",
    title: "Delete Google Calendar event",
    description: "Delete an event from a Google calendar.",
    connectionSlug: "google-calendar",
    risk: "write",
    inputSchema: schema(
      {
        calendarId: stringProperty("Calendar ID; defaults to primary."),
        eventId: stringProperty("Google Calendar event ID."),
      },
      ["eventId"],
    ),
    build: (args) => {
      only(args, ["calendarId", "eventId"]);
      const calendarId =
        optionalString(args, "calendarId", 1_000) ?? "primary";
      return {
        method: "DELETE",
        endpoint: `/calendar/v3/calendars/${pathSegment(calendarId)}/events/${pathSegment(identifier(args, "eventId"))}`,
      };
    },
  }),

  // Microsoft Outlook mail
  fixedAction({
    name: "outlook_list_messages",
    title: "List Outlook messages",
    description:
      "List messages from an Outlook mail folder using Microsoft Graph.",
    connectionSlug: "microsoft-outlook",
    risk: "read",
    inputSchema: schema({
      folderId: stringProperty("Mail folder ID; defaults to the whole mailbox."),
      top: integerProperty("Maximum messages to return.", 1, 100),
      skip: integerProperty("Number of messages to skip.", 0, 10_000),
      filter: stringProperty("Microsoft Graph OData filter."),
      search: stringProperty("Microsoft Graph message search expression."),
      orderBy: stringProperty("Microsoft Graph OData ordering."),
      select: stringProperty("Comma-separated fields to return."),
    }),
    build: (args) => {
      only(args, [
        "folderId",
        "top",
        "skip",
        "filter",
        "search",
        "orderBy",
        "select",
      ]);
      const folderId = optionalString(args, "folderId", 500);
      return {
        method: "GET",
        endpoint: folderId
          ? `/v1.0/me/mailFolders/${pathSegment(folderId)}/messages`
          : "/v1.0/me/messages",
        query: compactQuery({
          $top: optionalInteger(args, "top", 1, 100),
          $skip: optionalInteger(args, "skip", 0, 10_000),
          $filter: optionalString(args, "filter", 10_000),
          $search: optionalString(args, "search", 10_000),
          $orderby: optionalString(args, "orderBy", 2_000),
          $select: optionalString(args, "select", 2_000),
        }),
      };
    },
  }),
  fixedAction({
    name: "outlook_get_message",
    title: "Get Outlook message",
    description: "Read one Outlook email message by Microsoft Graph ID.",
    connectionSlug: "microsoft-outlook",
    risk: "read",
    inputSchema: schema(
      {
        messageId: stringProperty("Microsoft Graph message ID."),
        select: stringProperty("Comma-separated fields to return."),
      },
      ["messageId"],
    ),
    build: (args) => {
      only(args, ["messageId", "select"]);
      return {
        method: "GET",
        endpoint: `/v1.0/me/messages/${pathSegment(requiredString(args, "messageId", 1_000))}`,
        query: compactQuery({
          $select: optionalString(args, "select", 2_000),
        }),
      };
    },
  }),
  fixedAction({
    name: "outlook_send_mail",
    title: "Send Outlook message",
    description:
      "Compose and send an email from the connected Outlook account.",
    connectionSlug: "microsoft-outlook",
    risk: "write",
    inputSchema: schema(
      {
        to: stringArrayProperty("Recipient email addresses.", 100),
        cc: stringArrayProperty("Optional CC email addresses.", 100),
        bcc: stringArrayProperty("Optional BCC email addresses.", 100),
        subject: stringProperty("Message subject.", { maxLength: 998 }),
        body: stringProperty("Plain-text or HTML message body.", {
          maxLength: MAX_TEXT_LENGTH,
        }),
        contentType: stringProperty("Body format.", {
          enum: ["Text", "HTML"],
          default: "Text",
        }),
        saveToSentItems: booleanProperty("Save a copy in Sent Items."),
      },
      ["to", "subject", "body"],
    ),
    build: (args) => {
      only(args, [
        "to",
        "cc",
        "bcc",
        "subject",
        "body",
        "contentType",
        "saveToSentItems",
      ]);
      const to = emailAddressList(args, "to", true) ?? [];
      const cc = emailAddressList(args, "cc", false);
      const bcc = emailAddressList(args, "bcc", false);
      const contentType =
        optionalString(args, "contentType", 20) ?? "Text";
      if (!["Text", "HTML"].includes(contentType)) {
        invalid("contentType", "must be Text or HTML");
      }
      return {
        method: "POST",
        endpoint: "/v1.0/me/sendMail",
        body: {
          message: withoutUndefined({
            subject: newlineSafe(
              requiredString(args, "subject", 998),
              "subject",
            ),
            body: {
              contentType,
              content: requiredString(args, "body", MAX_TEXT_LENGTH),
            },
            toRecipients: to.map((address) => ({
              emailAddress: { address },
            })),
            ccRecipients: cc?.map((address) => ({
              emailAddress: { address },
            })),
            bccRecipients: bcc?.map((address) => ({
              emailAddress: { address },
            })),
          }),
          saveToSentItems:
            optionalBoolean(args, "saveToSentItems") ?? true,
        },
      };
    },
  }),
  fixedAction({
    name: "outlook_move_message",
    title: "Move Outlook message",
    description: "Move an Outlook email message to another mail folder.",
    connectionSlug: "microsoft-outlook",
    risk: "write",
    inputSchema: schema(
      {
        messageId: stringProperty("Microsoft Graph message ID."),
        destinationId: stringProperty(
          "Destination mail folder ID or well-known folder name.",
        ),
      },
      ["messageId", "destinationId"],
    ),
    build: (args) => {
      only(args, ["messageId", "destinationId"]);
      return {
        method: "POST",
        endpoint: `/v1.0/me/messages/${pathSegment(requiredString(args, "messageId", 1_000))}/move`,
        body: { destinationId: requiredString(args, "destinationId", 1_000) },
      };
    },
  }),
  fixedAction({
    name: "outlook_delete_message",
    title: "Delete Outlook message",
    description: "Delete an Outlook email message.",
    connectionSlug: "microsoft-outlook",
    risk: "write",
    inputSchema: schema(
      { messageId: stringProperty("Microsoft Graph message ID.") },
      ["messageId"],
    ),
    build: (args) => {
      only(args, ["messageId"]);
      return {
        method: "DELETE",
        endpoint: `/v1.0/me/messages/${pathSegment(requiredString(args, "messageId", 1_000))}`,
      };
    },
  }),

  // Microsoft Outlook calendar
  fixedAction({
    name: "outlook_calendar_list_events",
    title: "List Outlook calendar events",
    description:
      "Read Outlook calendar events, optionally within a calendar view time range.",
    connectionSlug: "microsoft-outlook-calendar",
    risk: "read",
    inputSchema: schema({
      start: stringProperty("ISO 8601 calendar-view start time."),
      end: stringProperty("ISO 8601 calendar-view end time."),
      top: integerProperty("Maximum events to return.", 1, 100),
      select: stringProperty("Comma-separated fields to return."),
      orderBy: stringProperty("Microsoft Graph OData ordering."),
    }),
    build: (args) => {
      only(args, ["start", "end", "top", "select", "orderBy"]);
      const start = optionalString(args, "start", 100);
      const end = optionalString(args, "end", 100);
      if ((start && !end) || (!start && end)) {
        invalid("start/end", "must be supplied together");
      }
      return {
        method: "GET",
        endpoint: start ? "/v1.0/me/calendarView" : "/v1.0/me/events",
        query: compactQuery({
          startDateTime: start,
          endDateTime: end,
          $top: optionalInteger(args, "top", 1, 100),
          $select: optionalString(args, "select", 2_000),
          $orderby: optionalString(args, "orderBy", 2_000),
        }),
      };
    },
  }),
  fixedAction({
    name: "outlook_calendar_get_event",
    title: "Get Outlook calendar event",
    description: "Read one Outlook calendar event by Microsoft Graph ID.",
    connectionSlug: "microsoft-outlook-calendar",
    risk: "read",
    inputSchema: schema(
      { eventId: stringProperty("Microsoft Graph event ID.") },
      ["eventId"],
    ),
    build: (args) => {
      only(args, ["eventId"]);
      return {
        method: "GET",
        endpoint: `/v1.0/me/events/${pathSegment(requiredString(args, "eventId", 1_000))}`,
      };
    },
  }),
  fixedAction({
    name: "outlook_calendar_create_event",
    title: "Create Outlook calendar event",
    description: "Create an event in the connected Outlook calendar.",
    connectionSlug: "microsoft-outlook-calendar",
    risk: "write",
    inputSchema: schema(graphEventProperties, ["subject", "start", "end"]),
    build: (args) => {
      only(args, Object.keys(graphEventProperties));
      return {
        method: "POST",
        endpoint: "/v1.0/me/events",
        body: graphEventBody(args, false),
      };
    },
  }),
  fixedAction({
    name: "outlook_calendar_update_event",
    title: "Update Outlook calendar event",
    description: "Change an existing Outlook calendar event.",
    connectionSlug: "microsoft-outlook-calendar",
    risk: "write",
    inputSchema: schema(
      {
        eventId: stringProperty("Microsoft Graph event ID."),
        ...graphEventProperties,
      },
      ["eventId"],
    ),
    build: (args) => {
      only(args, ["eventId", ...Object.keys(graphEventProperties)]);
      return {
        method: "PATCH",
        endpoint: `/v1.0/me/events/${pathSegment(requiredString(args, "eventId", 1_000))}`,
        body: graphEventBody(args, true),
      };
    },
  }),
  fixedAction({
    name: "outlook_calendar_delete_event",
    title: "Delete Outlook calendar event",
    description: "Delete an event from the connected Outlook calendar.",
    connectionSlug: "microsoft-outlook-calendar",
    risk: "write",
    inputSchema: schema(
      { eventId: stringProperty("Microsoft Graph event ID.") },
      ["eventId"],
    ),
    build: (args) => {
      only(args, ["eventId"]);
      return {
        method: "DELETE",
        endpoint: `/v1.0/me/events/${pathSegment(requiredString(args, "eventId", 1_000))}`,
      };
    },
  }),

  // Microsoft Teams
  fixedAction({
    name: "teams_list_joined_teams",
    title: "List joined Microsoft Teams",
    description: "List Microsoft Teams joined by the connected user.",
    connectionSlug: "microsoft-teams",
    risk: "read",
    inputSchema: schema({}),
    build: (args) => noArgs(args, "GET", "/v1.0/me/joinedTeams"),
  }),
  fixedAction({
    name: "teams_list_channels",
    title: "List Microsoft Teams channels",
    description: "List channels in a Microsoft Team.",
    connectionSlug: "microsoft-teams",
    risk: "read",
    inputSchema: schema(
      { teamId: stringProperty("Microsoft Team ID.") },
      ["teamId"],
    ),
    build: (args) => {
      only(args, ["teamId"]);
      return {
        method: "GET",
        endpoint: `/v1.0/teams/${pathSegment(requiredString(args, "teamId", 1_000))}/channels`,
      };
    },
  }),
  fixedAction({
    name: "teams_list_channel_messages",
    title: "List Microsoft Teams channel messages",
    description: "Read messages from a Microsoft Teams channel.",
    connectionSlug: "microsoft-teams",
    risk: "read",
    inputSchema: schema(
      {
        teamId: stringProperty("Microsoft Team ID."),
        channelId: stringProperty("Microsoft Teams channel ID."),
        top: integerProperty("Maximum messages to return.", 1, 50),
      },
      ["teamId", "channelId"],
    ),
    build: (args) => {
      only(args, ["teamId", "channelId", "top"]);
      return {
        method: "GET",
        endpoint: `/v1.0/teams/${pathSegment(requiredString(args, "teamId", 1_000))}/channels/${pathSegment(requiredString(args, "channelId", 1_000))}/messages`,
        query: compactQuery({
          $top: optionalInteger(args, "top", 1, 50),
        }),
      };
    },
  }),
  fixedAction({
    name: "teams_get_channel_message",
    title: "Get Microsoft Teams channel message",
    description: "Read one message from a Microsoft Teams channel.",
    connectionSlug: "microsoft-teams",
    risk: "read",
    inputSchema: schema(
      {
        teamId: stringProperty("Microsoft Team ID."),
        channelId: stringProperty("Microsoft Teams channel ID."),
        messageId: stringProperty("Microsoft Teams message ID."),
      },
      ["teamId", "channelId", "messageId"],
    ),
    build: (args) => {
      only(args, ["teamId", "channelId", "messageId"]);
      return {
        method: "GET",
        endpoint: `/v1.0/teams/${pathSegment(requiredString(args, "teamId", 1_000))}/channels/${pathSegment(requiredString(args, "channelId", 1_000))}/messages/${pathSegment(requiredString(args, "messageId", 1_000))}`,
      };
    },
  }),
  fixedAction({
    name: "teams_send_channel_message",
    title: "Send Microsoft Teams channel message",
    description: "Post a message to a Microsoft Teams channel.",
    connectionSlug: "microsoft-teams",
    risk: "write",
    inputSchema: schema(
      {
        teamId: stringProperty("Microsoft Team ID."),
        channelId: stringProperty("Microsoft Teams channel ID."),
        body: stringProperty("Message body.", {
          maxLength: MAX_TEXT_LENGTH,
        }),
        contentType: stringProperty("Message body format.", {
          enum: ["text", "html"],
          default: "text",
        }),
      },
      ["teamId", "channelId", "body"],
    ),
    build: (args) => {
      only(args, ["teamId", "channelId", "body", "contentType"]);
      const contentType =
        optionalString(args, "contentType", 20) ?? "text";
      if (!["text", "html"].includes(contentType)) {
        invalid("contentType", "must be text or html");
      }
      return {
        method: "POST",
        endpoint: `/v1.0/teams/${pathSegment(requiredString(args, "teamId", 1_000))}/channels/${pathSegment(requiredString(args, "channelId", 1_000))}/messages`,
        body: {
          body: {
            contentType,
            content: requiredString(args, "body", MAX_TEXT_LENGTH),
          },
        },
      };
    },
  }),
  fixedAction({
    name: "teams_reply_to_channel_message",
    title: "Reply to Microsoft Teams channel message",
    description: "Reply to a message in a Microsoft Teams channel.",
    connectionSlug: "microsoft-teams",
    risk: "write",
    inputSchema: schema(
      {
        teamId: stringProperty("Microsoft Team ID."),
        channelId: stringProperty("Microsoft Teams channel ID."),
        messageId: stringProperty("Parent Microsoft Teams message ID."),
        body: stringProperty("Reply body.", { maxLength: MAX_TEXT_LENGTH }),
        contentType: stringProperty("Message body format.", {
          enum: ["text", "html"],
          default: "text",
        }),
      },
      ["teamId", "channelId", "messageId", "body"],
    ),
    build: (args) => {
      only(args, [
        "teamId",
        "channelId",
        "messageId",
        "body",
        "contentType",
      ]);
      const contentType =
        optionalString(args, "contentType", 20) ?? "text";
      if (!["text", "html"].includes(contentType)) {
        invalid("contentType", "must be text or html");
      }
      return {
        method: "POST",
        endpoint: `/v1.0/teams/${pathSegment(requiredString(args, "teamId", 1_000))}/channels/${pathSegment(requiredString(args, "channelId", 1_000))}/messages/${pathSegment(requiredString(args, "messageId", 1_000))}/replies`,
        body: {
          body: {
            contentType,
            content: requiredString(args, "body", MAX_TEXT_LENGTH),
          },
        },
      };
    },
  }),

  // Notion. Search and database query use POST at the provider API, but remain
  // explicitly read-only here; authorization is based on action metadata.
  fixedAction({
    name: "notion_search",
    title: "Search Notion",
    description:
      "Search pages and data sources shared with the connected Notion integration.",
    connectionSlug: "notion",
    risk: "read",
    inputSchema: schema({
      query: stringProperty("Optional title search text."),
      filterProperty: stringProperty("Object type to return.", {
        enum: ["page", "data_source"],
      }),
      sortDirection: stringProperty("Last-edited sort direction.", {
        enum: ["ascending", "descending"],
      }),
      pageSize: integerProperty("Maximum results to return.", 1, 100),
      startCursor: stringProperty("Pagination cursor."),
    }),
    build: (args) => {
      only(args, [
        "query",
        "filterProperty",
        "sortDirection",
        "pageSize",
        "startCursor",
      ]);
      const filterProperty = optionalString(args, "filterProperty", 30);
      const sortDirection = optionalString(args, "sortDirection", 30);
      if (
        filterProperty &&
        !["page", "data_source"].includes(filterProperty)
      ) {
        invalid("filterProperty", "is invalid");
      }
      if (
        sortDirection &&
        !["ascending", "descending"].includes(sortDirection)
      ) {
        invalid("sortDirection", "is invalid");
      }
      return {
        method: "POST",
        endpoint: "/v1/search",
        body: withoutUndefined({
          query: optionalString(args, "query", 10_000),
          filter: filterProperty
            ? { property: "object", value: filterProperty }
            : undefined,
          sort: sortDirection
            ? { direction: sortDirection, timestamp: "last_edited_time" }
            : undefined,
          page_size: optionalInteger(args, "pageSize", 1, 100),
          start_cursor: optionalString(args, "startCursor", 2_000),
        }),
      };
    },
  }),
  fixedAction({
    name: "notion_get_page",
    title: "Get Notion page",
    description: "Read a Notion page and its properties by page ID.",
    connectionSlug: "notion",
    risk: "read",
    inputSchema: schema(
      { pageId: stringProperty("Notion page ID.") },
      ["pageId"],
    ),
    build: (args) => {
      only(args, ["pageId"]);
      return {
        method: "GET",
        endpoint: `/v1/pages/${pathSegment(identifier(args, "pageId"))}`,
      };
    },
  }),
  fixedAction({
    name: "notion_get_block_children",
    title: "Read Notion block children",
    description: "Read child blocks from a Notion page or block.",
    connectionSlug: "notion",
    risk: "read",
    inputSchema: schema(
      {
        blockId: stringProperty("Notion block or page ID."),
        pageSize: integerProperty("Maximum blocks to return.", 1, 100),
        startCursor: stringProperty("Pagination cursor."),
      },
      ["blockId"],
    ),
    build: (args) => {
      only(args, ["blockId", "pageSize", "startCursor"]);
      return {
        method: "GET",
        endpoint: `/v1/blocks/${pathSegment(identifier(args, "blockId"))}/children`,
        query: compactQuery({
          page_size: optionalInteger(args, "pageSize", 1, 100),
          start_cursor: optionalString(args, "startCursor", 2_000),
        }),
      };
    },
  }),
  fixedAction({
    name: "notion_query_database",
    title: "Query Notion database",
    description:
      "Read rows from a Notion database with optional Notion filter and sort objects.",
    connectionSlug: "notion",
    risk: "read",
    inputSchema: schema(
      {
        databaseId: stringProperty("Notion database ID."),
        filter: objectProperty("Optional Notion database filter object."),
        sorts: arrayProperty("Optional Notion database sort objects."),
        pageSize: integerProperty("Maximum rows to return.", 1, 100),
        startCursor: stringProperty("Pagination cursor."),
      },
      ["databaseId"],
    ),
    build: (args) => {
      only(args, [
        "databaseId",
        "filter",
        "sorts",
        "pageSize",
        "startCursor",
      ]);
      return {
        method: "POST",
        endpoint: `/v1/databases/${pathSegment(identifier(args, "databaseId"))}/query`,
        body: withoutUndefined({
          filter: optionalObject(args, "filter"),
          sorts: optionalArray(args, "sorts"),
          page_size: optionalInteger(args, "pageSize", 1, 100),
          start_cursor: optionalString(args, "startCursor", 2_000),
        }),
      };
    },
  }),
  fixedAction({
    name: "notion_create_page",
    title: "Create Notion page",
    description:
      "Create a page beneath a Notion page or in a Notion database/data source.",
    connectionSlug: "notion",
    risk: "write",
    inputSchema: schema(
      {
        parent: objectProperty(
          "Notion parent object, such as {page_id} or {database_id}.",
        ),
        properties: objectProperty("Notion page properties object."),
        children: arrayProperty("Optional initial Notion block children."),
        icon: objectProperty("Optional Notion page icon object."),
        cover: objectProperty("Optional Notion page cover object."),
      },
      ["parent", "properties"],
    ),
    build: (args) => {
      only(args, ["parent", "properties", "children", "icon", "cover"]);
      const body = withoutUndefined({
        parent: requiredObject(args, "parent"),
        properties: requiredObject(args, "properties"),
        children: optionalArray(args, "children"),
        icon: optionalObject(args, "icon"),
        cover: optionalObject(args, "cover"),
      });
      ensureBodySize(body);
      return { method: "POST", endpoint: "/v1/pages", body };
    },
  }),
  fixedAction({
    name: "notion_append_blocks",
    title: "Append Notion blocks",
    description: "Append child blocks to a Notion page or block.",
    connectionSlug: "notion",
    risk: "write",
    inputSchema: schema(
      {
        blockId: stringProperty("Notion block or page ID."),
        children: arrayProperty("Notion block objects to append."),
        after: stringProperty("Optional block ID after which to append."),
      },
      ["blockId", "children"],
    ),
    build: (args) => {
      only(args, ["blockId", "children", "after"]);
      const children = optionalArray(args, "children");
      if (!children?.length) invalid("children", "is required");
      const body = withoutUndefined({
        children,
        after: optionalString(args, "after", 500),
      });
      ensureBodySize(body);
      return {
        method: "PATCH",
        endpoint: `/v1/blocks/${pathSegment(identifier(args, "blockId"))}/children`,
        body,
      };
    },
  }),
  fixedAction({
    name: "notion_update_page",
    title: "Update Notion page",
    description:
      "Update properties, archive state, icon, or cover on a Notion page.",
    connectionSlug: "notion",
    risk: "write",
    inputSchema: schema(
      {
        pageId: stringProperty("Notion page ID."),
        properties: objectProperty("Optional Notion page property updates."),
        archived: booleanProperty("Archive or restore the page."),
        inTrash: booleanProperty("Move the page to or restore it from trash."),
        icon: objectProperty("Optional Notion page icon object."),
        cover: objectProperty("Optional Notion page cover object."),
      },
      ["pageId"],
    ),
    build: (args) => {
      only(args, [
        "pageId",
        "properties",
        "archived",
        "inTrash",
        "icon",
        "cover",
      ]);
      const body = withoutUndefined({
        properties: optionalObject(args, "properties"),
        archived: optionalBoolean(args, "archived"),
        in_trash: optionalBoolean(args, "inTrash"),
        icon: optionalObject(args, "icon"),
        cover: optionalObject(args, "cover"),
      });
      if (!Object.keys(body).length) {
        invalid("page", "must include at least one change");
      }
      ensureBodySize(body);
      return {
        method: "PATCH",
        endpoint: `/v1/pages/${pathSegment(identifier(args, "pageId"))}`,
        body,
      };
    },
  }),

  // Universal actions cover every Nango provider in the catalog. Read and
  // mutation requests are deliberately separate so risk is never guessed from
  // an HTTP verb after a tool call has already been authorized.
  universalAction({
    name: "provider_api_get",
    title: "Read connected provider API",
    description:
      "Make a read-only GET request to any connected provider API through Nango. Use a provider-relative endpoint, never a full URL.",
    risk: "read",
    inputSchema: schema(
      {
        connection: stringProperty(
          "Breadboard connection slug shown in the Connections tab.",
        ),
        endpoint: stringProperty(
          "Provider-relative endpoint beginning with /.",
          { maxLength: 2_000 },
        ),
        query: objectProperty(
          "Optional scalar query parameters for the provider API.",
        ),
      },
      ["connection", "endpoint"],
    ),
    build: (args) => {
      only(args, ["connection", "endpoint", "query"]);
      const endpoint = safeGenericEndpoint(
        requiredString(args, "endpoint", 2_000),
      );
      const query = genericQuery(optionalObject(args, "query"));
      return { method: "GET", endpoint, query };
    },
  }),
  universalAction({
    name: "provider_api_request",
    title: "Change connected provider data",
    description:
      "Make a mutating POST, PUT, PATCH, or DELETE request to any connected provider API through Nango. GET is intentionally unavailable here; use provider_api_get.",
    risk: "write",
    inputSchema: schema(
      {
        connection: stringProperty(
          "Breadboard connection slug shown in the Connections tab.",
        ),
        method: stringProperty("HTTP mutation method.", {
          enum: ["POST", "PUT", "PATCH", "DELETE"],
        }),
        endpoint: stringProperty(
          "Provider-relative endpoint beginning with /.",
          { maxLength: 2_000 },
        ),
        query: objectProperty(
          "Optional scalar query parameters for the provider API.",
        ),
        body: jsonProperty(
          "Optional JSON request body; objects, arrays, and primitive JSON values are supported.",
        ),
      },
      ["connection", "method", "endpoint"],
    ),
    build: (args) => {
      only(args, ["connection", "method", "endpoint", "query", "body"]);
      const method = requiredString(args, "method", 10).toUpperCase();
      if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        invalid(
          "method",
          "must be POST, PUT, PATCH, or DELETE; use provider_api_get for reads",
        );
      }
      const body = optionalJson(args, "body");
      if (body !== undefined) ensureBodySize(body);
      return {
        method: method as ConnectedAppProxyRequest["method"],
        endpoint: safeGenericEndpoint(
          requiredString(args, "endpoint", 2_000),
        ),
        query: genericQuery(optionalObject(args, "query")),
        body,
      };
    },
  }),
];

function safeGenericEndpoint(value: string): string {
  const endpoint = value.trim();
  if (
    !endpoint.startsWith("/") ||
    endpoint.startsWith("//") ||
    endpoint.includes("\\") ||
    /(?:^|\/)\.\.(?:\/|$)/.test(endpoint) ||
    /[\r\n\0]/.test(endpoint) ||
    endpoint.length > 2_000
  ) {
    return invalid("endpoint", "is invalid");
  }
  let parsed: URL;
  try {
    parsed = new URL(endpoint, "https://provider.invalid");
  } catch {
    return invalid("endpoint", "is invalid");
  }
  if (
    parsed.origin !== "https://provider.invalid" ||
    parsed.username ||
    parsed.password
  ) {
    return invalid("endpoint", "must be provider-relative");
  }
  // Query values must be passed separately so they are bounded and encoded.
  if (parsed.search || parsed.hash) {
    return invalid("endpoint", "must not include a query string or fragment");
  }
  return endpoint;
}

function genericQuery(
  value: Record<string, unknown> | undefined,
): Record<string, string | number | boolean | undefined> | undefined {
  if (!value) return undefined;
  const entries = Object.entries(value);
  if (entries.length > 100) invalid("query", "contains too many fields");
  const normalized: Record<string, string | number | boolean> = {};
  for (const [key, raw] of entries) {
    if (
      !key ||
      key.length > 200 ||
      /[\r\n\0]/.test(key) ||
      key === "__proto__" ||
      key === "prototype" ||
      key === "constructor"
    ) {
      invalid("query", "contains an invalid field name");
    }
    if (
      typeof raw !== "string" &&
      typeof raw !== "number" &&
      typeof raw !== "boolean"
    ) {
      invalid("query", "values must be text, numbers, or booleans");
    }
    if (typeof raw === "number" && !Number.isFinite(raw)) {
      invalid("query", "contains an invalid number");
    }
    if (typeof raw === "string" && raw.length > 10_000) {
      invalid("query", "contains a value that is too long");
    }
    normalized[key] = raw;
  }
  return Object.keys(normalized).length ? normalized : undefined;
}

const actionMap = new Map<string, NangoActionDefinition>();
for (const action of actions) {
  if (actionMap.has(action.name)) {
    throw new Error(`Duplicate Nango action name: ${action.name}`);
  }
  actionMap.set(action.name, action);
}

export const NANGO_ACTIONS: readonly NangoActionDefinition[] =
  Object.freeze(actions);

export function nangoActionDefinitions(): readonly NangoActionDefinition[] {
  return NANGO_ACTIONS;
}

export function findNangoAction(
  nameValue: string,
): NangoActionDefinition | null {
  const name = nameValue.trim().toLowerCase();
  return actionMap.get(name) ?? null;
}

/** Stable lookup names for route/executor call sites. */
export const nangoAction = findNangoAction;
export const nangoActionFor = findNangoAction;

export function buildNangoActionInvocation(
  name: string,
  args: unknown,
): NangoActionInvocation {
  const action = findNangoAction(name);
  if (!action) {
    throw new ApiError(
      404,
      "nango_action_not_found",
      "The connected-app action is not available.",
    );
  }
  return {
    action,
    connectionSlug: action.resolveConnectionSlug(args),
    request: action.buildRequest(args),
  };
}

export function nangoActionSummariesForConnections(
  connectionSlugs: Iterable<string>,
): NangoActionSummary[] {
  const connected = new Set(
    [...connectionSlugs]
      .map((slug) => slug.trim().toLowerCase())
      .filter((slug) => CONNECTION_SLUG_RE.test(slug)),
  );
  if (!connected.size) return [];
  return NANGO_ACTIONS.filter(
    (action) =>
      action.fixedConnectionSlug === null ||
      connected.has(action.fixedConnectionSlug),
  ).map((action) => ({
    name: action.name,
    title: action.title,
    description: action.description,
    fixedConnectionSlug: action.fixedConnectionSlug,
    risk: action.risk,
    readOnly: action.readOnly,
    isReadOnly: action.isReadOnly,
    inputSchema: action.inputSchema,
    argumentDescription: action.argumentDescription,
    arguments: action.arguments,
  }));
}

export function nangoActionsForConnectionSlugs(
  connectionSlugs: Iterable<string>,
): NangoActionDefinition[] {
  const connected = new Set(
    [...connectionSlugs]
      .map((slug) => slug.trim().toLowerCase())
      .filter((slug) => CONNECTION_SLUG_RE.test(slug)),
  );
  if (!connected.size) return [];
  return NANGO_ACTIONS.filter(
    (action) =>
      action.fixedConnectionSlug === null ||
      connected.has(action.fixedConnectionSlug),
  );
}
