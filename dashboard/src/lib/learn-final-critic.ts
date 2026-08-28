import { createHash } from "node:crypto";
import {
  ANCHOR_CRITIC_SYSTEM_PROMPT,
  CRITIC_SYSTEM_PROMPT,
  buildAnchorCriticPrompt,
  buildCriticUserPrompt,
  buildModelRepairPrompt,
  parseAnchorCriticDecisionStrict,
  parseCriticIssues,
  parseModelRepairOutput,
  type AnchorCriticFn,
  type CriticFn,
  type ModelRepairFn,
} from "./critic-loop.ts";
import {
  runBoundedLearnCouncilSemanticAttempts,
  type LearnCouncilTerminalReceiptProof,
} from "./learn-council-semantic-recovery.ts";

export type LearnFinalCriticRequestKind = "critic" | "anchor_critic" | "model_repair";

export interface LearnFinalCriticCouncilRequest {
  kind: LearnFinalCriticRequestKind;
  semanticAttempt: number;
  stageKey: string;
  stageLabel: string;
  taskType: "critique" | "subsection_repair";
  pageId?: string;
  system: string;
  user: string;
  sourceContext: Record<string, unknown>;
}

export interface LearnFinalCriticProviders {
  critic: CriticFn;
  anchorConfirm: AnchorCriticFn;
  modelRepair: ModelRepairFn;
}

function stablePayloadHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function semanticRetrySuffix(
  priorTerminalReceipt: LearnCouncilTerminalReceiptProof | undefined,
): string {
  if (!priorTerminalReceipt) return "";
  return [
    "",
    "A prior complete Council attempt for this task produced no final answer.",
    `Start a fresh independent semantic attempt. Prior terminal failure code: ${priorTerminalReceipt.failureCode}.`,
    "Return the complete requested result; do not discuss the prior attempt.",
  ].join("\n");
}

/**
 * Build the three model providers used by final semantic publication review.
 * The caller supplies the durable Learn Council executor; this module supplies
 * distinct semantic identities, bounded terminal-receipt recovery, and strict
 * response parsing.
 */
export function createLearnFinalCriticProviders(input: {
  execute: (request: LearnFinalCriticCouncilRequest) => Promise<{ content: string }>;
  maxSemanticAttempts?: number;
  onTerminalReceipt?: (input: {
    kind: LearnFinalCriticRequestKind;
    semanticAttempt: number;
    nextSemanticAttempt: number;
    receipt: LearnCouncilTerminalReceiptProof;
  }) => void | Promise<void>;
}): LearnFinalCriticProviders {
  const maxSemanticAttempts = input.maxSemanticAttempts ?? 2;

  const executeBounded = <T>(args: {
    kind: LearnFinalCriticRequestKind;
    payload: unknown;
    stageLabel: string;
    taskType: LearnFinalCriticCouncilRequest["taskType"];
    pageId?: string;
    system: string;
    user: string;
    sourceContext: Record<string, unknown>;
    parse: (content: string) => T;
  }): Promise<T> => {
    const payloadHash = stablePayloadHash(args.payload);
    return runBoundedLearnCouncilSemanticAttempts({
      maxAttempts: maxSemanticAttempts,
      request: async ({ semanticAttempt, priorTerminalReceipt }) => {
        const result = await input.execute({
          kind: args.kind,
          semanticAttempt,
          stageKey: `finalization:${args.kind}:${payloadHash}`,
          stageLabel: args.stageLabel,
          taskType: args.taskType,
          pageId: args.pageId,
          system: args.system,
          user: `${args.user}${semanticRetrySuffix(priorTerminalReceipt)}`,
          sourceContext: {
            ...args.sourceContext,
            payloadHash,
            semanticAttempt,
            ...(priorTerminalReceipt
              ? {
                  priorTerminalReceipt: {
                    failureCode: priorTerminalReceipt.failureCode,
                    dispatchCount: priorTerminalReceipt.dispatchCount,
                  },
                }
              : {}),
          },
        });
        return args.parse(result.content);
      },
      onTerminalReceipt: (event) => input.onTerminalReceipt?.({
        kind: args.kind,
        ...event,
      }),
    });
  };

  return {
    critic: async (packet) => executeBounded({
      kind: "critic",
      payload: packet,
      stageLabel: "final semantic critic",
      taskType: "critique",
      system: CRITIC_SYSTEM_PROMPT,
      user: buildCriticUserPrompt(packet),
      sourceContext: {
        taskType: "final_semantic_critic",
        gardenTitle: packet.gardenTitle,
        sectionCount: packet.sections.length,
      },
      parse: parseCriticIssues,
    }),
    anchorConfirm: async (packet) => executeBounded({
      kind: "anchor_critic",
      payload: packet,
      stageLabel: `final anchor critic ${packet.anchor.id}`,
      taskType: "critique",
      pageId: packet.anchor.id,
      system: ANCHOR_CRITIC_SYSTEM_PROMPT,
      user: buildAnchorCriticPrompt(packet),
      sourceContext: {
        taskType: "final_anchor_critic",
        anchorId: packet.anchor.id,
      },
      parse: parseAnchorCriticDecisionStrict,
    }),
    modelRepair: async (repairInput) => {
      const targetPath = repairInput.repairRequest.targetPath;
      if (!targetPath) return null;
      const prompt = buildModelRepairPrompt(repairInput);
      return executeBounded({
        kind: "model_repair",
        payload: repairInput,
        stageLabel: `final semantic repair ${targetPath}`,
        taskType: "subsection_repair",
        pageId: targetPath,
        system: prompt.system,
        user: prompt.user,
        sourceContext: {
          taskType: "final_semantic_repair",
          issueId: repairInput.issue.id,
          issueType: repairInput.issue.type,
          targetPath,
        },
        parse: (content) => parseModelRepairOutput(content, targetPath),
      });
    },
  };
}
