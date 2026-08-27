import { externalRuntimePath as path } from "@/lib/external-runtime-path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { externalRuntimeFilesystem } from "@/lib/external-runtime-filesystem";
import { requireUserId, RouteError } from "@/lib/server-auth";
import {
  cachedExerciseGif,
  localExerciseGif,
  openGymExerciseById,
  remoteExerciseGif,
} from "@/lib/open-gym/catalog.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_GIF_BYTES = 15 * 1024 * 1024;
const runtimeFs = externalRuntimeFilesystem.promises;

function validGif(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 10 || bytes.byteLength > MAX_GIF_BYTES) return false;
  const signature = new TextDecoder("ascii").decode(bytes.slice(0, 6));
  return signature === "GIF87a" || signature === "GIF89a";
}

async function readValidGif(filename: string): Promise<Uint8Array | null> {
  try {
    const bytes = await runtimeFs.readFile(filename);
    return validGif(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ exerciseId: string }> },
) {
  try {
    await requireUserId();
    const { exerciseId } = await params;
    if (!/^[a-z0-9_-]{1,80}$/i.test(exerciseId)) {
      return NextResponse.json({ ok: false, error: "invalid_exercise" }, { status: 400 });
    }
    const exercise = await openGymExerciseById(exerciseId);
    if (!exercise) {
      return NextResponse.json({ ok: false, error: "exercise_not_found" }, { status: 404 });
    }
    let bytes = await readValidGif(localExerciseGif(exercise));
    const cacheFile = cachedExerciseGif(exercise);
    if (!bytes) bytes = await readValidGif(cacheFile);
    if (!bytes) {
      const response = await fetch(remoteExerciseGif(exercise), {
        signal: AbortSignal.timeout(20_000),
        headers: { accept: "image/gif" },
      });
      if (!response.ok) throw new Error(`animation source returned ${response.status}`);
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > MAX_GIF_BYTES) throw new Error("animation is too large");
      bytes = new Uint8Array(await response.arrayBuffer());
      if (!validGif(bytes)) throw new Error("animation source did not return a valid GIF");
      await runtimeFs.mkdir(path.dirname(cacheFile), { recursive: true });
      const temporary = `${cacheFile}.${randomUUID()}.tmp`;
      try {
        await runtimeFs.writeFile(temporary, bytes);
        await runtimeFs.rename(temporary, cacheFile);
      } catch (error) {
        // Two cards can request the same exercise together. If the other one
        // won the atomic rename, use its validated file instead of failing.
        const raced = await readValidGif(cacheFile);
        if (!raced) throw error;
        bytes = raced;
      } finally {
        await runtimeFs.unlink(temporary).catch(() => undefined);
      }
    }
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    return new Response(body, {
      headers: {
        "content-type": "image/gif",
        "content-length": String(bytes.byteLength),
        "cache-control": "private, max-age=604800, immutable",
        "content-disposition": `inline; filename="${path.basename(exercise.gif).replace(/[^a-z0-9_.-]/gi, "-")}"`,
      },
    });
  } catch (error) {
    if (error instanceof RouteError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "animation_unavailable" },
      { status: 502 },
    );
  }
}
