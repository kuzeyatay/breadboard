import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeTag,
  dedupeTags,
  generateFallbackTags,
  normalizeTag,
  normalizeTopicTags,
  validateZettelkastenTags,
} from "../src/lib/tags.ts";

describe("Zettelkasten tag utilities", () => {
  test("normalizes normal subsection tags into kebab-case concept handles", () => {
    const tags = validateZettelkastenTags(
      ["Restoring Force", "Stable Equilibrium", "Angular Frequency", "Simple Harmonic Motion"],
      {
        title: "1.2 Why Oscillators Return to Equilibrium",
        content:
          "A restoring force points back toward stable equilibrium. The angular frequency sets how quickly simple harmonic motion cycles.",
        maxTags: 8,
      },
    );

    assert.deepEqual(tags, [
      "restoring-force",
      "stable-equilibrium",
      "angular-frequency",
      "simple-harmonic-motion",
    ]);
  });

  test("drops vague tags, title slugs, source filenames, and bad LLM wording", () => {
    const tags = normalizeTopicTags(
      [
        "learning",
        "overview",
        "understanding-the-basics",
        "Limits of Synchronous Continuous Networks",
        "2510.27379v1.pdf",
        "synchronous computation",
        "continuous activation",
        "dense computation",
        "energy efficiency",
      ],
      "Dense networks pass continuous activation values through synchronous computation. Energy efficiency improves when event-driven processing avoids dense computation.",
      8,
      "Dense networks pass continuous activation values through synchronous computation. Energy efficiency improves when event-driven processing avoids dense computation.",
      { title: "Limits of Synchronous Continuous Networks" },
    );

    assert.ok(!tags.includes("learning"));
    assert.ok(!tags.includes("overview"));
    assert.ok(!tags.includes("understanding-the-basics"));
    assert.ok(!tags.includes("limits-of-synchronous-continuous-networks"));
    assert.ok(!tags.some((tag) => tag.includes("2510")));
    assert.ok(tags.includes("continuous-activation"));
    assert.ok(tags.includes("dense-computation"));
    assert.ok(tags.includes("energy-efficiency"));
  });

  test("canonicalizes repeated near-synonyms and existing garden tags", () => {
    assert.equal(canonicalizeTag("restoring-forces"), "restoring-force");
    assert.equal(canonicalizeTag("simple harmonic oscillator"), "simple-harmonic-motion");
    assert.equal(canonicalizeTag("angular-frequency-omega"), "angular-frequency");
    assert.equal(canonicalizeTag("nyquist condition", ["nyquist-criterion"]), "nyquist-criterion");
    assert.deepEqual(
      dedupeTags(["Restoring Forces", "restoring-force", "force-restoring"]),
      ["restoring-force"],
    );
  });

  test("generates fallback tags from content when model tags are missing", () => {
    const tags = generateFallbackTags({
      title: "Limits of Synchronous Continuous Networks",
      content:
        "Dense networks pass continuous activation values between layers. Synchronous computation recomputes many values even when event-driven processing would stay quiet. Neuromorphic computing uses this event-driven processing pressure to improve energy efficiency.",
      maxTags: 8,
    });

    assert.ok(tags.includes("continuous-activation"));
    assert.ok(tags.includes("dense-computation"));
    assert.ok(tags.includes("event-driven-processing"));
    assert.ok(tags.includes("neuromorphic-computing"));
    assert.ok(tags.includes("energy-efficiency"));
    assert.ok(tags.length >= 2 && tags.length <= 5);
  });

  test("rejects invalid punctuation and keeps conceptually meaningful numbers", () => {
    assert.equal(normalizeTag("  8 PSK!! "), "8-psk");
    assert.deepEqual(
      validateZettelkastenTags(["8 PSK", "page 12", "2024", "hamming code"], {
        content: "8-PSK modulation and Hamming code examples appear here.",
      }),
      ["8-psk", "hamming-code"],
    );
  });
});
