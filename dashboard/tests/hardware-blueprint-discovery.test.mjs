import assert from "node:assert/strict";
import test from "node:test";

const { discoverRequestComponents } = await import(
  "../src/lib/hardware/component-discovery.ts"
);
const { componentDefinition, componentDefinitionForDesign } = await import(
  "../src/lib/hardware/components/index.ts"
);
const { buildDesign } = await import("../src/lib/hardware/design.ts");
const { resolveComponentPhrase } = await import("../src/lib/hardware/resolver.ts");
const { parseStoredDesign } = await import("../src/lib/hardware/schemas.ts");

function request(type) {
  return {
    title: "Researched sensor",
    purpose: "Read one environmental sensor",
    controller: "ESP32 DevKit V1",
    inputs: [{ type, quantity: 1 }],
    outputs: [],
    communication: ["i2c"],
    power: { source: "usb" },
    prototypeType: "breadboard",
    firmware: { platform: "platformio", language: "cpp" },
    constraints: {
      beginnerFriendly: true,
      preferredComponents: [],
      forbiddenComponents: [],
    },
  };
}

function aq1Candidate(overrides = {}) {
  return {
    found: true,
    note: "Manufacturer documentation identifies an I2C breakout module.",
    manufacturer: "Acme Instruments",
    manufacturerPartNumber: "AQ1-BREAKOUT",
    name: "Acme AQ1 air-quality breakout",
    category: "sensor",
    description: "An I2C environmental sensor breakout.",
    aliases: ["AQ1"],
    electrical: {
      minimumSupplyVoltage: 3,
      typicalSupplyVoltage: 3.3,
      maximumSupplyVoltage: 3.6,
      logicVoltage: 3.3,
      typicalCurrentMa: 5,
      maximumCurrentMa: 10,
    },
    interfaces: ["i2c"],
    pins: [
      { id: "VCC", label: "VCC", electricalType: "power-input", functions: ["supply-3v3"] },
      { id: "GND", label: "GND", electricalType: "ground", functions: ["ground"] },
      { id: "SDA", label: "SDA", electricalType: "open-drain", functions: ["i2c-sda"] },
      { id: "SCL", label: "SCL", electricalType: "open-drain", functions: ["i2c-scl"] },
    ],
    rules: { requiresPullups: true, i2cAddresses: ["0x52"] },
    mechanical: { length: 18, width: 14, height: 4 },
    sources: [
      {
        title: "AQ1 manufacturer datasheet",
        url: "https://components.example.com/aq1-datasheet.pdf",
        kind: "manufacturer-datasheet",
      },
    ],
    ...overrides,
  };
}

const target = { baseUrl: "http://unused", model: "test-model" };

test("the exact focusing-lens id resolves locally before any web fallback", () => {
  const outcome = resolveComponentPhrase("ar-focusing-lens");
  assert.equal(outcome.status, "resolved");
  assert.equal(outcome.definition.id, "ar-focusing-lens");
});

test("a specific unknown model number is researched instead of becoming a generic part", () => {
  assert.equal(resolveComponentPhrase("Acme AQ1 display").status, "unsupported");
  assert.equal(resolveComponentPhrase("BME280 environmental sensor").status, "resolved");
});

test("known parts do not make an online request", async () => {
  let calls = 0;
  const result = await discoverRequestComponents({
    ...target,
    request: request("BME280"),
    search: async () => {
      calls += 1;
      return aq1Candidate();
    },
  });
  assert.equal(calls, 0);
  assert.deepEqual(result.attempted, []);
  assert.deepEqual(result.records, []);
});

test("a cited, complete module is scoped to one design and survives reload", async () => {
  const discovery = await discoverRequestComponents({
    ...target,
    request: request("Acme AQ1 air sensor"),
    search: async () => aq1Candidate(),
  });
  assert.deepEqual(discovery.attempted, ["Acme AQ1 air sensor"]);
  assert.equal(discovery.records[0].status, "used");
  const researched = discovery.records[0].definition;
  assert.ok(researched.id.startsWith("researched-acme-instruments-aq1-breakout"));
  assert.equal(componentDefinition(researched.id), null, "the shared catalogue was not mutated");

  const built = buildDesign({
    request: request("Acme AQ1 air sensor"),
    designId: "hwd_researched",
    componentResearch: discovery.records,
  }).design;
  assert.ok(built.components.some((component) => component.definitionId === researched.id));
  assert.ok(built.bom.some((item) => item.manufacturerPartNumber === "AQ1-BREAKOUT"));
  assert.ok(
    Array.isArray(built.circuitJson) &&
      built.circuitJson.some(
        (entry) => entry.type === "source_component" && entry.manufacturer_part_number === "AQ1-BREAKOUT",
      ),
  );
  assert.equal(
    built.validationResults.some((finding) => finding.rule === "RESEARCHED_FIRMWARE_DRIVER_MISSING"),
    true,
    "pin-level research must not pretend a bus driver exists",
  );

  const reopened = parseStoredDesign(JSON.parse(JSON.stringify(built)));
  assert.equal(reopened.ok, true);
  assert.equal(reopened.value.componentResearch[0].sources[0].url, "https://components.example.com/aq1-datasheet.pdf");
  assert.equal(componentDefinitionForDesign(reopened.value, researched.id).name, researched.name);
});

test("uncited or contradictory results remain blocking research records", async () => {
  const cases = [
    aq1Candidate({ sources: [] }),
    aq1Candidate({
      electrical: { minimumSupplyVoltage: 5, typicalSupplyVoltage: 3.3, maximumSupplyVoltage: 3.6 },
    }),
  ];
  for (const candidate of cases) {
    const result = await discoverRequestComponents({
      ...target,
      request: request("Acme ZXQ-999 module"),
      search: async () => candidate,
    });
    assert.equal(result.records[0].status, "insufficient-evidence");
    assert.equal(result.definitions.length, 0);
  }
});

test("a sourced unsupported-bus product is identified but never wired", async () => {
  const result = await discoverRequestComponents({
    ...target,
    request: request("Photonix MD-42 near-eye panel"),
    search: async () => aq1Candidate({
      manufacturer: "Photonix",
      manufacturerPartNumber: "MD-42",
      name: "Photonix MD-42 near-eye panel",
      interfaces: ["mipi-dsi"],
    }),
  });
  assert.equal(result.records[0].status, "reference-only");
  assert.equal(result.records[0].definition.manufacturerPartNumber, "MD-42");
  assert.match(result.records[0].note, /compiler cannot wire it/i);
  assert.equal(result.definitions.length, 0);
});

test("a sourced non-electrical part is recorded as reference-only, never wired", async () => {
  const result = await discoverRequestComponents({
    ...target,
    request: request("Photonix OPX-42 optical element"),
    search: async () =>
      aq1Candidate({
        manufacturerPartNumber: "OPT-42",
        name: "OPT-42 optical relay",
        category: "optical",
        electrical: {},
        interfaces: [],
        pins: [],
      }),
  });
  assert.equal(result.records[0].status, "reference-only");
  assert.equal(result.definitions.length, 0);
});

test("missing power and preferred parts are researched but never inserted without a circuit role", async () => {
  const custom = request("BME280");
  custom.power = { source: "battery", part: "Acme CELL-42 protected pouch" };
  custom.constraints.preferredComponents = ["Acme AQ1 optional monitor"];
  const calls = [];
  const result = await discoverRequestComponents({
    ...target,
    request: custom,
    search: async (phrase) => {
      calls.push(phrase);
      if (phrase.includes("CELL-42")) {
        return aq1Candidate({
          manufacturerPartNumber: "CELL-42",
          name: "CELL-42 protected lithium pouch",
          category: "power-source",
          electrical: {
            minimumSupplyVoltage: 3,
            typicalSupplyVoltage: 3.7,
            maximumSupplyVoltage: 4.2,
            maximumCurrentMa: 800,
          },
          interfaces: [],
          pins: [
            { id: "POS", label: "+", electricalType: "power-output", functions: ["supply-battery"] },
            { id: "NEG", label: "-", electricalType: "ground", functions: ["ground"] },
          ],
        });
      }
      return aq1Candidate();
    },
  });
  assert.deepEqual(calls, ["Acme CELL-42 protected pouch", "Acme AQ1 optional monitor"]);
  assert.deepEqual(result.records.map((record) => record.status), ["reference-only", "reference-only"]);
  assert.equal(result.definitions.length, 0);

  const built = buildDesign({
    request: custom,
    designId: "hwd_researched_power",
    componentResearch: result.records,
  }).design;
  const finding = built.validationResults.find(
    (entry) => entry.rule === "REQUESTED_POWER_PART_MISSING",
  );
  assert.ok(finding);
  assert.match(finding.message, /Online component research was attempted/);
  assert.equal(
    built.components.some((component) => component.name.includes("CELL-42")),
    false,
    "a web result must not silently become a battery system",
  );
});

test("a prior accepted lookup is reused without another network call", async () => {
  const first = await discoverRequestComponents({
    ...target,
    request: request("Acme AQ1 air sensor"),
    search: async () => aq1Candidate(),
  });
  let calls = 0;
  const second = await discoverRequestComponents({
    ...target,
    request: request("Acme AQ1 air sensor"),
    previous: first.records,
    search: async () => {
      calls += 1;
      return aq1Candidate();
    },
  });
  assert.equal(calls, 0);
  assert.deepEqual(second.attempted, []);
  assert.equal(second.records[0].status, "used");
});

test("a researched preference is promoted when a follow-up makes it required", async () => {
  const preferred = request("BME280");
  preferred.constraints.preferredComponents = ["Acme AQ1 air sensor"];
  const first = await discoverRequestComponents({
    ...target,
    request: preferred,
    search: async () => aq1Candidate(),
  });
  assert.equal(first.records[0].status, "reference-only");

  let calls = 0;
  const second = await discoverRequestComponents({
    ...target,
    request: request("Acme AQ1 air sensor"),
    previous: first.records,
    search: async () => {
      calls += 1;
      return aq1Candidate();
    },
  });
  assert.equal(calls, 0);
  assert.equal(second.records[0].status, "used");
  assert.equal(second.definitions[0].manufacturerPartNumber, "AQ1-BREAKOUT");
});

test("production discovery requires a real web-search trace and keeps only its cited URLs", async () => {
  const realFetch = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(String(init.body)) });
      if (String(url).endsWith("/responses")) {
        return new Response(
          JSON.stringify({
            output: [
              {
                type: "web_search_call",
                status: "completed",
                action: {
                  sources: [
                    { type: "url", url: "https://components.example.com/aq1-datasheet.pdf" },
                  ],
                },
              },
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: "The AQ1 breakout uses 3.3 V I2C and exposes VCC, GND, SDA and SCL.",
                    annotations: [],
                  },
                ],
              },
            ],
            usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      const candidate = aq1Candidate({
        sources: [
          ...aq1Candidate().sources,
          {
            title: "Invented source",
            url: "https://not-in-the-search.example/fake",
            kind: "manufacturer-datasheet",
          },
        ],
      });
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                tool_calls: [
                  { function: { name: "component_candidate", arguments: JSON.stringify(candidate) } },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const result = await discoverRequestComponents({
      baseUrl: "http://chatmock.local/v1",
      model: "test-model",
      request: request("Acme AQ1 air sensor"),
    });
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0].body.tools, [
      { type: "web_search", search_context_size: "medium" },
    ]);
    assert.equal(requests[1].body.tools[0].function.name, "component_candidate");
    assert.equal(result.records[0].status, "used");
    assert.deepEqual(
      result.records[0].sources.map((source) => source.url),
      ["https://components.example.com/aq1-datasheet.pdf"],
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("uncited model prose cannot masquerade as an online search", async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          output: [
            {
              type: "message",
              content: [{ type: "output_text", text: "I remember an AQ1 module.", annotations: [] }],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };
    const result = await discoverRequestComponents({
      baseUrl: "http://chatmock.local/v1",
      model: "test-model",
      request: request("Acme AQ1 air sensor"),
    });
    assert.equal(calls, 1, "uncited prose must not reach structured extraction");
    assert.equal(result.records[0].status, "not-found");
    assert.match(result.records[0].note, /no cited web evidence/i);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("missing parts are researched concurrently so one slow lookup does not starve its peers", async () => {
  const multi = request("Acme SLOW-1 sensor");
  multi.outputs = [{ type: "Acme FAST-2 display", quantity: 1 }];
  const calls = [];
  let releaseSlow;
  const slow = new Promise((resolve) => {
    releaseSlow = resolve;
  });
  const pending = discoverRequestComponents({
    ...target,
    request: multi,
    search: async (phrase) => {
      calls.push(phrase);
      if (phrase.includes("SLOW-1")) await slow;
      return aq1Candidate({
        manufacturerPartNumber: phrase.includes("SLOW-1") ? "SLOW-1" : "FAST-2",
        name: phrase,
      });
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, ["Acme SLOW-1 sensor", "Acme FAST-2 display"]);
  releaseSlow();
  const result = await pending;
  assert.deepEqual(result.attempted, calls);
  assert.equal(result.records.length, 2);
});

test("an aborted per-part lookup is timed out, not falsely reported as not found", async () => {
  const result = await discoverRequestComponents({
    ...target,
    request: request("Acme timeout component"),
    perComponentTimeoutMs: 5,
    search: async (_phrase, searchTarget) =>
      await new Promise((_resolve, reject) => {
        searchTarget.signal.addEventListener(
          "abort",
          () => reject(searchTarget.signal.reason),
          { once: true },
        );
      }),
  });
  assert.equal(result.records[0].status, "timed-out");
  assert.doesNotMatch(result.records[0].note, /not found/i);
});
