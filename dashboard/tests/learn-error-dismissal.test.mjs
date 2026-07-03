import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  forgetDismissedLearnErrorsForGarden,
  learnErrorDismissalKey,
  loadDismissedLearnErrorKeys,
  rememberDismissedLearnErrorKey,
} from "../src/lib/learn-error-dismissal.ts";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

describe("Learn error dismissal", () => {
  test("remembers a dismissed failed section until the garden is reset", () => {
    const storage = memoryStorage();
    const job = {
      id: "job_a",
      currentStep: "Textbook generation failed",
      currentSectionTitle: "Why Spiking Neural Networks Exist",
      currentPageTitle: "1.3 Neuromorphic Hardware and Application Pressure",
      error: "quality gates failed",
    };
    const key = learnErrorDismissalKey("test-2", job);

    assert.deepEqual(loadDismissedLearnErrorKeys(storage), []);
    assert.deepEqual(rememberDismissedLearnErrorKey(key, storage), [key]);
    assert.deepEqual(loadDismissedLearnErrorKeys(storage), [key]);
    assert.deepEqual(forgetDismissedLearnErrorsForGarden("test-2", storage), []);
  });

  test("uses the failure details instead of a transient job id", () => {
    const first = learnErrorDismissalKey("test-2", {
      id: "job_a",
      currentPageTitle: "1.3 Neuromorphic Hardware and Application Pressure",
      error: "quality gates failed",
    });
    const second = learnErrorDismissalKey("test-2", {
      id: "job_b",
      currentPageTitle: "1.3 Neuromorphic Hardware and Application Pressure",
      error: "quality gates failed",
    });
    const differentFailure = learnErrorDismissalKey("test-2", {
      id: "job_b",
      currentPageTitle: "1.4 Different Page",
      error: "quality gates failed",
    });

    assert.equal(first, second);
    assert.notEqual(first, differentFailure);
  });
});
