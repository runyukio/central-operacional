import assert from "node:assert/strict";
import test from "node:test";
import { searchEmployeeProfiles } from "./employee-profile-service";
import { mockPrismaDelegate } from "./prisma-test-delegate";

const actor = { email: "viewer@example.test", name: "Viewer", role: "ADMIN" as const };
const supervisor = {
  id: "supervisor", fullName: "Hellida Teste", socialName: "Helly", wbLogin: "wb_hellida",
  roleTitle: "Gestora", operationalStatus: "Ativo", skill: "Gestão", wave: null,
  user: { email: "hellida@example.test" }, lob: { name: "TNS" }, supervisor: null, deletedAt: null
};
// Enough alphabetically earlier reports to hide the supervisor under the default limit.
const employees = [
  ...Array.from({ length: 13 }, (_, index) => ({
    ...supervisor, id: `agent-${index}`, fullName: `Agente ${index}`, socialName: null,
    wbLogin: `wb_agent${index}`, roleTitle: "Agente", skill: "Video",
    user: { email: `agent${index}@example.test` }, supervisor: { fullName: supervisor.fullName }
  })),
  supervisor,
  { ...supervisor, id: "deleted", fullName: "Hellida Removida", deletedAt: new Date() }
];

function matches(value: any, condition: any): boolean {
  if (condition === null || typeof condition !== "object") return value === condition;
  if ("contains" in condition) {
    if (typeof value !== "string") return false;
    return condition.mode === "insensitive"
      ? value.toLowerCase().includes(condition.contains.toLowerCase())
      : value.includes(condition.contains);
  }
  return Object.entries(condition).every(([key, predicate]) => key === "OR"
    ? (predicate as unknown[]).some((part) => matches(value, part))
    : matches(value?.[key], predicate));
}

test("global people search finds the supervisor herself, without filling the limit with her team", async (t) => {
  mockPrismaDelegate(t, "user", { findUnique: async () => ({
    id: "viewer", status: "ACTIVE", role: { name: "ADMIN" }, employeeProfile: null
  }) });
  mockPrismaDelegate(t, "employeeProfile", { findMany: async ({ where, take }: any) =>
    employees.filter((employee) => matches(employee, where))
      .sort((a, b) => a.fullName.localeCompare(b.fullName)).slice(0, take)
  });

  for (const query of ["hellida", " HELLIDA ", "wb_hellida", "hellida@example.test", "Helly"]) {
    const result = await searchEmployeeProfiles(actor, query);
    assert.ok("data" in result);
    assert.deepEqual(result.data.map((person) => person.id), ["supervisor"], query);
  }

  const report = await searchEmployeeProfiles(actor, "wb_agent12");
  assert.ok("data" in report);
  assert.deepEqual(report.data.map((person) => person.id), ["agent-12"]);
  assert.equal(report.data[0].supervisor, supervisor.fullName);
});

test("global people search preserves the collaborator's own-profile scope", async (t) => {
  mockPrismaDelegate(t, "user", { findUnique: async () => ({
    id: "viewer", status: "ACTIVE", role: { name: "COLABORADOR" }, employeeProfile: { id: "agent-0" }
  }) });
  mockPrismaDelegate(t, "employeeProfile", { findMany: async ({ where, take }: any) =>
    employees.filter((employee) => matches(employee, where)).slice(0, take)
  });
  const result = await searchEmployeeProfiles(actor, "Hellida");
  assert.ok("data" in result);
  assert.deepEqual(result.data, []);
});
