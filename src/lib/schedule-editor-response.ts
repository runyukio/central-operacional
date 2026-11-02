/** Older open tabs read this envelope after PATCH. Summaries are loaded separately. */
export function scheduleEditResponse<T>(data: T) {
  return { data, schedules: { attendanceSummary: null }, summary: null, attendanceSummaryDeferred: true };
}

export function requireScheduleData<T>(payload: unknown): { scheduleGridRows: T[]; dateColumns: string[] } {
  if (!payload || typeof payload !== "object" || !("data" in payload)) throw new Error("Não foi possível carregar o cronograma. Tente novamente.");
  const data = payload.data;
  if (!data || typeof data !== "object" || !("scheduleGridRows" in data) || !Array.isArray(data.scheduleGridRows)
    || !("dateColumns" in data) || !Array.isArray(data.dateColumns) || !data.dateColumns.every((date) => typeof date === "string")) {
    throw new Error("A resposta do cronograma está incompleta. Tente novamente.");
  }
  for (const row of data.scheduleGridRows) {
    if (!row || typeof row !== "object" || !row.employee || typeof row.employee.id !== "string" || !row.employee.id
      || typeof row.employee.name !== "string" || !["lob", "shift", "supervisor"].every((key) => typeof row.employee[key] === "string")
      || !Array.isArray(row.days) || row.days.length !== data.dateColumns.length
      || !row.days.every((day: unknown) => typeof day === "string")) throw new Error("Os dados do parceiro estão incompletos. Atualize a consulta.");
  }
  return data as { scheduleGridRows: T[]; dateColumns: string[] };
}

export function requireSavedSchedule(payload: unknown, target: { employeeId: string; date: string }) {
  const data = payload && typeof payload === "object" && "data" in payload ? payload.data : null;
  if (!data || typeof data !== "object" || !("id" in data) || typeof data.id !== "string" || !data.id
    || !("employeeId" in data) || data.employeeId !== target.employeeId || !("date" in data) || typeof data.date !== "string"
    || data.date.slice(0, 10) !== target.date) {
    throw new Error("Não foi possível confirmar a gravação. Consulte o cronograma antes de tentar novamente.");
  }
  return data;
}
