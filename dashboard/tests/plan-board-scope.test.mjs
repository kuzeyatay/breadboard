import assert from "node:assert/strict";
import test from "node:test";

import {
  isPlanBoardScope,
  rangeForBoardScope,
  shiftBoardScopeAnchor,
  taskMatchesBoardScope,
} from "../src/lib/plan/board-scope.ts";

test("board scopes parse only the supported date windows", () => {
  assert.equal(isPlanBoardScope("all"), true);
  assert.equal(isPlanBoardScope("day"), true);
  assert.equal(isPlanBoardScope("month"), true);
  assert.equal(isPlanBoardScope("year"), true);
  assert.equal(isPlanBoardScope("week"), false);
});

test("board scopes produce inclusive day, month and year ranges", () => {
  assert.deepEqual(rangeForBoardScope("day", "2028-02-29"), {
    from: "2028-02-29",
    to: "2028-02-29",
  });
  assert.deepEqual(rangeForBoardScope("month", "2028-02-29"), {
    from: "2028-02-01",
    to: "2028-02-29",
  });
  assert.deepEqual(rangeForBoardScope("year", "2028-02-29"), {
    from: "2028-01-01",
    to: "2028-12-31",
  });
  assert.equal(rangeForBoardScope("all", "2028-02-29"), null);
});

test("scoped boards keep undated backlog and filter dated cards", () => {
  assert.equal(taskMatchesBoardScope(null, "day", "2026-09-01"), true);
  assert.equal(taskMatchesBoardScope("2026-09-01", "day", "2026-09-01"), true);
  assert.equal(taskMatchesBoardScope("2026-09-02", "day", "2026-09-01"), false);
  assert.equal(taskMatchesBoardScope("2026-09-30", "month", "2026-09-01"), true);
  assert.equal(taskMatchesBoardScope("2026-10-01", "month", "2026-09-01"), false);
  assert.equal(taskMatchesBoardScope("2026-12-31", "year", "2026-09-01"), true);
  assert.equal(taskMatchesBoardScope("2027-01-01", "year", "2026-09-01"), false);
});

test("board navigation advances by the selected scope", () => {
  assert.equal(shiftBoardScopeAnchor("day", "2026-09-01", -1), "2026-08-31");
  assert.equal(shiftBoardScopeAnchor("month", "2026-01-31", -1), "2025-12-01");
  assert.equal(shiftBoardScopeAnchor("year", "2026-09-01", 1), "2027-01-01");
  assert.equal(shiftBoardScopeAnchor("all", "2026-09-01", 1), "2026-09-01");
});
