export type WorkHourAdherenceFilters = {
  startDate: string;
  endDate: string;
  lob: string;
  supervisorId: string;
  shift: string;
  employeeId: string;
  collaborator?: string;
  justificationStatus: string;
};

type FilterableAdherenceRow = {
  date: string;
  lob: string;
  supervisorId: string;
  shift: string;
  employeeId: string;
  status: string;
  employeeName?: string;
  wbLogin?: string;
};

export function initialAdherenceFilters(period: { startDate: string; endDate: string }): WorkHourAdherenceFilters {
  return { ...period, lob: "Todos", supervisorId: "Todos", shift: "Todos", employeeId: "Todos", justificationStatus: "Todos" };
}

export type AdherenceFilterOptions = {
  lobs: string[];
  supervisors: Array<{ id: string; name: string }>;
  shifts: string[];
};

export function reconcileAdherenceFilters(filters: WorkHourAdherenceFilters, options: AdherenceFilterOptions) {
  const lob = options.lobs.includes(filters.lob) ? filters.lob : "Todos";
  return { ...filters, lob,
    supervisorId: lob !== "Todos" && options.supervisors.some((item) => item.id === filters.supervisorId) ? filters.supervisorId : "Todos",
    shift: options.shifts.includes(filters.shift) ? filters.shift : "Todos"
  };
}

export function adherenceFilterQuery(filters: Partial<WorkHourAdherenceFilters>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value && (value !== "Todos" || key === "collaborator")) params.set(key, value);
  }
  return params.toString();
}

// Presentation filters only; eligibility and authorization stay in the existing service.
// Shared by the table and export so the status/supervisor selection has one meaning.
export function filterWorkHourAdherenceRows<T extends FilterableAdherenceRow>(rows: T[], filters: Partial<WorkHourAdherenceFilters>) {
  const matches = (value: string, selected?: string) => !selected || selected === "Todos" || value === selected;
  const status = filters.justificationStatus === "Pendentes" ? "Pendente"
    : filters.justificationStatus === "Justificados" ? "Justificado" : filters.justificationStatus;
  return rows.filter((row) => (
    (!filters.startDate || row.date >= filters.startDate)
    && (!filters.endDate || row.date <= filters.endDate)
    && matches(row.lob, filters.lob)
    && matches(row.supervisorId, filters.supervisorId)
    && matches(row.shift, filters.shift)
    && matches(row.employeeId, filters.employeeId)
    && (!filters.collaborator?.trim() || [row.employeeName, row.wbLogin].some((value) => value?.toLocaleLowerCase().includes(filters.collaborator!.trim().toLocaleLowerCase())))
    && matches(row.status, status)
  ));
}

export function groupWorkHourAdherenceByDay<T extends { date: string; employeeName: string }>(rows: T[]) {
  const days = new Map<string, T[]>();
  for (const row of rows) {
    const entries = days.get(row.date) ?? [];
    entries.push(row);
    days.set(row.date, entries);
  }
  return Array.from(days, ([date, entries]) => ({
    date,
    rows: entries.sort((a, b) => a.employeeName.localeCompare(b.employeeName, "pt-BR"))
  })).sort((a, b) => b.date.localeCompare(a.date));
}
