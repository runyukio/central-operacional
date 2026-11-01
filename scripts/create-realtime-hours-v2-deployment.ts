import { createHash, randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

async function main() {
  if (process.env.REALTIME_HOURS_V2_ENVIRONMENT !== "homologation") throw new Error("Fleet packages must be issued against homologation.");
  if (!process.argv[2]) throw new Error("Specify a private output file for the package authorization.");
  const output = resolve(process.argv[2]);
  const id = randomUUID();
  const deploymentCode = randomBytes(24).toString("base64url");
  const codeHash = createHash("sha256").update(deploymentCode, "utf8").digest("hex");
  const lifetime = process.argv[3] ?? "never";
  if (lifetime !== "never" && (!Number.isFinite(Number(lifetime)) || Number(lifetime) < 1 || Number(lifetime) > 168)) throw new Error("Lifetime must be never or between 1 and 168 hours.");
  const expiresAt = lifetime === "never" ? null : new Date(Date.now() + Number(lifetime) * 60 * 60_000 - 60_000);
  // Only an explicitly authorized operator can enable production delivery.
  const centralDeliveryAllowed = process.argv.includes("--central-delivery");
  await writeFile(output, JSON.stringify({ mode: "fleet", deploymentGrantId: id, deploymentCode, expiresAt: expiresAt?.toISOString() ?? null, installationLimit: null }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "WorkstationDeploymentGrantV2" ("id", "codeHash", "expiresAt", "centralDeliveryAllowed")
    VALUES (${id}, ${codeHash}, ${expiresAt}, ${centralDeliveryAllowed})
  `);
  console.log(JSON.stringify({ output, deploymentGrantId: id, expiresAt: expiresAt?.toISOString() ?? null, installationLimit: null, centralDeliveryAllowed }));
}
main().finally(() => prisma.$disconnect());
