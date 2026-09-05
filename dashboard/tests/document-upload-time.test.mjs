import assert from "node:assert/strict";
import test from "node:test";
import {
  documentUploadTimeTitle,
  formatDocumentUploadTime,
} from "../src/lib/document-upload-time.ts";

const localTime = (year, month, day, hour = 12, minute = 0) =>
  new Date(year, month - 1, day, hour, minute).getTime();

test("recent document uploads use compact relative timestamps", () => {
  const now = localTime(2026, 9, 4, 12);

  assert.equal(
    formatDocumentUploadTime(new Date(now - 20_000).toISOString(), now, "en-US"),
    "Uploaded just now",
  );
  assert.equal(
    formatDocumentUploadTime(new Date(now - 12 * 60_000).toISOString(), now, "en-US"),
    "Uploaded 12m ago",
  );
  assert.equal(
    formatDocumentUploadTime(new Date(now - 3 * 60 * 60_000).toISOString(), now, "en-US"),
    "Uploaded 3h ago",
  );
  assert.equal(
    formatDocumentUploadTime(new Date(now - 4 * 24 * 60 * 60_000).toISOString(), now, "en-US"),
    "Uploaded 4d ago",
  );
});

test("older document uploads use calendar dates instead of week counts", () => {
  const now = localTime(2026, 9, 4);

  assert.equal(
    formatDocumentUploadTime(
      new Date(localTime(2026, 8, 20)).toISOString(),
      now,
      "en-US",
    ),
    "Uploaded Aug 20",
  );
  assert.equal(
    formatDocumentUploadTime(
      new Date(localTime(2025, 8, 20)).toISOString(),
      now,
      "en-US",
    ),
    "Uploaded Aug 20, 2025",
  );
});

test("invalid and future document dates degrade safely", () => {
  const now = localTime(2026, 9, 4);

  assert.equal(formatDocumentUploadTime("not-a-date", now), "Upload date unavailable");
  assert.equal(
    formatDocumentUploadTime(new Date(now + 60_000).toISOString(), now),
    "Uploaded just now",
  );
  assert.equal(documentUploadTimeTitle("not-a-date"), undefined);
  assert.match(
    documentUploadTimeTitle(new Date(now).toISOString(), "en-US") ?? "",
    /^Uploaded /,
  );
});
