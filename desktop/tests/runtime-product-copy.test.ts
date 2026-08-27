import assert from "node:assert/strict";
import test from "node:test";

import {
  runtimeProductCopy,
  runtimeProductText,
} from "../src/shared/runtime-product-copy";

test("user-facing Runtime copy omits the implementation version", () => {
  assert.equal(
    runtimeProductText("Runtime V2 stopped; runtime v2 will retry."),
    "Runtime stopped; runtime will retry.",
  );
});

test("startup and diagnostic payloads omit the implementation version", () => {
  const value = runtimeProductCopy({
    message: "Runtime V2 could not start",
    failure: {
      reason: "Runtime V2 stopped with exit code 70.",
      logTail: ["[desktop] Runtime V2 startup failed"],
    },
  });

  assert.deepEqual(value, {
    message: "Runtime could not start",
    failure: {
      reason: "Runtime stopped with exit code 70.",
      logTail: ["[desktop] Runtime startup failed"],
    },
  });
});
