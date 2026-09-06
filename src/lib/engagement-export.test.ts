import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "./prisma";
import { exportAnonymousFeedbackXlsxData } from "./engagement-service";

const originalFindUser = prisma.user.findUnique;
const originalTransaction = prisma.$transaction;
test.afterEach(() => { prisma.user.findUnique = originalFindUser; prisma.$transaction = originalTransaction; });

test("feedback export collects all pages and never selects private feedback identities", async () => {
  prisma.user.findUnique = (async () => ({ id: "admin", status: "ACTIVE", deletedAt: null, role: { name: "ADMIN" }, employeeProfile: null })) as unknown as typeof prisma.user.findUnique;
  const records = Array.from({ length: 1101 }, (_, i) => ({ id: String(i), createdAt: new Date("2026-09-06T12:00:00Z"),
    category: "Teste", urgency: "NORMAL", status: "RECEBIDO", message: `Synthetic feedback ${i}`,
    lobId: null, jobTitle: null, allowContact: false, resolvedAt: null, adminResponse: null, respondedAt: null }));
  let calls = 0;
  prisma.$transaction = (async (callback: (tx: unknown) => unknown) => callback({ anonymousFeedback: {
    count: async () => records.length,
    findMany: async (args: { cursor?: { id: string }; take: number; select: Record<string, unknown> }) => {
      calls++;
      for (const sensitive of ["submitterUserId", "contactUserId", "securityAnswerHash"]) assert.equal(sensitive in args.select, false);
      const start = args.cursor ? Number(args.cursor.id) + 1 : 0;
      return records.slice(start, start + args.take);
    }
  } })) as typeof prisma.$transaction;
  const result = await exportAnonymousFeedbackXlsxData({ email: "admin@example.com", name: "Admin", role: "ADMIN" });
  assert.equal(result.rows.length, 1101);
  assert.equal(calls, 3);
  assert.equal(result.rows[1100][4], "Synthetic feedback 1100");
});
