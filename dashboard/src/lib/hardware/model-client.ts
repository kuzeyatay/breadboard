// The two language-model steps implemented in this file.
//
//   1. Reading a sentence into a HardwareProjectRequest or a modification.
//   2. Writing the application logic inside an already-generated firmware
//      skeleton, against a contract of fixed parts and fixed pin constants.
//
// Source-backed component research is a separate, bounded adapter in
// component-discovery.ts. All three go through Breadboard's configured provider (ChatMock), so the agent
// follows whatever model the user selected. Neither result is trusted until Zod
// has validated it, and one structured repair is attempted before giving up.

import {
  describeTransportFailure,
  isTransportFailure,
  withTransportRetry,
} from "../model-transport.ts";
import { chatmockApiKeyValue } from "../agent-browser/provider.ts";
import { COMPONENT_DEFINITIONS } from "./components/index.ts";
import {
  firmwareLogicSchema,
  hardwareTurnSchema,
  parseWithSchema,
  type FirmwareLogic,
  type HardwareTurn,
} from "./schemas.ts";

const REQUEST_TIMEOUT_MS = 120_000;

export class HardwareModelError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "HardwareModelError";
    this.code = code;
  }
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface ModelTarget {
  baseUrl: string;
  model: string;
  reasoningEffort?: string;
  signal?: AbortSignal;
  /**
   * Raw `usage` from each completion this step makes, including the repair
   * call. The run reports the tokens it actually spent, so the caller adds
   * them up rather than the model step returning a single number.
   */
  onUsage?: (usage: unknown) => void;
}

function completionsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "");
  return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

/**
 * A request that never reached the model, said in words rather than as undici's
 * bare "fetch failed" — which names no service, no cause, and nothing the
 * reader can act on. Stopping the run and running out of time are told apart by
 * which signal fired, because all three arrive with the same message.
 */
function unreachable(target: ModelTarget, deadline: AbortSignal, error: unknown): HardwareModelError {
  if (target.signal?.aborted) {
    return new HardwareModelError("aborted", "The run was stopped before the model answered.");
  }
  if (deadline.aborted) {
    return new HardwareModelError(
      "model_timeout",
      `The model endpoint did not answer within ${Math.round(REQUEST_TIMEOUT_MS / 1_000)}s.`,
    );
  }
  return new HardwareModelError(
    "model_unreachable",
    describeTransportFailure(error, {
      endpoint: completionsUrl(target.baseUrl),
      lead: "The model could not be reached",
    }),
  );
}

async function callTool(
  target: ModelTarget,
  messages: ChatMessage[],
  tool: { name: string; description: string; parameters: Record<string, unknown> },
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timer.unref?.();
  const onAbort = () => controller.abort();
  target.signal?.addEventListener("abort", onAbort);
  try {
    // Re-sent if it never arrives. The gateway restarting under its supervisor
    // is enough to kill a request in flight, and losing a compiled circuit to
    // four seconds of downtime is not a failure worth reporting to anyone.
    const response = await withTransportRetry(
      () =>
        fetch(completionsUrl(target.baseUrl), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${chatmockApiKeyValue()}`,
          },
          body: JSON.stringify({
            model: target.model,
            messages,
            tools: [{ type: "function", function: tool }],
            tool_choice: { type: "function", function: { name: tool.name } },
            ...(target.reasoningEffort ? { reasoning_effort: target.reasoningEffort } : {}),
          }),
          signal: controller.signal,
        }),
      { ...(target.signal ? { signal: target.signal } : {}) },
    ).catch((error: unknown) => {
      throw unreachable(target, controller.signal, error);
    });
    if (!response.ok) {
      throw new HardwareModelError(
        "model_unavailable",
        `The model endpoint returned ${response.status}.`,
      );
    }
    const data = (await response.json().catch((error: unknown) => {
      if (isTransportFailure(error)) throw unreachable(target, controller.signal, error);
      throw new HardwareModelError(
        "invalid_json",
        "The model endpoint returned a response Breadboard could not read.",
      );
    })) as {
      choices?: Array<{
        message?: { tool_calls?: Array<{ function?: { arguments?: string } }> };
      }>;
      usage?: unknown;
    };
    if (data.usage) target.onUsage?.(data.usage);
    const raw = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!raw) {
      throw new HardwareModelError("empty_response", "The model returned no structured result.");
    }
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new HardwareModelError("invalid_json", "The model returned malformed JSON.");
    }
  } finally {
    clearTimeout(timer);
    target.signal?.removeEventListener("abort", onAbort);
  }
}

// ---------------------------------------------------------------------------
// Turn interpretation
// ---------------------------------------------------------------------------

const TURN_TOOL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  properties: {
    mode: {
      type: "string",
      enum: ["new", "modify"],
      description:
        "Use \"modify\" only when an existing blueprint is described below and the person is changing it. Otherwise \"new\".",
    },
    request: {
      type: "object",
      description: "Required when mode is \"new\".",
      properties: {
        title: { type: "string" },
        purpose: { type: "string", description: "What the finished project does, in one or two sentences." },
        controller: {
          type: "string",
          description:
            "The board the person asked for, verbatim. Leave empty when they did not name one.",
        },
        inputs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", description: "The part as the person named it." },
              quantity: { type: "integer", minimum: 1 },
            },
            required: ["type", "quantity"],
          },
        },
        outputs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string" },
              quantity: { type: "integer", minimum: 1 },
            },
            required: ["type", "quantity"],
          },
        },
        physicalParts: {
          type: "array",
          description:
            "Passive optical and mechanical parts required by the physical assembly. These are not electrical inputs or outputs.",
          items: {
            type: "object",
            properties: {
              type: { type: "string" },
              quantity: { type: "integer", minimum: 1 },
            },
            required: ["type", "quantity"],
          },
        },
        communication: {
          type: "array",
          items: {
            type: "string",
            enum: ["i2c", "spi", "uart", "can", "usb", "wifi", "bluetooth", "ethernet"],
          },
        },
        power: {
          type: "object",
          properties: {
            source: { type: "string", enum: ["usb", "battery", "external-supply", "unknown"] },
            part: {
              type: "string",
              description: "The exact battery, cell, or supply module the person named.",
            },
            voltage: { type: "number" },
            maximumCurrentMa: { type: "number" },
          },
          required: ["source"],
        },
        prototypeType: { type: "string", enum: ["breadboard", "perfboard", "pcb"] },
        firmware: {
          type: "object",
          properties: {
            platform: { type: "string", enum: ["arduino", "platformio", "esp-idf", "pico-sdk"] },
            language: { type: "string", enum: ["cpp", "c", "micropython"] },
          },
          required: ["platform", "language"],
        },
        constraints: {
          type: "object",
          properties: {
            maximumCost: { type: "number" },
            beginnerFriendly: { type: "boolean" },
            preferredComponents: { type: "array", items: { type: "string" } },
            forbiddenComponents: { type: "array", items: { type: "string" } },
          },
          required: ["beginnerFriendly", "preferredComponents", "forbiddenComponents"],
        },
      },
      required: ["purpose", "inputs", "outputs", "physicalParts", "communication", "power", "prototypeType", "firmware", "constraints"],
    },
    modification: {
      type: "object",
      description: "Required when mode is \"modify\".",
      properties: {
        operations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: [
                  "replace-component",
                  "add-component",
                  "remove-component",
                  "change-power",
                  "change-constraint",
                ],
              },
              targetComponentId: {
                type: "string",
                description: "An existing component id from the current design, e.g. cmp_2.",
              },
              replacementDefinitionId: { type: "string", description: "A component library id." },
              componentDefinitionId: { type: "string", description: "A component library id." },
              quantity: { type: "integer", minimum: 1 },
              requestedPurpose: { type: "string" },
              source: {
                type: "object",
                  properties: {
                    source: {
                      type: "string",
                      enum: ["usb", "battery", "external-supply", "unknown"],
                    },
                    part: { type: "string" },
                    voltage: { type: "number" },
                  maximumCurrentMa: { type: "number" },
                },
                required: ["source"],
              },
              key: { type: "string" },
              value: {},
            },
            required: ["type"],
          },
        },
        behaviourNotes: {
          type: "string",
          description: "Behaviour the person asked for, in their words, for the firmware step.",
        },
      },
      required: ["operations"],
    },
    note: { type: "string", description: "One sentence describing what you understood." },
  },
  required: ["mode", "note"],
};

function libraryCatalogue(): string {
  return COMPONENT_DEFINITIONS.map(
    (definition) => `- ${definition.id} — ${definition.name} (${definition.category})`,
  ).join("\n");
}

const TURN_SYSTEM_PROMPT = [
  "You read a person's hardware idea and turn it into a structured request. You never design the circuit.",
  "",
  "You decide only what the person meant: which parts the project needs, what it is for, how it is powered, and which board they asked for.",
  "A deterministic compiler chooses pins, nets, resistors, addresses and validation. Never mention pin numbers, resistor values or wiring.",
  "",
  "Rules:",
  "- When the person names parts, copy their own words into `type`. Do not translate a named part into a different one.",
  "- When they describe a finished product instead of a parts list (\"something Kindle-like\", \"a plant waterer\"), work out",
  "  which parts that product needs and list them, naming each one from the component library below. `inputs` and `outputs`",
  "  must never both be empty: a request that resolves to a bare board is not a design anyone can build.",
  "- Never leave the project to the compiler's imagination and never ask a follow-up question instead of choosing. Use an",
  "  exact library part when one genuinely matches. If a necessary part or capability is absent, preserve the person's name",
  "  verbatim in inputs or outputs instead of silently replacing or dropping it; the next stage can research a real part online.",
  "  Use `note` to name assumptions and any part that still needs research, so the person can correct you.",
  "- Leave `controller` empty when they did not name a board. Never substitute a board they did name.",
  "- Sensors and buttons go in `inputs`; electrically driven displays, LEDs, servos and relays go in `outputs`.",
  "- Passive optics, mounts, clips, cases, chassis parts and other mechanically integrated references go in `physicalParts`, never in electrical inputs or outputs.",
  "- Put a battery, cell, or supply module in `power.part` only when the person explicitly named that exact part. A generic request for portable or battery power sets only `power.source`.",
  "- `preferredComponents` contains only exact components the person explicitly named. Do not turn inferred packaging choices, custom PCBs, or mechanical requirements into component preferences.",
  "- Do not add a camera or other vision sensor to an AR or wearable request unless the person asked to capture, scan, detect, recognise, photograph, record, or see the environment.",
  "- Default ordinary bench projects to prototypeType \"breadboard\". Default worn, clip-on and compact portable products to \"pcb\"; a full-size solderless breadboard is not a wearable assembly.",
  "- A near-eye or AR display must name the complete chain: put the electrically connected microdisplay in `outputs`, and put the focusing/collimating optic, optical combiner, and positively retained eyeglass mount in `physicalParts`. Use matching library references; never describe a normal OLED plus a box as AR glasses.",
  "- Default beginnerFriendly true, power source \"usb\", and firmware platformio + cpp unless the product brief requires otherwise.",
  "- Add \"wifi\" or \"bluetooth\" to `communication` only when the project actually needs a network.",
  "",
  "The local component library. Parts outside it are researched before compilation; never invent their specifications:",
  libraryCatalogue(),
].join("\n");

export interface InterpretTurnInput extends ModelTarget {
  brief: string;
  /** Compact description of the blueprint already in this conversation. */
  existingDesignSummary?: string;
  /**
   * The user's standing preferences (preferred board, build style, toolchain),
   * already worded as a tie-breaker the brief outranks. Given to the model
   * rather than applied afterwards so it is weighed against what the brief
   * actually says instead of overwriting it.
   */
  preferenceNote?: string;
}

export async function interpretTurn(input: InterpretTurnInput): Promise<HardwareTurn> {
  const messages: ChatMessage[] = [
    { role: "system", content: TURN_SYSTEM_PROMPT },
    ...(input.existingDesignSummary
      ? [
          {
            role: "system" as const,
            content: `The current blueprint in this conversation:\n${input.existingDesignSummary}`,
          },
        ]
      : []),
    ...(input.preferenceNote
      ? [{ role: "system" as const, content: input.preferenceNote }]
      : []),
    { role: "user", content: input.brief },
  ];

  const tool = {
    name: "hardware_turn",
    description: "Record the structured reading of this hardware request.",
    parameters: TURN_TOOL_PARAMETERS,
  };

  const first = await callTool(input, messages, tool);
  const parsed = parseWithSchema(hardwareTurnSchema, first, "The structured hardware request");
  if (parsed.ok) return parsed.value;

  // One structured repair: hand the failures back and ask for a correction.
  const repaired = await callTool(
    input,
    [
      ...messages,
      {
        role: "system",
        content: [
          "The previous result did not validate. Fix exactly these problems and return the whole object again:",
          ...parsed.issues.map((issue) => `- ${issue}`),
        ].join("\n"),
      },
    ],
    tool,
  );
  const second = parseWithSchema(
    hardwareTurnSchema,
    repaired,
    "The structured hardware request",
  );
  if (second.ok) return second.value;
  throw new HardwareModelError(
    "invalid_structure",
    `${second.error} ${second.issues.slice(0, 3).join("; ")}`.trim(),
  );
}

// ---------------------------------------------------------------------------
// Firmware application logic
// ---------------------------------------------------------------------------

const LOGIC_TOOL_PARAMETERS: Record<string, unknown> = {
  type: "object",
  properties: {
    helperDeclarations: {
      type: "string",
      description: "File-scope constants and helper functions. May be empty.",
    },
    setupBody: {
      type: "string",
      description: "Statements appended to the end of setup(). May be empty.",
    },
    loopBody: {
      type: "string",
      description: "The complete body of loop().",
    },
    expectedSerialOutput: {
      type: "string",
      description: "A few lines of the serial output a working build prints.",
    },
  },
  required: ["helperDeclarations", "setupBody", "loopBody", "expectedSerialOutput"],
};

export interface FirmwareLogicInput extends ModelTarget {
  /** The contract from firmwareLogicBrief(). */
  brief: string;
  /** What the project should do, in the user's words. */
  behaviour: string;
}

export async function generateFirmwareLogic(
  input: FirmwareLogicInput,
): Promise<FirmwareLogic | null> {
  try {
    const raw = await callTool(
      input,
      [
        {
          role: "system",
          content: [
            "You write the application logic for an Arduino-framework firmware whose hardware set-up is already generated.",
            "",
            input.brief,
            "",
            "Write plain C++ for the Arduino framework. Comment only where the reason is not obvious.",
            "Never redefine a pin, never call pinMode or begin() for a part listed above, and never invent a constant.",
          ].join("\n"),
        },
        { role: "user", content: input.behaviour },
      ],
      {
        name: "firmware_logic",
        description: "Record the application logic for this firmware.",
        parameters: LOGIC_TOOL_PARAMETERS,
      },
    );
    const parsed = parseWithSchema(firmwareLogicSchema, raw, "The generated firmware logic");
    return parsed.ok ? parsed.value : null;
  } catch {
    // Firmware logic is the one optional model step: the deterministic fallback
    // loop already exercises every part, so a failure here is not fatal.
    return null;
  }
}
