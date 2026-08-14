import { revalidatePath } from "next/cache";

import { requireUserId } from "@/lib/server-auth";
import { MAX_TRANSFER_BYTES } from "@/lib/garden-transfer/archive.ts";
import {
  TransferError,
  transferKindForFilename,
} from "@/lib/garden-transfer/format.ts";
import { importTransferArchive } from "@/lib/garden-transfer/import.ts";
import { transferErrorResponse } from "@/lib/garden-transfer/response.ts";

export const dynamic = "force-dynamic";

/**
 * Import a `.garden` or `.cluster` file. Which one it is comes from the
 * envelope inside, not from the filename — the extension is only checked first
 * so an obviously wrong file fails before it is read into memory.
 */
export async function POST(request: Request) {
  try {
    const userId = await requireUserId();

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new TransferError("Expected a file upload.");
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new TransferError("Choose a .garden or .cluster file to import.");
    }
    if (!transferKindForFilename(file.name)) {
      throw new TransferError(
        `"${file.name}" is not a .garden or .cluster file.`,
        415,
      );
    }
    if (file.size > MAX_TRANSFER_BYTES) {
      throw new TransferError(
        `That file is larger than the ${Math.round(MAX_TRANSFER_BYTES / (1024 * 1024))} MB import limit.`,
        413,
      );
    }

    const targetFolderValue = form.get("targetFolder");
    const targetFolder =
      typeof targetFolderValue === "string" ? targetFolderValue : null;

    const result = await importTransferArchive(
      userId,
      Buffer.from(await file.arrayBuffer()),
      { targetFolder },
    );

    revalidatePath("/dashboard");
    revalidatePath("/garden");
    for (const garden of result.gardens) {
      revalidatePath(`/gardens/${garden.slug}`);
      revalidatePath(`/garden/${garden.slug}`);
    }

    return Response.json(result);
  } catch (error) {
    return transferErrorResponse(error);
  }
}
