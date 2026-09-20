import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formatProfileBirthday, getEmployeeProfileDashboard } from "./employee-profile-service";
import { mockPrismaDelegate } from "./prisma-test-delegate";

test("birthday shares only day/month and uses the same UTC calendar as the mural", () => {
  assert.equal(formatProfileBirthday(new Date("1995-01-01T00:00:00Z")), "01/01");
  assert.equal(formatProfileBirthday(new Date("2000-02-29T00:00:00Z")), "29/02");
  assert.equal(formatProfileBirthday(new Date("1988-12-31T00:00:00Z")), "31/12");
  assert.equal(formatProfileBirthday(new Date("2001-09-20T00:00:00Z")), "20/09");
});

test("missing and invalid birthdays remain missing, without an invented date", () => {
  for (const value of [undefined, null, new Date("invalid")]) assert.equal(formatProfileBirthday(value), "");
});

for (const scenario of ["anonymous", "other-profile", "inactive"]) {
  test(`birthday is not read when profile access is denied: ${scenario}`, async (t) => {
    mockPrismaDelegate(t, "user", { findUnique: async () => scenario === "anonymous" ? null : {
      id: "viewer", status: scenario === "inactive" ? "INACTIVE" : "ACTIVE",
      role: { name: "COLABORADOR" }, employeeProfile: { id: "own" }
    } });
    mockPrismaDelegate(t, "employeeProfile", { findFirst: async () => ({ id: "other", userId: "other-user" }) });
    const sensitive = mockPrismaDelegate(t, "employeeSensitiveData", { findUnique: async () => { throw new Error("Must not read birthday"); } });
    const result = await getEmployeeProfileDashboard({ email: "viewer@example.test", name: "Viewer", role: "ADMIN" }, "other");
    assert.ok("type" in result && result.type === "PERMISSION_ERROR");
    assert.equal(sensitive.findUnique.mock.callCount(), 0);
  });
}

test("profile selects only birthDate after authorization and maps only the birthday label", () => {
  const source = readFileSync(new URL("./employee-profile-service.ts", import.meta.url), "utf8");
  assert.ok(source.indexOf("if (!canViewProfile(viewer, employee))") < source.indexOf("prisma.employeeSensitiveData.findUnique"));
  assert.match(source, /employeeSensitiveData\.findUnique\(\{\s*where: \{ employeeId: employee\.id \},\s*select: \{ birthDate: true \}/);
  assert.match(source, /formatProfileBirthday\(record\?\.birthDate\)/);
  const mapping = source.slice(source.indexOf("function mapProfileEmployee"), source.indexOf("async function buildScheduleSummary"));
  assert.match(mapping, /\bbirthday,/);
  assert.doesNotMatch(mapping, /birthDate|sensitiveData/);
});

test("shared profile header displays birthday with a missing-data fallback", () => {
  const source = readFileSync(new URL("../components/employee-profile-page.tsx", import.meta.url), "utf8");
  assert.match(source, /Aniversário: \{data\.employee\.birthday \|\| "Não informado"\}/);
});
