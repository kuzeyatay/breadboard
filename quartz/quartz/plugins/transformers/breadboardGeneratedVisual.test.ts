import assert from "node:assert/strict"
import test from "node:test"
import { generatedVisualHeadingMatches } from "./breadboardGeneratedVisualHeading"

test("a Learn visual under an internal lesson beat matches its lesson title", () => {
  // Lesson 1.2 opens with its own ### beat before the visual; the manifest
  // targets the lesson, whose title carries the section number.
  assert.equal(
    generatedVisualHeadingMatches({
      targetHeading: "How a Channel Is Partitioned Among Users",
      precedingHeading: "One physical channel, several logical channels",
      pageTitle: "1.2 How a Channel Is Partitioned Among Users",
    }),
    true,
  )
})

test("a visual with no heading above it matches the page title", () => {
  assert.equal(
    generatedVisualHeadingMatches({
      targetHeading: "The Erlang B Loss System",
      precedingHeading: null,
      pageTitle: "2.2 The Erlang B Loss System",
    }),
    true,
  )
})

test("a visual targeted at another lesson is still refused", () => {
  assert.equal(
    generatedVisualHeadingMatches({
      targetHeading: "Sizing a Trunk with Erlang B",
      precedingHeading: "One physical channel, several logical channels",
      pageTitle: "1.2 How a Channel Is Partitioned Among Users",
    }),
    false,
  )
  assert.equal(
    generatedVisualHeadingMatches({ targetHeading: "  ", precedingHeading: "Anything", pageTitle: "Anything" }),
    false,
  )
})
