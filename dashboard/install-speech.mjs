import { register } from "node:module";
register("./tests/teach-support/server-only-stub.mjs", import.meta.url);
const t = await import("./src/lib/teach/transcription.ts");
console.log("availability:", JSON.stringify(await t.speechAvailability()));
const python = await t.ensureSpeechEnvironment((p) => console.log("progress:", p.stage, p.detail ?? ""));
console.log("READY:", python);
