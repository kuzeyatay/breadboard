import fs from "node:fs";
import { encode, decode } from "next-auth/jwt";
const t = fs.readFileSync("C:/Users/20252082/breadboard/dashboard/.env.local", "utf8");
const secret = t.split(/\r?\n/).map(l=>l.match(/^NEXTAUTH_SECRET\s*=\s*(.*)$/)).filter(Boolean).map(m=>m[1].trim().replace(/^["']|["']$/g,"")).pop();
console.log("secret length:", secret.length);
const tok = await encode({ token: { id: "1", sub: "1" }, secret, maxAge: 3600 });
console.log("roundtrip:", JSON.stringify(await decode({ token: tok, secret })));
