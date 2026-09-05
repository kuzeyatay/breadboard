import "server-only";
import db from "@/lib/db";

// Retain a removal endpoint for credentials stored by the earlier API-key
// implementation. Nothing reads, decrypts, saves or uses those keys anymore.
export function forgetSpeechApiKey(userId: number): void {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='speech_openai_credentials'").get();
  if (table) db.prepare("DELETE FROM speech_openai_credentials WHERE user_id = ?").run(userId);
}
