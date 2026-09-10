import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { cecFrtLogin } from "./cec-frt";
import type { UrHours } from "./performance-ur";
import { readUrWorkbook } from "./performance-ur-workbook";
import { authorizePerformanceImport, PerformanceError } from "./performance-service";
import type { Actor } from "./mock-db";

export async function prepareUrSnapshot(actor: Actor, buffer: Buffer | ArrayBuffer) {
  await authorizePerformanceImport(actor);
  let parsed: ReturnType<typeof readUrWorkbook>;
  try { parsed = readUrWorkbook(buffer); } catch (error) { throw new PerformanceError((error as Error).message, 400); }
  const logins = [...new Set(parsed.rows.map((row) => row.wbLogin))];
  const employees = await prisma.$queryRaw<Array<{ id: string; wbLogin: string }>>(Prisma.sql`
    SELECT id, "wbLogin" FROM "EmployeeProfile" WHERE "deletedAt" IS NULL AND lower(trim("wbLogin")) IN (${Prisma.join(logins)})`);
  const byLogin = new Map<string, string>();
  for (const employee of employees) {
    const login = cecFrtLogin(employee.wbLogin);
    if (byLogin.has(login)) throw new PerformanceError(`Login ${login} tem mais de um cadastro. Corrija antes de importar UR.`, 400);
    byLogin.set(login, employee.id);
  }
  const unmatched = logins.filter((login) => !byLogin.has(login));
  const dates = parsed.rows.map((row) => row.day).sort();
  return { rows: parsed.rows.map(({ day, ...row }) => ({ ...row, shiftDate: new Date(`${day}T00:00:00Z`), employeeId: byLogin.get(row.wbLogin) ?? null })),
    summary: { urRows: parsed.rows.length, urStartDate: dates[0], urEndDate: dates.at(-1)!,
      urWarnings: [...parsed.warnings, ...(unmatched.length ? [`${unmatched.length} logins sem cadastro: não serão atribuídos a um agente ou supervisor até novo envio com vínculo válido.`] : [])] } };
}

export type UrDay = UrHours & { employeeId: string | null; wbLogin: string; day: Date; updatedAt: Date;
  employeeName: string; lob: string; supervisorId: string | null; supervisor: string; shiftId: string | null; shift: string };
/** Internal service: callers MUST resolve authorization and pass the permitted employee IDs. */
export async function loadUrDays(start: Date, end: Date, employeeIds: string[]): Promise<UrDay[]> {
  if (!employeeIds.length) return [];
  return prisma.$queryRaw<UrDay[]>(Prisma.sql`
    SELECT u."employeeId", u."wbLogin", u."shiftDate" AS day, MAX(b."importedAt") AS "updatedAt",
      SUM(u."actualModerateHours") FILTER (WHERE u."shiftHours">0)::double precision AS "actualModerateHours",
      SUM(u."shiftHours") FILTER (WHERE u."shiftHours">0)::double precision AS "shiftHours",
      e."fullName" AS "employeeName", l.name AS lob, e."supervisorId", COALESCE(s."fullName",'Sem supervisor') AS supervisor,
      e."shiftId", COALESCE(sh.name,'Sem turno') AS shift
    FROM "PerformanceUrRecord" u
    JOIN "PerformanceImportBatch" b ON b.id=u."importBatchId" AND b.type='UR' AND b.status='SUCCESS'
    JOIN "EmployeeProfile" e ON e.id=u."employeeId" AND e."deletedAt" IS NULL
    JOIN "Lob" l ON l.id=e."lobId"
    LEFT JOIN "EmployeeProfile" s ON s.id=e."supervisorId"
    LEFT JOIN "Shift" sh ON sh.id=e."shiftId"
    WHERE u."shiftDate">=${start}::date AND u."shiftDate"<=${end}::date AND u."employeeId" IN (${Prisma.join(employeeIds)})
    GROUP BY u."employeeId",u."wbLogin",u."shiftDate",e."fullName",l.name,e."supervisorId",s."fullName",e."shiftId",sh.name`);
}
