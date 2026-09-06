import { Prisma } from "@prisma/client";

/** All Request writers must allocate inside the transaction that creates the row. */
export async function nextRequestCode(tx: Prisma.TransactionClient) {
  // A transaction lock serializes BOTH regular and monthly-advance writers.
  // Keep the maximum query after the lock so READ COMMITTED sees the last commit.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(726391, 1)`;
  const rows = await tx.$queryRaw<Array<{ nextNumber: string }>>(Prisma.sql`
    SELECT (GREATEST(COALESCE(MAX(SUBSTRING("code" FROM 5)::numeric), 0), 1000) + 1)::text AS "nextNumber"
    FROM "Request"
    WHERE "code" ~ '^REQ-[0-9]+$'
  `);
  if (!rows[0]?.nextNumber || !/^\d+$/.test(rows[0].nextNumber)) {
    throw new Error("Não foi possível gerar o código da solicitação. Tente novamente.");
  }
  return `REQ-${rows[0].nextNumber.padStart(4, "0")}`;
}
