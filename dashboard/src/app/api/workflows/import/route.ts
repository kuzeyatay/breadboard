import { NextRequest, NextResponse } from "next/server";
import { requireUserId, RouteError, routeErrorResponse } from "@/lib/server-auth";
import {
  ensureN8nSession,
  forwardN8nCookie,
  n8nJson,
  publicTemplateJson,
} from "@/lib/workflows/n8n";
import {
  isFreeTemplateListing,
  templateDetailIdentity,
  validateTemplateWorkflow,
} from "@/lib/workflows/template-safety";

export const dynamic = "force-dynamic";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function assertFreeTemplate(templateId: number, name: string): Promise<void> {
  const listing = await publicTemplateJson("templates/search", {
    search: name,
    page: "1",
    limit: "20",
    category: "",
  });
  const root = record(listing);
  const workflows = Array.isArray(root?.workflows) ? root.workflows : [];
  const exact = workflows.find((item) => record(item)?.id === templateId);
  if (!exact || !isFreeTemplateListing(exact)) {
    throw new RouteError(403, "Paid n8n templates must be purchased and imported through their official flow.");
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireUserId();
    const body = await request.json() as { templateId?: unknown };
    const templateId = Number(body.templateId);
    if (!Number.isInteger(templateId) || templateId <= 0) {
      throw new RouteError(400, "A valid workflow template is required.");
    }

    const detail = templateDetailIdentity(
      await publicTemplateJson(`templates/workflows/${templateId}`),
    );
    if (detail.id !== templateId) throw new RouteError(502, "n8n returned the wrong template.");
    await assertFreeTemplate(templateId, detail.name);
    const template = validateTemplateWorkflow(
      await publicTemplateJson(`workflows/templates/${templateId}`),
      templateId,
    );

    const session = await ensureN8nSession(request.cookies.get("n8n-auth")?.value);
    const created = record(await n8nJson("/rest/workflows", {
      method: "POST",
      session,
      body: JSON.stringify({
        name: template.name,
        nodes: template.nodes,
        connections: template.connections,
        settings: { ...template.settings, availableInMCP: false },
        pinData: {},
        meta: { templateId: String(template.id) },
      }),
    }));
    const workflowId = typeof created?.id === "string" ? created.id : "";
    if (!workflowId) throw new RouteError(502, "n8n did not return the imported workflow.");
    const response = NextResponse.json({ workflowId });
    forwardN8nCookie(response, session);
    return response;
  } catch (error) {
    return routeErrorResponse(error);
  }
}
