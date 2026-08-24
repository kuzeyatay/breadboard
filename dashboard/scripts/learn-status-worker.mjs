import path from "node:path";

const PROTOCOL_VERSION = 1;

function serializeError(error) {
  return {
    name:
      error && typeof error === "object" && typeof error.name === "string"
        ? error.name
        : "Error",
    message:
      error && typeof error === "object" && typeof error.message === "string"
        ? error.message
        : String(error),
  };
}

function validGardenId(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 256 &&
    !value.includes("\0") &&
    !value.includes("/") &&
    !value.includes("\\")
  );
}

function authoritativeContentPath(value) {
  const configured = process.env.QUARTZ_CONTENT_PATH?.trim();
  if (
    !configured ||
    typeof value !== "string" ||
    path.resolve(value) !== path.resolve(configured)
  ) {
    throw new Error(
      "The Learn status worker content path does not match its server environment.",
    );
  }
  return configured;
}

const learn = await import("../src/lib/learn.ts");

process.on("message", async (message) => {
  if (
    !message ||
    typeof message !== "object" ||
    message.protocolVersion !== PROTOCOL_VERSION ||
    message.type !== "status" ||
    typeof message.requestId !== "string" ||
    !message.requestId.trim()
  ) {
    return;
  }

  const base = {
    protocolVersion: PROTOCOL_VERSION,
    requestId: message.requestId,
  };
  try {
    if (!validGardenId(message.gardenId)) {
      throw new Error("The Learn status worker garden ID is invalid.");
    }
    const contentPath = authoritativeContentPath(message.contentPath);
    const snapshot = learn.getLearnStatusSnapshot({
      gardenId: message.gardenId,
      contentPath,
    });
    process.send?.({ ...base, type: "result", snapshot });
  } catch (error) {
    process.send?.({ ...base, type: "failed", error: serializeError(error) });
  }
});

process.on("disconnect", () => {
  process.exit(0);
});

process.send?.({
  protocolVersion: PROTOCOL_VERSION,
  type: "ready",
  pid: process.pid,
});
