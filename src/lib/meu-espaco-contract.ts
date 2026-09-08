export type SpacePeriod = { startDate: string; endDate: string };
export type PendingKind = "absence" | "hours";
export type SpacePending = {
  id: string; kind: PendingKind; date: string; employeeId: string; employeeName: string; wbLogin: string;
  lob: string; supervisorId: string | null; supervisor: string; pending: boolean; status: string;
  reason: string; reasonCategory: string; justification: string; evidenceUrl: string; answeredAt: string | null; answeredBy: string;
  plannedStart: string; plannedEnd: string; capturedMinutes: number | null;
};
export type ManagementCounts = { absences: number; hours: number; answered: number; oldest: string | null };
export type SpaceSummary = {
  actor: { name: string; role: string; canRespond: boolean; broad: boolean };
  selectedSupervisorId: string | null; supervisors: Array<{ id: string; name: string; teamSize: number } & ManagementCounts>;
  management: ManagementCounts; lobs: string[]; period: SpacePeriod;
};
export type SpaceMetric = {
  production: number | null; dailyTeam: number | null; dailyIndividual: number | null;
  ahtSeconds: number | null; cpd: number | null; quality: number | null; abs: number | null;
  productionDays: number; agentDays: number; qualitySamples: number; planned: number; absences: number;
};
export type SpaceResults = {
  period: SpacePeriod;
  groups: Array<{ lob: string; teamSize: number; metric: SpaceMetric; daily: Array<{ date: string; metric: SpaceMetric }>;
    coverage: { productionPartners: number; qualityPartners: number; schedulePartners: number; productionLatest: string | null; qualityLatest: string | null; scheduleLatest: string | null; updatedAt: string | null } }>;
  partners: Array<{ id: string; name: string; wbLogin: string; skill: string; lob: string; metric: SpaceMetric }>;
};
export type SpaceHours = {
  data: Array<{ id: string; employeeId: string; employeeName: string; wbLogin: string; date: string; lob: string;
    plannedHours: number; actualHours: number; capturedHours: number; effectiveHours: number; adjustedHours: number; differenceMinutes: number; status: string }>;
  pagination: { page: number; totalPages: number; total: number };
};
