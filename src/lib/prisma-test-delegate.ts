import type { TestContext } from "node:test";
import { prisma } from "./prisma";

/** Replace Prisma's dynamic proxy at the boundary; never open a database connection. */
export function mockPrismaDelegate(t: TestContext, model: string, methods: Record<string, (...args: any[]) => any>) {
  const client = prisma as unknown as Record<string, unknown>;
  const original = client[model];
  const delegate = Object.fromEntries(Object.entries(methods).map(([name, method]) => [name, t.mock.fn(method)]));
  client[model] = delegate;
  t.after(() => { client[model] = original; });
  return delegate;
}
