import { test } from "node:test";
import assert from "node:assert/strict";
import { inhibitSystemSleepUntilQuit } from "../src/main/sleep-inhibitor";

test("system sleep is inhibited until the application quits", () => {
  const starts: string[] = [];
  const stops: number[] = [];
  let willQuit: () => void = () => {
    assert.fail("will-quit listener was not registered");
  };

  const blockerId = inhibitSystemSleepUntilQuit(
    {
      start: (type) => {
        starts.push(type);
        return 42;
      },
      stop: (id) => stops.push(id),
    },
    (listener) => {
      willQuit = listener;
    },
  );

  assert.equal(blockerId, 42);
  assert.deepEqual(starts, ["prevent-app-suspension"]);
  assert.deepEqual(stops, []);

  willQuit();
  assert.deepEqual(stops, [42]);
});
