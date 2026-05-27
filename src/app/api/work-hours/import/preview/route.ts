import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getApiActor } from "@/lib/api-actor";
import { createPermissionError, createServerError, createValidationError, errorResponse } from "@/lib/api-errors";
import { canImportWorkHours } from "@/lib/permissions";
import { auditPermissionDenied } from "@/lib/permission-audit";
import { previewOperationalWorkHoursImport } from "@/lib/work-hours-service";

export async function POST(request: Request) {
  try {
    const actor = await getApiActor();
    if (!canImportWorkHours({ role: actor.role, status: "ACTIVE" })) {
      const reason = actor.role === "SUPERVISOR" ? "Apenas WFM ou ADMIN podem importar Horas Operacionais." : "Você não tem permissão para importar horas.";
      await auditPermissionDenied(actor, { action: "WORK_HOURS_IMPORT_PREVIEW", entity: "WorkHourRecord", reason });
      return errorResponse(createPermissionError(reason));
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return errorResponse(createValidationError({ file: "Arquivo não enviado." }));
    }

    const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true });
    const sheetName = workbook.SheetNames.find((name) => normalizeSheetName(name) === "horas") ?? workbook.SheetNames[0];
    if (!sheetName) return errorResponse(createValidationError({ file: "O arquivo não possui abas para leitura." }));
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    console.info("[work-hours-import:preview-route]", { fileName: file.name, sheetName, totalRows: rows.length, headers: Object.keys(rows[0] ?? {}).slice(0, 40) });
    return NextResponse.json({ fileName: file.name, ...(await previewOperationalWorkHoursImport(actor, rows)) });
  } catch (error) {
    console.error("[work-hours-import:preview-route] falha inesperada", error);
    return errorResponse(createServerError(error, "Não foi possível ler o arquivo de horas. Verifique o template e tente novamente."));
  }
}

function normalizeSheetName(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}
