import { test, expect } from "bun:test";
import { selectBackend } from "../src/backends/select.ts";

test("default backend is the real GBrain engine", () => {
  const { backend, requested } = selectBackend({ GBRAIN_TEST_MODE: "1" } as never, ":memory:", "none");
  expect(requested).toBe("gbrain");
  expect(backend.backendName).toBe("gbrain");
});

test("explicit fake backend is allowed in test mode and reports 'fake'", () => {
  const { backend, requested } = selectBackend(
    { GBRAIN_BACKEND: "fake", GBRAIN_TEST_MODE: "1" } as never,
    ":memory:",
    "hash",
  );
  expect(requested).toBe("fake");
  expect(backend.backendName).toBe("fake");
});

test("fake backend is REFUSED in packaged production", () => {
  expect(() =>
    selectBackend({ GBRAIN_BACKEND: "fake", GBRAIN_PACKAGED: "1" } as never, ":memory:", "none"),
  ).toThrow(/refused in packaged production/i);
});

test("fake backend is REFUSED when NODE_ENV=production without test mode", () => {
  expect(() =>
    selectBackend({ GBRAIN_BACKEND: "fake", NODE_ENV: "production" } as never, ":memory:", "none"),
  ).toThrow(/test-only/i);
});
