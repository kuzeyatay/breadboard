import { getVercelOidcToken } from "@vercel/oidc";
import { proxyCatalogRequest } from "../../../../lib/catalog-proxy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

type Context = { params: Promise<{ path: string[] }> };

async function handle(request: Request, context: Context): Promise<Response> {
  const { path } = await context.params;
  return proxyCatalogRequest(request, path, {
    // Token acquisition is deliberately request-scoped and exists only in
    // this deployed proxy boundary.
    getOidcToken: () => getVercelOidcToken(),
  });
}

export const GET = handle;
export const HEAD = handle;

function methodNotAllowed(): Response {
  return Response.json(
    { error: "method_not_allowed", message: "Only GET and HEAD are supported." },
    { status: 405, headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" } },
  );
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
