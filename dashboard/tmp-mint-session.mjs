// Mints a NextAuth v4 JWT session cookie for the garden owner so the ordinary
// authenticated Learn routes can be driven locally. No pipeline behaviour here.
import fs from "node:fs";
import path from "node:path";
import { encode } from "next-auth/jwt";

const dashboard = "C:/Users/20252082/breadboard/dashboard";
const envText = fs.readFileSync(path.join(dashboard, ".env.local"), "utf8");
const secret = envText
  .split(/\r?\n/)
  .map((line) => line.match(/^NEXTAUTH_SECRET\s*=\s*(.*)$/))
  .filter(Boolean)
  .map((m) => m[1].trim().replace(/^["']|["']$/g, ""))
  .pop();

if (!secret) {
  throw new Error("NEXTAUTH_SECRET not found in .env.local");
}

const userId = Number(process.argv[2] ?? 1);
const token = await encode({
  token: { id: String(userId), sub: String(userId), name: "owner" },
  secret,
  maxAge: 60 * 60 * 24,
});

process.stdout.write(token);
