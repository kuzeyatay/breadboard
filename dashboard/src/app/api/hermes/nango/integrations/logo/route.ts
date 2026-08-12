import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { nangoIntegrationCatalog, nangoLogoPath } from "@/lib/nango/catalog.ts";
import { ApiError, apiErrorResponse } from "@/lib/hermes/route-helpers.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_LOGO_BYTES = 256 * 1024;

export async function GET(request: Request) {
  try {
    await requireUserId();
    const provider = new URL(request.url).searchParams.get("provider")?.trim();
    if (
      !provider ||
      !/^[a-z0-9][a-z0-9-]{0,99}$/.test(provider) ||
      !nangoIntegrationCatalog().some(
        (integration) => integration.provider === provider,
      )
    ) {
      throw new ApiError(
        404,
        "nango_logo_not_found",
        "Integration logo not found.",
      );
    }
    const logoPath = nangoLogoPath(provider);
    if (!logoPath) {
      throw new ApiError(
        404,
        "nango_logo_not_found",
        "Integration logo not found.",
      );
    }
    const metadata = await fs.stat(logoPath);
    if (!metadata.isFile() || metadata.size > MAX_LOGO_BYTES) {
      throw new ApiError(
        404,
        "nango_logo_not_found",
        "Integration logo not found.",
      );
    }
    const logo = await fs.readFile(logoPath);
    return new NextResponse(logo, {
      headers: {
        "Cache-Control": "private, max-age=86400",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'",
        "Content-Type": "image/svg+xml; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
