import path from "node:path";
import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/server-auth";
import { nangoIntegrationCatalog, nangoLogoPath } from "@/lib/nango/catalog.ts";
import { ApiError, apiErrorResponse } from "@/lib/hermes/route-helpers.ts";
import {
  readBoundedDirectRuntimeFile,
  UnsafeRuntimeFileError,
} from "@/lib/bounded-runtime-file.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_LOGO_BYTES = 256 * 1024;

function logoNotFound(): ApiError {
  return new ApiError(
    404,
    "nango_logo_not_found",
    "Integration logo not found.",
  );
}

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
      throw logoNotFound();
    }
    const logoPath = nangoLogoPath(provider);
    if (!logoPath) throw logoNotFound();

    let logo: Buffer;
    try {
      logo = await readBoundedDirectRuntimeFile({
        allowedRoot: path.dirname(logoPath),
        filePath: logoPath,
        maximumBytes: MAX_LOGO_BYTES,
      });
    } catch (error) {
      if (error instanceof UnsafeRuntimeFileError) throw logoNotFound();
      throw error;
    }
    return new NextResponse(Uint8Array.from(logo), {
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
