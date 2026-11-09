type RuntimeDependencies = {
  getConversationForUser: typeof import("./store.ts").getConversationForUser;
  getRuntimeSessionByConversation: typeof import("../hermes/runtime-store.ts").getRuntimeSessionByConversation;
  runtimeExternalSessionId: typeof import("../hermes/runtime-store.ts").runtimeExternalSessionId;
  conversationOrigin: typeof import("../hermes/session-surface.ts").conversationOrigin;
  resolveConversationRuntime: typeof import("../hermes/session-service.ts").resolveConversationRuntime;
};

async function loadRuntimeDependencies(): Promise<RuntimeDependencies> {
  const [store, runtime, surface] = await Promise.all([
    import("./store.ts"), import("../hermes/runtime-store.ts"), import("../hermes/session-surface.ts"),
  ]);
  return {
    getConversationForUser: store.getConversationForUser,
    getRuntimeSessionByConversation: runtime.getRuntimeSessionByConversation,
    runtimeExternalSessionId: runtime.runtimeExternalSessionId,
    conversationOrigin: surface.conversationOrigin,
    resolveConversationRuntime: async input => {
      const { resolveConversationRuntime } = await import("../hermes/session-service.ts");
      return resolveConversationRuntime(input);
    },
  };
}

/** A specialist may be the first turn in a chat and still must deliver its files. */
export async function ensureAgentArtifactConversation(
  input: { userId: number; conversationPublicId: unknown },
  loadDependencies: () => Promise<RuntimeDependencies> = loadRuntimeDependencies,
): Promise<void> {
  if (input.conversationPublicId == null || input.conversationPublicId === "") return;
  if (!Number.isSafeInteger(input.userId) || input.userId < 1 ||
      typeof input.conversationPublicId !== "string" || !input.conversationPublicId.trim()) {
    throw new TypeError("The agent conversation identity is invalid.");
  }
  const dependencies = await loadDependencies();
  const conversation = dependencies.getConversationForUser(input.conversationPublicId, input.userId);
  if (conversation.surface !== "dashboard_terminal" && conversation.surface !== "garden_chat") {
    throw new Error("Agent artifacts require a supported conversation surface.");
  }
  const session = dependencies.getRuntimeSessionByConversation(conversation.id);
  if (session && dependencies.runtimeExternalSessionId(session)) return;
  await dependencies.resolveConversationRuntime({
    conversation,
    surface: conversation.surface,
    activeGardenSlug: session?.garden_id ?? dependencies.conversationOrigin(conversation).gardenSlug,
    activePageSlug: session?.page_slug ?? null,
  });
}
