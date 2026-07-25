import { OpenHarnessGateway } from "../../openharness/gateway.ts";
import {
  agentForSurface,
  readOpenHarnessConfig,
} from "../../openharness/config.ts";
import { directoryForWorkspaceKey } from "../../openharness/workspace.ts";
import type { OpenHarnessMcpConfig } from "../../openharness/client.ts";
import type {
  AgentRuntime,
  CreateRuntimeSessionInput,
  RestoreRuntimeSessionInput,
  RuntimeCapabilities,
  RuntimeSession,
  RuntimeSessionReference,
  RuntimeSurface,
  StartRuntimeRunInput,
  ResolveRuntimeApprovalInput,
} from "../contracts.ts";

/**
 * Compatibility adapter around the existing, tested OpenHarness gateway.
 * Keeping the translation here lets route and conversation code depend on the
 * runtime-neutral boundary before Hermes becomes the selected implementation.
 */
export class OpenHarnessRuntimeAdapter implements AgentRuntime {
  readonly kind = "openharness" as const;
  private readonly gateway: OpenHarnessGateway;

  constructor(gateway = new OpenHarnessGateway()) {
    this.gateway = gateway;
  }

  get enabled(): boolean {
    return this.gateway.enabled;
  }

  async health() {
    const health = await this.gateway.health();
    return {
      healthy: health.healthy,
      version: health.version ?? "unknown",
    };
  }

  listAgents(surface?: RuntimeSurface) {
    return this.gateway.listAgents(surface);
  }

  async listModels() {
    const models = await this.gateway.listModels();
    return models.map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      providerId: model.providerId,
    }));
  }

  async listCapabilities(directory?: string): Promise<RuntimeCapabilities> {
    return this.gateway.capabilityDiscovery(directory);
  }

  managementDirectory(scope?: string | number): string {
    return this.gateway.managementDirectory(scope);
  }

  async createSession(
    input: CreateRuntimeSessionInput,
  ): Promise<RuntimeSession> {
    const created = await this.gateway.createSession(input);
    return {
      externalSessionId: created.openHarnessSessionId,
      directory: created.directory,
      runtimeDirectory: created.runtimeDirectory,
      workspaceKey: created.workspaceKey,
      agentName: created.agentName,
    };
  }

  async restoreSession(
    input: RestoreRuntimeSessionInput,
  ): Promise<RuntimeSession> {
    const config = readOpenHarnessConfig();
    const directory = directoryForWorkspaceKey(config, input.sessionKey);
    return {
      externalSessionId: input.externalSessionId,
      directory,
      runtimeDirectory: directory,
      workspaceKey: input.sessionKey,
      agentName: agentForSurface(config, input.surface, {
        authenticated: input.authenticated,
      }),
    };
  }

  startRun(input: StartRuntimeRunInput): Promise<void> {
    return this.gateway.sendMessage({
      openHarnessSessionId: input.externalSessionId,
      ...input,
    });
  }

  steerRun(
    input: StartRuntimeRunInput & { clientRequestId: string },
  ): Promise<void> {
    return this.gateway.steerRun({
      openHarnessSessionId: input.externalSessionId,
      ...input,
    });
  }

  streamSession(
    input: RuntimeSessionReference,
    signal?: AbortSignal,
    onConnected?: () => void,
  ) {
    return this.gateway.subscribeToSession(
      {
        openHarnessSessionId: input.externalSessionId,
        workspaceKey: input.workspaceKey,
        directory: input.directory,
      },
      signal,
      onConnected,
    );
  }

  resolveApproval(input: ResolveRuntimeApprovalInput): Promise<void> {
    return this.gateway.respondToPermission({
      openHarnessSessionId: input.externalSessionId,
      workspaceKey: input.workspaceKey,
      directory: input.directory,
      requestId: input.requestId,
      decision: input.decision,
    });
  }

  stopRun(input: RuntimeSessionReference): Promise<void> {
    return this.gateway.abortSession({
      openHarnessSessionId: input.externalSessionId,
      workspaceKey: input.workspaceKey,
      directory: input.directory,
    });
  }

  async disposeSession(input: RuntimeSessionReference): Promise<void> {
    await this.stopRun(input).catch(() => undefined);
  }

  applyCapabilityDecision(input: {
    externalSessionId: string;
    liveSessionId?: string;
    workspaceKey: string;
    directory?: string;
    decision: Parameters<OpenHarnessGateway["applyCapabilityDecision"]>[0]["decision"];
  }): Promise<void> {
    return this.gateway.applyCapabilityDecision({
      openHarnessSessionId: input.externalSessionId,
      workspaceKey: input.workspaceKey,
      directory: input.directory,
      decision: input.decision,
    });
  }

  addMcpConnection(
    directory: string,
    name: string,
    config: unknown,
    _userId?: number,
  ): Promise<unknown> {
    return this.gateway.addMcpConnection(
      directory,
      name,
      config as OpenHarnessMcpConfig,
    );
  }

  setMcpConnectionConnected(
    directory: string,
    name: string,
    connected: boolean,
    _userId?: number,
  ): Promise<unknown> {
    return this.gateway.setMcpConnectionConnected(
      directory,
      name,
      connected,
    );
  }

  startMcpAuthentication(
    directory: string,
    name: string,
    _userId?: number,
  ): Promise<unknown> {
    return this.gateway.startMcpAuthentication(directory, name);
  }
}
