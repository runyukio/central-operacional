import { createHash, randomBytes, randomUUID } from "crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "../src/lib/prisma";

const hours = Math.max(1, Math.min(168, Number(process.argv[2] ?? 24)));
const maxUses = Math.max(1, Math.min(500, Number(process.argv[3] ?? 1)));
const code = randomBytes(24).toString("base64url");
const codeHash = createHash("sha256").update(code, "utf8").digest("hex");
const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1_000);
const id = randomUUID();

await prisma.$executeRaw(Prisma.sql`
  INSERT INTO "WorkstationEnrollmentCodeV2" (
    "id", "codeHash", "expiresAt", "maxUses", "usedCount", "createdAt", "updatedAt"
  ) VALUES (${id}, ${codeHash}, ${expiresAt}, ${maxUses}, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
`);

console.log(JSON.stringify({ enrollmentCode: code, expiresAt: expiresAt.toISOString(), maxUses }, null, 2));
console.error("Este código é exibido uma única vez. Armazene e distribua por canal seguro.");
