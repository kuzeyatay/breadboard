import assert from "node:assert/strict";
import test from "node:test";

import { detectPii, maskPii } from "../src/lib/sim/guardrails/local-pii.ts";
import { validateJson } from "../src/lib/sim/guardrails/validate_json.ts";
import { validateRegex, validateRegexPattern } from "../src/lib/sim/guardrails/validate_regex.ts";

// --- validate_json.ts / validate_regex.ts (vendored, pure) ------------------

test("validateJson passes valid JSON and fails invalid JSON", () => {
  assert.equal(validateJson('{"a":1}').passed, true);
  assert.equal(validateJson("{not json").passed, false);
});

test("validateRegexPattern accepts valid syntax and rejects invalid syntax", () => {
  assert.equal(validateRegexPattern("\\d+").valid, true);
  assert.equal(validateRegexPattern("(").valid, false);
  assert.equal(validateRegexPattern("").valid, false);
});

test("validateRegex matches against caller input", () => {
  assert.equal(validateRegex("order-12345", "^order-\\d+$").passed, true);
  assert.equal(validateRegex("nope", "^order-\\d+$").passed, false);
});

// --- local-pii.ts: positive detections ---------------------------------------

test("detects and masks an email address", () => {
  const text = "Contact me at jane.doe@example.com for details.";
  const { masked, findings } = maskPii(text);
  assert.equal(masked, "Contact me at <EMAIL_ADDRESS> for details.");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "EMAIL_ADDRESS");
  assert.equal(findings[0].text, "jane.doe@example.com");
});

test("detects an international phone number", () => {
  const text = "Call +1 415 555 0100 now";
  const { masked, findings } = maskPii(text);
  assert.equal(masked, "Call <PHONE_NUMBER> now");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "PHONE_NUMBER");
});

test("detects a grouped US-style phone number", () => {
  const text = "Reach us at (415) 555-0100 today";
  const { masked, findings } = maskPii(text);
  assert.equal(masked, "Reach us at <PHONE_NUMBER> today");
  assert.equal(findings.length, 1);
});

test("detects a valid credit card number (Luhn passes)", () => {
  // The canonical Visa test number — always Luhn-valid, never a real card.
  const text = "Card on file: 4111 1111 1111 1111 exp 12/29";
  const { masked, findings } = maskPii(text);
  assert.equal(masked, "Card on file: <CREDIT_CARD> exp 12/29");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "CREDIT_CARD");
});

test("detects a valid IBAN (mod-97 passes)", () => {
  // The standard Wikipedia example IBAN (Great Britain), chosen to be valid.
  const text = "Wire to GB82WEST12345698765432 please";
  const { masked, findings } = maskPii(text);
  assert.equal(masked, "Wire to <IBAN_CODE> please");
  assert.equal(findings.length, 1);
});

test("detects an IPv4 address", () => {
  const text = "Server at 192.168.1.100 responded";
  const { masked, findings } = maskPii(text);
  assert.equal(masked, "Server at <IP_ADDRESS> responded");
  assert.equal(findings.length, 1);
});

test("detects a US SSN", () => {
  const text = "SSN: 123-45-6789 on file";
  const { masked, findings } = maskPii(text);
  assert.equal(masked, "SSN: <US_SSN> on file");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "US_SSN");
});

test("detects and masks a custom pattern with its replacement token", () => {
  const customPatterns = [{ name: "Employee ID", regex: "EMP-\\d{6}", replacement: "EMPLOYEE_ID" }];
  const text = "Badge EMP-482913 lost";
  const { masked, findings } = maskPii(text, { customPatterns });
  assert.equal(masked, "Badge <EMPLOYEE_ID> lost");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].type, "EMPLOYEE_ID");
});

test("a message with multiple entity types masks every one, in order", () => {
  const text = "Email jane@example.com or call +1 415 555 0100, card 4111 1111 1111 1111.";
  const { masked, findings } = maskPii(text);
  assert.equal(findings.length, 3);
  assert.deepEqual(
    findings.map((f) => f.type),
    ["EMAIL_ADDRESS", "PHONE_NUMBER", "CREDIT_CARD"],
  );
  assert.equal(masked, "Email <EMAIL_ADDRESS> or call <PHONE_NUMBER>, card <CREDIT_CARD>.");
});

// --- local-pii.ts: negative / false-positive discipline ----------------------

test("an order number shaped unlike a phone number survives untouched", () => {
  const text = "Your order ORD-2024-8817342 has shipped.";
  const { masked, findings } = maskPii(text);
  assert.equal(masked, text);
  assert.equal(findings.length, 0);
});

test("a phone-shaped digit run inside a URL is not flagged (URLs are skipped for phone detection)", () => {
  const text = "See https://example.com/orders/555-123-4567 for tracking.";
  const { masked, findings } = maskPii(text);
  assert.equal(masked, text);
  assert.equal(findings.length, 0);
});

test("a digit run that fails the Luhn check is not flagged as a credit card", () => {
  // One digit off from the valid Visa test number above — fails Luhn.
  const text = "Reference 4111 1111 1111 1112 on the invoice";
  const { masked, findings } = maskPii(text);
  assert.equal(masked, text);
  assert.equal(findings.length, 0);
});

test("an IBAN-shaped string that fails the mod-97 checksum is not flagged", () => {
  // Same as the valid example above with the last digit changed.
  const text = "Wire to GB82WEST12345698765433 please";
  const { masked, findings } = maskPii(text);
  assert.equal(masked, text);
  assert.equal(findings.length, 0);
});

test("an SSN with an invalid area number (000) is not flagged", () => {
  const text = "Ref: 000-12-3456 archived";
  const { masked, findings } = maskPii(text);
  assert.equal(masked, text);
  assert.equal(findings.length, 0);
});

test("an address-shaped local part without a domain is not flagged as an email", () => {
  const text = "Contact user@localhost for internal testing.";
  const { masked, findings } = maskPii(text);
  assert.equal(masked, text);
  assert.equal(findings.length, 0);
});

test("text with no PII is returned verbatim", () => {
  const text = "The weather today is pleasant and the meeting starts at noon.";
  const { masked, findings } = maskPii(text);
  assert.equal(masked, text);
  assert.equal(findings.length, 0);
});

test("entityTypes narrows detection to the requested types only", () => {
  const text = "Email jane@example.com or call +1 415 555 0100";
  const emailOnly = detectPii(text, { entityTypes: ["EMAIL_ADDRESS"] });
  assert.equal(emailOnly.length, 1);
  assert.equal(emailOnly[0].type, "EMAIL_ADDRESS");
});

test("an invalid custom pattern is skipped rather than throwing", () => {
  const customPatterns = [{ name: "Bad", regex: "(", replacement: "BAD" }];
  const text = "Nothing here should crash the matcher.";
  assert.doesNotThrow(() => maskPii(text, { customPatterns }));
  assert.equal(maskPii(text, { customPatterns }).findings.length, 0);
});
