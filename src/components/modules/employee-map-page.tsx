"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Check, ChevronDown, LockKeyhole, Plus, UsersRound } from "lucide-react";
import { EmptyState, MetricPill, MiniAlertList, PageHeader, Panel, SimpleTable, StatusBadge } from "@/components/ui/primitives";
import { parseWbLoginBatch, serializeWbLogins } from "@/lib/batch-wb-filter";
import { canEditEmployeeData, canEditEmployeeSensitiveData, canManageRoles } from "@/lib/permissions";
import { cn, initials } from "@/lib/utils";
import { cleanShiftName, isSelectableShiftName } from "@/lib/shift-display";
import { ApiRequestError, EmployeeClient, EmployeeListResponse, FormInput, FormSelect, InfoLine, SystemSettings, apiJson, displaySystemRole, employeeMapStatusLabel, employeeOperationalStatusOptions, employeeStatusKey, pcdDisabilityTypeOptions } from './shared';
const employeeInactiveAccessStatusKeys = new Set([
  "INACTIVE",
  "INATIVO",
  "INATIVA",
  "DESATIVADO",
  "DESATIVADA",
  "DESLIGADO",
  "DESLIGADA",
  "DESLIGADO_EM_TREINAMENTO",
  "DESLIGADA_EM_TREINAMENTO",
  "DESLIGADO_TREINAMENTO",
  "DESLIGADA_TREINAMENTO",
  "TERMINATED",
  "DISABLED"
]);


function isInactiveEmployeeAccessStatus(value?: string | null) {
  return employeeInactiveAccessStatusKeys.has(employeeStatusKey(value ?? ""));
}


function employeeAccessStatusFromProfile(status?: string | null, userStatusRaw?: string | null, terminationDateIso?: string | null, userStatusLabel?: string | null) {
  const accessKey = employeeStatusKey(userStatusRaw ?? userStatusLabel ?? "");
  if (isInactiveEmployeeAccessStatus(status) || isPastOrTodayDateInput(terminationDateIso)) return "INACTIVE";
  if (accessKey === "BLOCKED" || accessKey === "BLOQUEADO" || accessKey === "SUSPENSO") return "BLOCKED";
  if (accessKey === "INACTIVE" || accessKey === "INATIVO" || accessKey === "INATIVA") return "INACTIVE";
  return "ACTIVE";
}


function isPastOrTodayDateInput(value?: string | null) {
  if (!value) return false;
  const dateKey = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
  return dateKey <= todayDateInput();
}


function todayDateInput() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}


function employeeMapLobFilterLabel(lob: string) {
  const key = String(lob ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return ["TNS", "VIDEO", "VIDEOS", "COMMENTS", "COMENTARIOS"].includes(key) ? "TNS" : lob;
}


type EmployeeMultiSelectOption = {
  value: string;
  label: string;
};


function EmployeeMultiSelectFilter({
  ariaLabel,
  allLabel,
  options,
  values,
  onChange
}: {
  ariaLabel: string;
  allLabel: string;
  options: EmployeeMultiSelectOption[];
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const selectedLabels = options.filter((option) => values.includes(option.value)).map((option) => option.label);
  const displayLabel = selectedLabels.length === 0
    ? allLabel
    : selectedLabels.length === 1
      ? selectedLabels[0]
      : `${selectedLabels.length} selecionados`;

  function toggleValue(value: string) {
    onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }

  return (
    <details className="group relative min-w-0">
      <summary
        aria-label={ariaLabel}
        className="flex h-10 cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-border bg-white px-3 text-sm font-bold text-navy-950 outline-none transition hover:border-blue-300 focus-visible:border-blue-400 focus-visible:ring-2 focus-visible:ring-blue-100 [&::-webkit-details-marker]:hidden"
      >
        <span className="min-w-0 truncate">{displayLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="absolute left-0 z-40 mt-2 w-max min-w-full max-w-[min(320px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-white shadow-xl">
        <div className="max-h-72 overflow-y-auto p-1.5">
          <button
            type="button"
            onClick={() => onChange([])}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-bold text-navy-950 hover:bg-slate-50"
          >
            <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", values.length === 0 ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-transparent")}>
              <Check className="h-3 w-3" />
            </span>
            <span>{allLabel}</span>
          </button>
          {options.map((option) => {
            const selected = values.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => toggleValue(option.value)}
                className={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-semibold hover:bg-slate-50", selected && "bg-blue-50 text-blue-700")}
              >
                <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border", selected ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-transparent")}>
                  <Check className="h-3 w-3" />
                </span>
                <span className="truncate">{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </details>
  );
}


function formatCpfInputValue(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}


function formatCnpjInputValue(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 14);
  if (digits.length <= 2) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`;
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`;
  if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`;
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}


export function EmployeeMapPage() {
  const { data: session } = useSession();
  const [query, setQuery] = useState("");
  const [employeeRows, setEmployeeRows] = useState<EmployeeClient[]>([]);
  const [employeeSettings, setEmployeeSettings] = useState<SystemSettings | null>(null);
  const [selected, setSelected] = useState<EmployeeClient | null>(null);
  const [employeeMessage, setEmployeeMessage] = useState("");
  const [employeeLoading, setEmployeeLoading] = useState(true);
  const [selectedEmployeeLoading, setSelectedEmployeeLoading] = useState(false);
  const [lobFilter, setLobFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [supervisorFilter, setSupervisorFilter] = useState<string[]>([]);
  const [roleTitleFilter, setRoleTitleFilter] = useState<string[]>([]);
  const [skillFilter, setSkillFilter] = useState<string[]>([]);
  const [waveFilter, setWaveFilter] = useState<string[]>([]);
  const [shiftFilter, setShiftFilter] = useState<string[]>([]);
  const [contractFilter, setContractFilter] = useState<string[]>([]);
  const [employeeBatchWbs, setEmployeeBatchWbs] = useState<string[]>([]);
  const [employeeBatchText, setEmployeeBatchText] = useState("");
  const [employeeBatchOpen, setEmployeeBatchOpen] = useState(false);
  const [employeeFilterOptions, setEmployeeFilterOptions] = useState<{ skills: string[]; waves: string[]; roleTitles?: string[]; statuses?: string[] }>({ skills: [], waves: [], roleTitles: [], statuses: [] });
  const [employeePage, setEmployeePage] = useState(1);
  const [employeePagination, setEmployeePagination] = useState({ total: 0, page: 1, limit: 50, totalPages: 1 });
  const [employeeContractSummary, setEmployeeContractSummary] = useState({ clt: 0, pj: 0 });
  const [editingEmployee, setEditingEmployee] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [socialNameDraft, setSocialNameDraft] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [userStatusDraft, setUserStatusDraft] = useState("ACTIVE");
  const [wbDraft, setWbDraft] = useState("");
  const [roleTitleDraft, setRoleTitleDraft] = useState("");
  const [statusDraft, setStatusDraft] = useState("");
  const [roleDraft, setRoleDraft] = useState("");
  const [skillDraft, setSkillDraft] = useState("");
  const [skillIdsDraft, setSkillIdsDraft] = useState<string[]>([]);
  const [primarySkillIdDraft, setPrimarySkillIdDraft] = useState("");
  const [waveDraft, setWaveDraft] = useState("");
  const [supervisorDraft, setSupervisorDraft] = useState("");
  const [lobDraft, setLobDraft] = useState("");
  const [shiftDraft, setShiftDraft] = useState("");
  const [workStartTimeDraft, setWorkStartTimeDraft] = useState("");
  const [workEndTimeDraft, setWorkEndTimeDraft] = useState("");
  const [contractDraft, setContractDraft] = useState("");
  const [admissionDraft, setAdmissionDraft] = useState("");
  const [nestingStartDraft, setNestingStartDraft] = useState("");
  const [goLiveDraft, setGoLiveDraft] = useState("");
  const [terminationDraft, setTerminationDraft] = useState("");
  const [terminationTypeDraft, setTerminationTypeDraft] = useState("");
  const [terminationReasonDraft, setTerminationReasonDraft] = useState("");
  const [ethnicityDraft, setEthnicityDraft] = useState("");
  const [sexualOrientationDraft, setSexualOrientationDraft] = useState("");
  const [isPcdDraft, setIsPcdDraft] = useState("");
  const [pcdDisabilityTypeDraft, setPcdDisabilityTypeDraft] = useState("");
  const [pcdDisabilityOtherDraft, setPcdDisabilityOtherDraft] = useState("");
  const [firstJobDraft, setFirstJobDraft] = useState("");
  const [hasTelemarketingExperienceDraft, setHasTelemarketingExperienceDraft] = useState("");
  const [telemarketingWhereDraft, setTelemarketingWhereDraft] = useState("");
  const [primaryPhoneDraft, setPrimaryPhoneDraft] = useState("");
  const [cityDraft, setCityDraft] = useState("");
  const [stateUfDraft, setStateUfDraft] = useState("");
  const [preferredScheduleDraft, setPreferredScheduleDraft] = useState("");
  const [cpfDraft, setCpfDraft] = useState("");
  const [cnpjDraft, setCnpjDraft] = useState("");
  const [internalNotesDraft, setInternalNotesDraft] = useState("");
  const [savingEmployee, setSavingEmployee] = useState(false);
  const [employeeFieldErrors, setEmployeeFieldErrors] = useState<Record<string, string>>({});
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetPasswordForm, setResetPasswordForm] = useState({ password: "", confirmPassword: "" });
  const [resettingPassword, setResettingPassword] = useState(false);
  const [showDeleteEmployee, setShowDeleteEmployee] = useState(false);
  const [deleteEmployeeForm, setDeleteEmployeeForm] = useState({ reason: "", confirmation: "" });
  const [deletingEmployee, setDeletingEmployee] = useState(false);
  const employeeMapLobs = Array.from(new Set((employeeSettings?.lobs.filter((lob) => lob.status !== "INACTIVE").map((lob) => employeeMapLobFilterLabel(lob.name)) ?? employeeRows.map((employee) => employeeMapLobFilterLabel(employee.lob)).filter(Boolean))));
  const employeeStatusOptions = Array.from(new Set((employeeFilterOptions.statuses?.length ? employeeFilterOptions.statuses : employeeOperationalStatusOptions).filter(Boolean)));
  const employeeSupervisorOptions = employeeSettings?.supervisors?.filter((supervisor) => supervisor.status !== "INACTIVE") ?? [];
  const employeeRoleTitleFilterOptions = Array.from(new Set([...(employeeSettings?.roleTitles.filter((title) => title.status !== "INACTIVE").map((title) => title.name) ?? []), ...(employeeFilterOptions.roleTitles ?? [])].filter(Boolean)));
  const employeeSkillOptions = ["SEM_SKILL", ...employeeFilterOptions.skills.filter(Boolean)];
  const employeeWaveOptions = ["SEM_WAVE", ...employeeFilterOptions.waves.filter(Boolean)];
  const hasEmployeeFilters = Boolean(query.trim()) || employeeBatchWbs.length > 0 || [lobFilter, statusFilter, supervisorFilter, roleTitleFilter, skillFilter, waveFilter, shiftFilter, contractFilter].some((values) => values.length > 0);
  const employeePermissionUser = { role: session?.user?.role };
  const isAdmin = canManageRoles(employeePermissionUser);
  const isSupervisorUser = session?.user?.role === "SUPERVISOR";
  const canEditEmployeeOperational = canEditEmployeeData(employeePermissionUser);
  const canEditOperationalBindings = canEditEmployeeOperational;
  const canEditPeopleData = canEditEmployeeSensitiveData(employeePermissionUser);
  const selectedCanEditEmployeeOperational = canEditEmployeeOperational && (selected?.canEditOperationalData ?? true);
  const selectedCanEditPeopleData = canEditPeopleData && (selected?.canEditPeopleData ?? true);
  const employeeLobOptions = employeeSettings?.lobs.filter((lob) => lob.status !== "INACTIVE") ?? [];
  const employeeShiftOptions = employeeSettings?.shifts.filter((shift) => shift.status !== "INACTIVE" && isSelectableShiftName(shift.name)) ?? [];
  const employeeRoleTitleOptions = employeeSettings?.roleTitles.filter((title) => title.status !== "INACTIVE").map((title) => title.name) ?? [];
  const employeeRoleOptions = employeeSettings?.roles.filter((roleItem) => roleItem.status !== "INACTIVE").map((roleItem) => roleItem.name) ?? ["COLABORADOR", "SUPERVISOR", "WFM", "QUALIDADE", "RH", "FINANCEIRO", "TI", "RTA", "POC", "GESTOR", "CLIENT", "ADMIN"];
  const contractOptions = ["CLT", "PJ", "Temporário", "Estágio", "Terceiro", "Outro"];
  const terminationTypeOptions = ["", "Voluntário", "Involuntário"];
  const ethnicityOptions = ["", "Branca", "Preta", "Parda", "Amarela", "Indígena", "Prefiro não informar"];
  const sexualOrientationOptions = ["", "Heterossexual", "Homossexual", "Bissexual", "Assexual", "Outra", "Prefiro não informar"];
  const yesNoPreferNotOptions = ["", "Sim", "Não", "Prefiro não informar"];
  const operationalStatusOptions = employeeOperationalStatusOptions;

  useEffect(() => {
    const initialSearch = new URLSearchParams(window.location.search).get("search") ?? "";
    setQuery(initialSearch);
    void loadEmployees({ nextQuery: initialSearch });
    apiJson<{ data: SystemSettings }>("/api/settings")
      .then((payload) => setEmployeeSettings(payload.data))
      .catch(() => setEmployeeSettings(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadEmployees(options?: { nextQuery?: string; nextLob?: string[]; nextStatus?: string[]; nextSupervisor?: string[]; nextRoleTitle?: string[]; nextSkill?: string[]; nextWave?: string[]; nextShift?: string[]; nextContract?: string[]; nextBatchWbs?: string[]; nextPage?: number }) {
    setEmployeeLoading(true);
    const nextQuery = options?.nextQuery ?? query;
    const nextLob = options?.nextLob ?? lobFilter;
    const nextStatus = options?.nextStatus ?? statusFilter;
    const nextSupervisor = options?.nextSupervisor ?? supervisorFilter;
    const nextRoleTitle = options?.nextRoleTitle ?? roleTitleFilter;
    const nextSkill = options?.nextSkill ?? skillFilter;
    const nextWave = options?.nextWave ?? waveFilter;
    const nextShift = options?.nextShift ?? shiftFilter;
    const nextContract = options?.nextContract ?? contractFilter;
    const nextBatchWbs = options?.nextBatchWbs ?? employeeBatchWbs;
    const nextPage = options?.nextPage ?? employeePage;
    const params = new URLSearchParams({ summary: "true", limit: "50", page: String(nextPage) });
    if (nextQuery.trim()) params.set("search", nextQuery.trim());
    nextLob.forEach((value) => params.append("lob", value));
    nextStatus.forEach((value) => params.append("status_colaborador", value));
    nextSupervisor.forEach((value) => params.append("supervisorId", value));
    nextRoleTitle.forEach((value) => params.append("roleTitle", value));
    nextSkill.forEach((value) => params.append("skill", value));
    nextWave.forEach((value) => params.append("wave", value));
    nextShift.forEach((value) => params.append("shiftId", value));
    nextContract.forEach((value) => params.append("contractType", value));
    if (nextBatchWbs.length) params.set("wbLogins", serializeWbLogins(nextBatchWbs));
    try {
      const employeePayload = await apiJson<EmployeeListResponse>(`/api/employees?${params.toString()}`);
      if (!employeePayload.data?.length && Number(employeePayload.total ?? 0) > 0 && nextPage > 1) {
        setEmployeePage(1);
        await loadEmployees({ nextQuery, nextLob, nextStatus, nextSupervisor, nextRoleTitle, nextSkill, nextWave, nextShift, nextContract, nextBatchWbs, nextPage: 1 });
        return;
      }
      setEmployeeRows(employeePayload.data);
	      setEmployeeFilterOptions(employeePayload.filterOptions ?? { skills: [], waves: [], roleTitles: [], statuses: [] });
      setEmployeeContractSummary(employeePayload.contractSummary ?? { clt: 0, pj: 0 });
      if (employeePayload.batchWb?.notFound.length) {
        setEmployeeMessage(`${employeePayload.batchWb.applied.length} login(s) aplicados. ${employeePayload.batchWb.notFound.length} não encontrado(s): ${employeePayload.batchWb.notFound.join(", ")}.`);
      } else if (employeeMessage.includes("login(s) aplicados")) {
        setEmployeeMessage("");
      }
      setEmployeePagination({
        total: employeePayload.total ?? employeePayload.data.length,
        page: employeePayload.page ?? nextPage,
        limit: employeePayload.limit ?? 50,
        totalPages: employeePayload.totalPages ?? Math.max(1, Math.ceil((employeePayload.total ?? employeePayload.data.length) / 50))
      });
      setEmployeePage(employeePayload.page ?? nextPage);
      setSelected(null);
    } catch {
      setEmployeeRows([]);
	      setEmployeeFilterOptions({ skills: [], waves: [], roleTitles: [], statuses: [] });
      setEmployeeContractSummary({ clt: 0, pj: 0 });
      setEmployeePagination({ total: 0, page: 1, limit: 50, totalPages: 1 });
    } finally {
      setEmployeeLoading(false);
    }
  }

  function addEmployeeBatchWbs() {
    const parsed = parseWbLoginBatch(employeeBatchText);
    if (!parsed.values.length) {
      setEmployeeMessage("Cole um ou mais WB/Login para aplicar o filtro em lote.");
      return;
    }
    const nextBatchWbs = Array.from(new Set([...employeeBatchWbs, ...parsed.values]));
    setEmployeeBatchWbs(nextBatchWbs);
    setEmployeeBatchText("");
    setEmployeeBatchOpen(false);
    setEmployeePage(1);
    setEmployeeMessage(`${parsed.values.length} login(s) adicionados ao filtro em lote${parsed.duplicatesRemoved ? `; ${parsed.duplicatesRemoved} duplicado(s) ignorado(s)` : ""}.`);
    void loadEmployees({ nextBatchWbs, nextPage: 1 });
  }

  function removeEmployeeBatchWb(value: string) {
    const nextBatchWbs = employeeBatchWbs.filter((item) => item !== value);
    setEmployeeBatchWbs(nextBatchWbs);
    setEmployeePage(1);
    void loadEmployees({ nextBatchWbs, nextPage: 1 });
  }

  function clearEmployeeBatchWbs() {
    setEmployeeBatchWbs([]);
    setEmployeePage(1);
    void loadEmployees({ nextBatchWbs: [], nextPage: 1 });
  }

  async function selectEmployee(employee: EmployeeClient) {
    setSelected(employee);
    setSelectedEmployeeLoading(true);
    try {
      const payload = await apiJson<{ data: EmployeeClient }>(`/api/employees/${employee.id}`);
      setSelected(payload.data);
      setEmployeeRows((items) => items.map((item) => (item.id === payload.data.id ? { ...item, ...payload.data } : item)));
    } catch (error) {
      setEmployeeMessage(error instanceof Error ? error.message : "Não foi possível carregar o detalhe do parceiro.");
    } finally {
      setSelectedEmployeeLoading(false);
    }
  }

  useEffect(() => {
    if (!selected) return;
    setEditingEmployee(false);
    setNameDraft(selected.name ?? "");
    setSocialNameDraft(selected.socialName ?? "");
    setEmailDraft(selected.email ?? "");
    setUserStatusDraft(employeeAccessStatusFromProfile(selected.status, selected.userStatusRaw, selected.terminationDateIso, selected.userStatus));
    setWbDraft(selected.wb ?? "");
    setRoleTitleDraft(selected.role ?? "");
    setStatusDraft(employeeMapStatusLabel(selected.status ?? ""));
    setRoleDraft(selected.systemRole ?? "COLABORADOR");
    setSkillDraft(selected.skill ?? "");
    setSkillIdsDraft((selected.skills ?? []).filter((skill) => !skill.id.startsWith("legacy:")).map((skill) => skill.id));
    setPrimarySkillIdDraft((selected.skills ?? []).find((skill) => skill.isPrimary && !skill.id.startsWith("legacy:"))?.id ?? "");
    setWaveDraft(selected.wave ?? "");
    setSupervisorDraft(selected.supervisorId ?? "");
    setLobDraft(selected.lobId ?? "");
	    setShiftDraft(selected.shiftId ?? "");
    setWorkStartTimeDraft(selected.workStartTime ?? "");
    setWorkEndTimeDraft(selected.workEndTime ?? "");
    setContractDraft(selected.contractType ?? "");
    setAdmissionDraft(selected.admissionIso ?? "");
    setNestingStartDraft(selected.nestingStartDateIso ?? "");
    setGoLiveDraft(selected.goLiveDateIso ?? "");
    setTerminationDraft(selected.terminationDateIso ?? "");
    setTerminationTypeDraft(selected.terminationType ?? "");
    setTerminationReasonDraft(selected.terminationReason ?? "");
    setEthnicityDraft(selected.ethnicity ?? "");
    setSexualOrientationDraft(selected.sexualOrientation ?? "");
    setIsPcdDraft(selected.isPcd ?? "");
    setPcdDisabilityTypeDraft(selected.pcdDisabilityType ?? "");
    setPcdDisabilityOtherDraft(selected.pcdDisabilityOther ?? "");
    setFirstJobDraft(selected.firstJob ?? "");
    setHasTelemarketingExperienceDraft(selected.hasTelemarketingExperience ?? "");
    setTelemarketingWhereDraft(selected.telemarketingWhere ?? "");
    setPrimaryPhoneDraft(selected.primaryPhone ?? "");
    setCityDraft(selected.city ?? "");
    setStateUfDraft(selected.stateUf ?? "");
    setPreferredScheduleDraft(selected.preferredSchedule ?? "");
    setCpfDraft(selected.canViewSensitive ? formatCpfInputValue(selected.sensitive?.cpf ?? "") : "");
    setCnpjDraft(selected.canViewSensitive ? formatCnpjInputValue(selected.sensitive?.cnpj ?? "") : "");
    setInternalNotesDraft(selected.internalNotes ?? "");
    setEmployeeFieldErrors({});
  }, [selected]);

  async function saveEmployeeOperationalData() {
    if (!selected || savingEmployee) return;
    setSavingEmployee(true);
    setEmployeeMessage("");
    setEmployeeFieldErrors({});
    try {
      const payload = await apiJson<{ data: EmployeeClient }>("/api/employees", {
        method: "PATCH",
        body: JSON.stringify({
          id: selected.id,
          fullName: selectedCanEditPeopleData ? nameDraft : undefined,
          socialName: selectedCanEditPeopleData ? socialNameDraft : undefined,
          email: selectedCanEditPeopleData ? emailDraft : undefined,
          userStatus: selectedCanEditPeopleData ? userStatusDraft : undefined,
          wbLogin: selectedCanEditPeopleData ? wbDraft : undefined,
          roleTitle: roleTitleDraft,
          operationalStatus: statusDraft,
          roleName: isAdmin ? roleDraft : undefined,
          skill: selectedCanEditEmployeeOperational && !employeeSettings?.skills?.length ? skillDraft : undefined,
          skillIds: selectedCanEditEmployeeOperational && employeeSettings?.skills?.length ? skillIdsDraft : undefined,
          primarySkillId: selectedCanEditEmployeeOperational && employeeSettings?.skills?.length ? primarySkillIdDraft : undefined,
          wave: selectedCanEditEmployeeOperational ? waveDraft : undefined,
          supervisorId: canEditOperationalBindings ? supervisorDraft : undefined,
	          lobId: canEditOperationalBindings ? lobDraft || undefined : undefined,
	          shiftId: canEditOperationalBindings ? shiftDraft || undefined : undefined,
          workStartTime: selectedCanEditEmployeeOperational ? workStartTimeDraft : undefined,
          workEndTime: selectedCanEditEmployeeOperational ? workEndTimeDraft : undefined,
          contractType: selectedCanEditPeopleData ? contractDraft : undefined,
          admissionDate: selectedCanEditPeopleData ? admissionDraft : undefined,
          nestingStartDate: selectedCanEditEmployeeOperational ? nestingStartDraft : undefined,
          goLiveDate: selectedCanEditEmployeeOperational ? goLiveDraft : undefined,
	          terminationDate: selectedCanEditPeopleData ? terminationDraft : undefined,
	          terminationType: selectedCanEditPeopleData ? terminationTypeDraft : undefined,
	          terminationReason: selectedCanEditPeopleData ? terminationReasonDraft : undefined,
	          ethnicity: selectedCanEditPeopleData ? ethnicityDraft : undefined,
	          sexualOrientation: selectedCanEditPeopleData ? sexualOrientationDraft : undefined,
          isPcd: selectedCanEditPeopleData ? isPcdDraft : undefined,
          pcdDisabilityType: selectedCanEditPeopleData ? pcdDisabilityTypeDraft : undefined,
          pcdDisabilityOther: selectedCanEditPeopleData ? pcdDisabilityOtherDraft : undefined,
	          firstJob: selectedCanEditPeopleData ? firstJobDraft : undefined,
	          hasTelemarketingExperience: selectedCanEditPeopleData ? hasTelemarketingExperienceDraft : undefined,
	          telemarketingWhere: selectedCanEditPeopleData ? telemarketingWhereDraft : undefined,
	          internalNotes: selectedCanEditEmployeeOperational ? internalNotesDraft : undefined,
          primaryPhone: selectedCanEditPeopleData ? primaryPhoneDraft : undefined,
          city: selectedCanEditPeopleData ? cityDraft : undefined,
          stateUf: selectedCanEditPeopleData ? stateUfDraft : undefined,
          preferredSchedule: selectedCanEditPeopleData ? preferredScheduleDraft : undefined,
          cpf: selectedCanEditPeopleData ? cpfDraft : undefined,
          cnpj: selectedCanEditPeopleData ? cnpjDraft : undefined
        })
      });
      setEmployeeRows((items) => items.map((employee) => (employee.id === payload.data.id ? payload.data : employee)));
      setSelected(payload.data);
      setEditingEmployee(false);
      setEmployeeMessage("Dados operacionais atualizados.");
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setEmployeeFieldErrors(error.fields ?? {});
        setEmployeeMessage(error.message);
      } else {
        setEmployeeMessage(error instanceof Error ? error.message : "Não foi possível atualizar o parceiro.");
      }
    } finally {
      setSavingEmployee(false);
    }
  }

  function exportEmployeesXlsx() {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    lobFilter.forEach((value) => params.append("lob", value));
    statusFilter.forEach((value) => params.append("status_colaborador", value));
    supervisorFilter.forEach((value) => params.append("supervisorId", value));
    roleTitleFilter.forEach((value) => params.append("roleTitle", value));
    skillFilter.forEach((value) => params.append("skill", value));
    waveFilter.forEach((value) => params.append("wave", value));
    shiftFilter.forEach((value) => params.append("shiftId", value));
    contractFilter.forEach((value) => params.append("contractType", value));
    window.location.href = `/api/employees/export${params.toString() ? `?${params.toString()}` : ""}`;
  }

  function clearEmployeeFilters() {
    setQuery("");
    setLobFilter([]);
    setStatusFilter([]);
    setSupervisorFilter([]);
    setRoleTitleFilter([]);
    setSkillFilter([]);
    setWaveFilter([]);
    setShiftFilter([]);
    setContractFilter([]);
    setEmployeeBatchWbs([]);
    setEmployeePage(1);
    void loadEmployees({ nextQuery: "", nextLob: [], nextStatus: [], nextSupervisor: [], nextRoleTitle: [], nextSkill: [], nextWave: [], nextShift: [], nextContract: [], nextBatchWbs: [], nextPage: 1 });
  }

  async function resetSelectedPassword() {
    if (!selected || resettingPassword) return;
    setResettingPassword(true);
    setEmployeeMessage("");
    try {
      const payload = await apiJson<{ message: string }>("/api/employees/reset-password", {
        method: "POST",
        body: JSON.stringify({ employeeId: selected.id, ...resetPasswordForm })
      });
      setEmployeeMessage(payload.message ?? "Senha redefinida com sucesso.");
      setResetPasswordForm({ password: "", confirmPassword: "" });
      setShowResetPassword(false);
    } catch (error) {
      setEmployeeMessage(error instanceof ApiRequestError ? error.message : error instanceof Error ? error.message : "Não foi possível resetar a senha.");
    } finally {
      setResettingPassword(false);
    }
  }

  async function deleteSelectedEmployee() {
    if (!selected || deletingEmployee) return;
    setDeletingEmployee(true);
    setEmployeeMessage("");
    try {
      const payload = await apiJson<{ message: string }>(`/api/employees/${selected.id}`, {
        method: "DELETE",
        body: JSON.stringify(deleteEmployeeForm)
      });
      setEmployeeRows((items) => items.filter((employee) => employee.id !== selected.id));
      setSelected(null);
      setShowDeleteEmployee(false);
      setDeleteEmployeeForm({ reason: "", confirmation: "" });
      setEmployeeMessage(payload.message ?? "Cadastro excluído com sucesso.");
      await loadEmployees({ nextPage: employeePage });
    } catch (error) {
      setEmployeeMessage(error instanceof ApiRequestError ? error.message : error instanceof Error ? error.message : "Não foi possível excluir o cadastro.");
    } finally {
      setDeletingEmployee(false);
    }
  }

  return (
    <div>
      <PageHeader title="Parceiros" description="Base operacional de parceiros, vínculos e informações cadastrais." icon={UsersRound} actions={<button onClick={exportEmployeesXlsx} className="premium-control h-10 px-4 text-sm font-extrabold text-navy-950">Exportar XLSX</button>} />
      {employeeMessage ? <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{employeeMessage}</div> : null}
      <div className="space-y-5">
        <div className="space-y-5">
          <div className="card grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-10">
            <input value={query} onChange={(event) => setQuery(event.target.value)} className="h-10 rounded-lg border border-border px-3 text-sm outline-none xl:col-span-2" placeholder="Nome, e-mail, WB/Login, CNPJ, Skill ou Wave" />
            <EmployeeMultiSelectFilter ariaLabel="Filtrar por LOB" allLabel="Todas as LOBs" values={lobFilter} onChange={setLobFilter} options={employeeMapLobs.map((lob) => ({ value: lob, label: lob }))} />
            <EmployeeMultiSelectFilter ariaLabel="Filtrar por status" allLabel="Todos os status" values={statusFilter} onChange={setStatusFilter} options={employeeStatusOptions.map((status) => ({ value: status, label: status }))} />
            <EmployeeMultiSelectFilter ariaLabel="Filtrar por supervisor" allLabel="Todos os supervisores" values={supervisorFilter} onChange={setSupervisorFilter} options={[{ value: "SEM_SUPERVISOR", label: "Sem supervisor" }, ...employeeSupervisorOptions.map((supervisor) => ({ value: supervisor.id, label: supervisor.name }))]} />
            <EmployeeMultiSelectFilter ariaLabel="Filtrar por cargo ou função" allLabel="Todos os cargos" values={roleTitleFilter} onChange={setRoleTitleFilter} options={employeeRoleTitleFilterOptions.map((roleTitle) => ({ value: roleTitle, label: roleTitle }))} />
            <EmployeeMultiSelectFilter ariaLabel="Filtrar por skill" allLabel="Todas as skills" values={skillFilter} onChange={setSkillFilter} options={employeeSkillOptions.map((skill) => ({ value: skill, label: skill === "SEM_SKILL" ? "Sem skill" : skill }))} />
            <EmployeeMultiSelectFilter ariaLabel="Filtrar por wave" allLabel="Todas as waves" values={waveFilter} onChange={setWaveFilter} options={employeeWaveOptions.map((wave) => ({ value: wave, label: wave === "SEM_WAVE" ? "Sem wave" : wave }))} />
            <EmployeeMultiSelectFilter ariaLabel="Filtrar por turno" allLabel="Todos os turnos" values={shiftFilter} onChange={setShiftFilter} options={employeeShiftOptions.map((shift) => ({ value: shift.id, label: cleanShiftName(shift.name) }))} />
            <EmployeeMultiSelectFilter ariaLabel="Filtrar por contrato" allLabel="Todos os contratos" values={contractFilter} onChange={setContractFilter} options={[{ value: "PJ", label: "PJ" }, { value: "CLT", label: "CLT" }]} />
            <div className="rounded-lg border border-dashed border-blue-200 bg-blue-50/50 p-3 md:col-span-2 xl:col-span-10">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-black uppercase text-blue-700">Filtro em lote por WB/Login</p>
                  <p className="text-xs font-semibold text-muted">Cole vários logins e combine com LOB, status, supervisor, skill, wave e turno.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setEmployeeBatchOpen((current) => !current)} className="inline-flex h-8 items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 text-xs font-extrabold text-blue-700">
                    <Plus className="h-3.5 w-3.5" /> Adicionar múltiplos
                  </button>
                  {employeeBatchWbs.length ? <button type="button" onClick={clearEmployeeBatchWbs} className="h-8 rounded-lg border border-border bg-white px-3 text-xs font-extrabold text-navy-950">Limpar WBs</button> : null}
                </div>
              </div>
              {employeeBatchOpen ? (
                <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                  <textarea value={employeeBatchText} onChange={(event) => setEmployeeBatchText(event.target.value)} className="min-h-24 rounded-lg border border-border bg-white p-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" placeholder={"wb_joao01\nwb_maria02; wb_pedro03"} />
                  <div className="flex items-end">
                    <button type="button" onClick={addEmployeeBatchWbs} className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-extrabold text-white">Aplicar lote</button>
                  </div>
                </div>
              ) : null}
              {employeeBatchWbs.length ? (
                <div className="mt-3 flex max-h-24 flex-wrap gap-2 overflow-y-auto pr-1">
                  {employeeBatchWbs.map((value) => (
                    <span key={value} className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-extrabold text-blue-700">
                      {value}
                      <button type="button" onClick={() => removeEmployeeBatchWb(value)} className="text-blue-400 hover:text-red-600">×</button>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex gap-2 md:col-span-2 xl:col-span-10 xl:justify-end">
              <button onClick={() => { setEmployeePage(1); void loadEmployees({ nextPage: 1 }); }} className="h-10 rounded-lg bg-blue-600 px-5 text-sm font-bold text-white">Buscar</button>
              <button onClick={clearEmployeeFilters} className="h-10 rounded-lg border border-border px-5 text-sm font-bold">Limpar filtros</button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <MetricPill value={employeePagination.total} label="Total encontrado" />
            <MetricPill value={employeeContractSummary.clt} label="CLT" />
            <MetricPill value={employeeContractSummary.pj} label="PJ" />
          </div>
          <Panel title="Parceiros">
            {employeeLoading ? (
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm font-bold text-blue-700">Carregando resumo dos parceiros...</div>
            ) : employeeRows.length ? (
              <>
                <SimpleTable
                  columns={["Nome", "E-mail", "WB/Login", "Cargo/Função", "Role", "LOB", "Skill", "Wave", "Supervisor", "Turno", "Senioridade", "Status do parceiro", "Ação"]}
                  rows={employeeRows.map((employee) => [
                    <button key={employee.id} onClick={() => selectEmployee(employee)} className="max-w-[180px] truncate font-bold text-blue-700" title={employee.name}>{employee.name}</button>,
                    <span key={`${employee.id}-email`} className="block max-w-[190px] truncate" title={employee.email ?? "-"}>{employee.email ?? "-"}</span>,
                    employee.wb,
                    <span key={`${employee.id}-role`} className="block max-w-[160px] truncate" title={employee.role}>{employee.role}</span>,
                    displaySystemRole(employee.systemRole),
                    employee.lob,
                    <EmployeeSkillBadges key={`${employee.id}-skills`} skills={employee.skills} fallback={employee.skill} compact />,
                    employee.wave || "Sem wave",
                    <span key={`${employee.id}-supervisor`} className="block max-w-[160px] truncate" title={employee.supervisor}>{employee.supervisor}</span>,
                    cleanShiftName(employee.shift) || "-",
                    <StatusBadge key={`${employee.id}-seniority`} status={employee.seniority || "Não informado"} />,
                    <StatusBadge key={`${employee.id}-status`} status={employeeMapStatusLabel(employee.status)} />,
                    <div key={`${employee.id}-action`} className="flex flex-wrap gap-1.5">
                      <Link href={`/perfil/${employee.id}`} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">Ver perfil</Link>
                      <button onClick={() => selectEmployee(employee)} className="rounded-lg border border-border bg-white px-3 py-2 text-xs font-bold text-navy-950">Detalhe</button>
                    </div>
                  ])}
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
                  <span>Página {employeePagination.page} de {employeePagination.totalPages} • {employeePagination.total} registro(s)</span>
                  <div className="flex gap-2">
                    <button disabled={employeePagination.page <= 1 || employeeLoading} onClick={() => loadEmployees({ nextPage: employeePagination.page - 1 })} className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-navy-950 disabled:opacity-45">Anterior</button>
                    <button disabled={employeePagination.page >= employeePagination.totalPages || employeeLoading} onClick={() => loadEmployees({ nextPage: employeePagination.page + 1 })} className="rounded-lg border border-border px-3 py-2 text-xs font-bold text-navy-950 disabled:opacity-45">Próxima</button>
                  </div>
                </div>
              </>
            ) : (
              <div>
                <EmptyState title={hasEmployeeFilters ? "Nenhum parceiro encontrado para os filtros selecionados" : "Nenhum parceiro encontrado"} description={hasEmployeeFilters ? "Limpe os filtros para voltar a listar a base real disponível para seu perfil." : "Aprove cadastros ou importe parceiros para iniciar a base."} />
                {hasEmployeeFilters ? (
                  <div className="mt-3 text-center">
                    <button onClick={clearEmployeeFilters} className="rounded-lg border border-border px-4 py-2 text-sm font-bold text-navy-950">Limpar filtros</button>
                  </div>
                ) : null}
              </div>
            )}
          </Panel>
        </div>
        {selected ? (
          <div className="fixed inset-0 z-[45] flex items-center justify-center bg-navy-950/45 p-4 backdrop-blur-md">
            <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-[0_28px_90px_rgba(15,23,42,0.28)]">
              <div className="flex items-center justify-between gap-4 border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-600 font-black text-white shadow-sm">{initials(selected.name)}</span>
                  <div className="min-w-0">
                    <p className="text-xs font-black uppercase tracking-[0.22em] text-blue-600">Perfil do parceiro</p>
                    <h2 className="truncate text-xl font-black text-navy-950">{selected.name}</h2>
                    <p className="truncate text-sm font-semibold text-muted">{selected.wb} • {selected.role} • {selected.lob}</p>
                  </div>
                </div>
                <button type="button" onClick={() => { setSelected(null); setEditingEmployee(false); }} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-white text-xl font-black text-navy-950 shadow-sm transition hover:bg-slate-50" aria-label="Fechar detalhe do parceiro">
                  ×
                </button>
              </div>
              <div className="overflow-y-auto p-5">
                <div className="space-y-4">
              {selectedEmployeeLoading ? <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm font-bold text-blue-700">Carregando detalhes...</div> : null}
              <div className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
                <InfoLine label="LOB" value={selected.lob} />
                <InfoLine label="Supervisor" value={selected.supervisor} />
                <InfoLine label="Subordinados" value={selected.directReports ?? 0} />
                <InfoLine label="Skills" value={<EmployeeSkillBadges skills={selected.skills} fallback={selected.skill} />} />
                <InfoLine label="Wave" value={selected.wave || "Sem wave"} />
                <InfoLine label="Turno" value={cleanShiftName(selected.shift) || "-"} />
                <InfoLine label="Horário de entrada" value={selected.workStartTime || "Não informado"} />
                <InfoLine label="Horário de saída" value={selected.workEndTime || "Não informado"} />
                <InfoLine label="Admissão" value={selected.admission} />
                <InfoLine label="Senioridade" value={selected.seniority || "Não informado"} />
                <InfoLine label="Início de Nesting" value={selected.nestingStartDate || "Não informado"} />
                <InfoLine label="Go Live" value={selected.goLiveDate || "Não informado"} />
                <InfoLine label="Desligamento" value={selected.terminationDate || "Não informada"} />
                <InfoLine label="Tipo de desligamento" value={selected.terminationType || "Não informado"} />
                <InfoLine label="Motivo do desligamento" value={selected.terminationReason || "Não informado"} />
                <InfoLine label="Status do parceiro" value={employeeMapStatusLabel(selected.status)} />
              </div>
              <ProfileSection title="Dados Operacionais">
                <div className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
                  <InfoLine label="Cargo/Função" value={selected.role} />
                  <InfoLine label="LOB" value={selected.lob} />
                  <InfoLine label="Skills" value={<EmployeeSkillBadges skills={selected.skills} fallback={selected.skill} />} />
                  <InfoLine label="Wave" value={selected.wave || "Sem wave"} />
                  <InfoLine label="Horário de entrada" value={selected.workStartTime || "Não informado"} />
                  <InfoLine label="Horário de saída" value={selected.workEndTime || "Não informado"} />
                  <InfoLine label="Status do parceiro" value={<StatusBadge status={employeeMapStatusLabel(selected.status)} />} />
                  <InfoLine label="Supervisor vinculado" value={selected.supervisor} />
                  <InfoLine label="Subordinados diretos" value={selected.directReports ?? 0} />
                  <InfoLine label="Última presença" value={selected.lastPresence ?? "Sem registro"} />
                  <InfoLine label="E-mail operacional" value={selected.email ?? "Restrito"} />
                </div>
                {selectedCanEditEmployeeOperational ? (
                  <div className="mt-3 grid gap-3">
                    <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm font-semibold text-blue-700">
                      Dados aprovados podem ser ajustados administrativamente. Todas as alterações ficam registradas em auditoria.
                    </div>
                    {!editingEmployee ? (
                      <div className="grid gap-2 sm:grid-cols-3">
                        <button onClick={() => setEditingEmployee(true)} className="rounded-lg bg-blue-600 px-3 py-2.5 text-sm font-bold text-white">
                          Editar dados
                        </button>
                        {isAdmin ? (
                          <button onClick={() => setShowResetPassword(true)} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm font-bold text-blue-700">
                            Resetar senha
                          </button>
                        ) : null}
                        {isAdmin ? (
                          <button onClick={() => setShowDeleteEmployee(true)} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-bold text-red-700">
                            Excluir cadastro
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {Object.keys(employeeFieldErrors).length ? (
                          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
                            Existem campos inválidos. Revise os campos destacados antes de salvar.
                          </div>
                        ) : null}
                        <ProfileSection title="Identificação">
                          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                            <FormInput disabled={!selectedCanEditPeopleData} label="Nome" value={nameDraft} onChange={setNameDraft} error={employeeFieldErrors.fullName} />
                            <FormInput disabled={!selectedCanEditPeopleData} label="Nome social" value={socialNameDraft} onChange={setSocialNameDraft} error={employeeFieldErrors.socialName} />
                            <FormInput disabled={!selectedCanEditPeopleData} label="E-mail de login" type="email" value={emailDraft} onChange={setEmailDraft} error={employeeFieldErrors.email} />
                            <FormInput disabled={!selectedCanEditPeopleData} label="WB/Login" value={wbDraft} onChange={setWbDraft} error={employeeFieldErrors.wbLogin} />
                          </div>
                        </ProfileSection>
                        <ProfileSection title="Operacional">
                          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                            {employeeRoleTitleOptions.length ? (
                              <FormSelect label="Cargo/Função" value={roleTitleDraft} options={employeeRoleTitleOptions} onChange={setRoleTitleDraft} error={employeeFieldErrors.roleTitle} />
                            ) : (
                              <FormInput label="Cargo/Função" value={roleTitleDraft} onChange={setRoleTitleDraft} error={employeeFieldErrors.roleTitle} />
                            )}
                            {employeeSettings?.skills?.length ? (
                              <div className="md:col-span-2 xl:col-span-3">
                                <span className="mb-1.5 block text-sm font-bold text-muted">Skills</span>
                                <div className="grid gap-2 rounded-xl border border-border bg-white p-3 sm:grid-cols-2 xl:grid-cols-3">
                                  {employeeSettings.skills.filter((skill) => skill.status !== "INACTIVE" || skillIdsDraft.includes(skill.id)).map((skill) => {
                                    const selectedSkill = skillIdsDraft.includes(skill.id);
                                    const primary = primarySkillIdDraft === skill.id;
                                    return (
                                      <div key={skill.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                                        <label className="flex min-w-0 items-center gap-2 text-sm font-bold text-navy-950">
                                          <input
                                            type="checkbox"
                                            checked={selectedSkill}
                                            onChange={(event) => {
                                              const next = event.target.checked ? [...skillIdsDraft, skill.id] : skillIdsDraft.filter((id) => id !== skill.id);
                                              setSkillIdsDraft(Array.from(new Set(next)));
                                              if (!event.target.checked && primary) setPrimarySkillIdDraft(next[0] ?? "");
                                              if (event.target.checked && !primarySkillIdDraft) setPrimarySkillIdDraft(skill.id);
                                            }}
                                          />
                                          <span className="truncate">{skill.name}</span>
                                        </label>
                                        <label className="flex items-center gap-1 text-[11px] font-black uppercase tracking-wide text-muted">
                                          <input type="radio" name="primary-skill" checked={primary} disabled={!selectedSkill} onChange={() => setPrimarySkillIdDraft(skill.id)} /> Principal
                                        </label>
                                      </div>
                                    );
                                  })}
                                </div>
                                {employeeFieldErrors.skillIds || employeeFieldErrors.primarySkillId ? <span className="mt-1 block text-xs font-bold text-red-600">{employeeFieldErrors.skillIds || employeeFieldErrors.primarySkillId}</span> : null}
                              </div>
                            ) : <FormInput label="Skill" value={skillDraft} onChange={setSkillDraft} error={employeeFieldErrors.skill} />}
                            <FormInput label="Wave" value={waveDraft} onChange={setWaveDraft} error={employeeFieldErrors.wave} />
                            {isAdmin ? <FormSelect label="Role/Permissão" value={roleDraft} options={employeeRoleOptions} onChange={setRoleDraft} error={employeeFieldErrors.roleName} optionLabel={displaySystemRole} /> : null}
                            {canEditOperationalBindings ? (
                              <label className="block">
                                <span className="mb-1.5 block text-sm font-bold text-muted">LOB</span>
                                <select value={lobDraft} onChange={(event) => setLobDraft(event.target.value)} className={cn("h-11 w-full rounded-lg border px-3 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100", employeeFieldErrors.lobId ? "border-red-300 bg-red-50/40" : "border-border")}>
                                  {employeeLobOptions.map((lob) => <option key={lob.id} value={lob.id}>{lob.name}</option>)}
                                </select>
                                {employeeFieldErrors.lobId ? <span className="mt-1 block text-xs font-bold text-red-600">{employeeFieldErrors.lobId}</span> : null}
                              </label>
                            ) : null}
	                            {canEditOperationalBindings ? (
	                              <label className="block">
	                                <span className="mb-1.5 block text-sm font-bold text-muted">Supervisor</span>
                                <select value={supervisorDraft} onChange={(event) => setSupervisorDraft(event.target.value)} className={cn("h-11 w-full rounded-lg border px-3 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100", employeeFieldErrors.supervisorId ? "border-red-300 bg-red-50/40" : "border-border")}>
                                  <option value="">Sem supervisor</option>
                                  {(employeeSettings?.supervisors ?? []).map((supervisor) => (
                                    <option key={supervisor.id} value={supervisor.id}>{supervisor.name} - {supervisor.email || supervisor.lob || "supervisor"}</option>
                                  ))}
                                </select>
                                {employeeFieldErrors.supervisorId ? <span className="mt-1 block text-xs font-bold text-red-600">{employeeFieldErrors.supervisorId}</span> : null}
                              </label>
                            ) : null}
                            {canEditOperationalBindings ? (
                              <label className="block">
                                <span className="mb-1.5 block text-sm font-bold text-muted">Turno</span>
                                <select value={shiftDraft} onChange={(event) => setShiftDraft(event.target.value)} className={cn("h-11 w-full rounded-lg border px-3 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100", employeeFieldErrors.shiftId ? "border-red-300 bg-red-50/40" : "border-border")}>
                                  {employeeShiftOptions.map((shift) => <option key={shift.id} value={shift.id}>{cleanShiftName(shift.name)}</option>)}
                                </select>
                                {employeeFieldErrors.shiftId ? <span className="mt-1 block text-xs font-bold text-red-600">{employeeFieldErrors.shiftId}</span> : null}
                              </label>
                            ) : null}
                            <FormInput label="Horário de entrada" value={workStartTimeDraft} onChange={setWorkStartTimeDraft} error={employeeFieldErrors.workStartTime} />
                            <FormInput label="Horário de saída" value={workEndTimeDraft} onChange={setWorkEndTimeDraft} error={employeeFieldErrors.workEndTime} />
                            <FormSelect
                              label="Status do parceiro"
                              value={statusDraft}
                              options={operationalStatusOptions}
                              onChange={(value) => {
                                setStatusDraft(value);
                                const normalized = employeeStatusKey(value);
                                if (isInactiveEmployeeAccessStatus(normalized)) setUserStatusDraft("INACTIVE");
                                if (["ACTIVE", "ATIVO", "ATIVA"].includes(normalized) && userStatusDraft !== "BLOCKED" && !isPastOrTodayDateInput(terminationDraft)) setUserStatusDraft("ACTIVE");
                              }}
                              error={employeeFieldErrors.operationalStatus}
                            />
                          </div>
                        </ProfileSection>
                        <ProfileSection title="Contrato e Datas">
                          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                            {selectedCanEditPeopleData ? <FormSelect label="Tipo de contrato" value={contractDraft} options={contractOptions} onChange={setContractDraft} error={employeeFieldErrors.contractType} /> : null}
                            {selectedCanEditPeopleData ? <FormInput label="Data de admissão" type="date" value={admissionDraft} onChange={setAdmissionDraft} error={employeeFieldErrors.admissionDate} /> : null}
                            {selectedCanEditEmployeeOperational ? <FormInput label="Data de início de Nesting" type="date" value={nestingStartDraft} onChange={setNestingStartDraft} error={employeeFieldErrors.nestingStartDate} /> : null}
                            {selectedCanEditEmployeeOperational ? <FormInput label="Data de Go Live" type="date" value={goLiveDraft} onChange={setGoLiveDraft} error={employeeFieldErrors.goLiveDate} /> : null}
                            {selectedCanEditPeopleData ? (
                              <FormInput
                                label="Data de desligamento"
                                type="date"
                                value={terminationDraft}
                                onChange={(value) => {
                                  setTerminationDraft(value);
                                  if (isPastOrTodayDateInput(value)) setUserStatusDraft("INACTIVE");
                                }}
                                error={employeeFieldErrors.terminationDate}
                              />
                            ) : null}
                            {selectedCanEditPeopleData ? <FormSelect label="Tipo de desligamento" value={terminationTypeDraft} options={terminationTypeOptions} onChange={setTerminationTypeDraft} error={employeeFieldErrors.terminationType} /> : null}
                            {selectedCanEditPeopleData ? <FormInput label="Motivo do desligamento" value={terminationReasonDraft} onChange={setTerminationReasonDraft} error={employeeFieldErrors.terminationReason} /> : null}
                            {selectedCanEditPeopleData ? <FormSelect label="Usuário ativo/inativo" value={userStatusDraft} options={["ACTIVE", "INACTIVE", "BLOCKED"]} onChange={setUserStatusDraft} error={employeeFieldErrors.userStatus} /> : null}
                          </div>
                        </ProfileSection>
	                        {selectedCanEditPeopleData ? (
	                          <ProfileSection title="Contato Operacional">
	                            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
	                              <FormInput label="Contato principal" value={primaryPhoneDraft} onChange={setPrimaryPhoneDraft} error={employeeFieldErrors.primaryPhone} />
	                              <FormInput label="Cidade" value={cityDraft} onChange={setCityDraft} error={employeeFieldErrors.city} />
	                              <FormInput label="Estado/UF" value={stateUfDraft} onChange={setStateUfDraft} error={employeeFieldErrors.stateUf} />
	                              <FormInput label="Preferência de horário" value={preferredScheduleDraft} onChange={setPreferredScheduleDraft} error={employeeFieldErrors.preferredSchedule} />
	                            </div>
	                          </ProfileSection>
	                        ) : null}
	                        {selectedCanEditPeopleData ? (
	                          <ProfileSection title="Documentos fiscais">
	                            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
	                              <FormInput label="CPF" value={cpfDraft} onChange={(value) => setCpfDraft(formatCpfInputValue(value))} error={employeeFieldErrors.cpf} inputMode="numeric" maxLength={14} placeholder="000.000.000-00" />
	                              <FormInput label="CNPJ" value={cnpjDraft} onChange={(value) => setCnpjDraft(formatCnpjInputValue(value))} error={employeeFieldErrors.cnpj} inputMode="numeric" maxLength={18} placeholder="00.000.000/0000-00" />
	                            </div>
	                          </ProfileSection>
	                        ) : null}
	                        {selectedCanEditPeopleData ? (
	                          <ProfileSection title="Dados cadastrais adicionais">
	                            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
	                              <FormSelect label="Etnia" value={ethnicityDraft} options={ethnicityOptions} onChange={setEthnicityDraft} error={employeeFieldErrors.ethnicity} />
	                              <FormSelect label="Orientação sexual" value={sexualOrientationDraft} options={sexualOrientationOptions} onChange={setSexualOrientationDraft} error={employeeFieldErrors.sexualOrientation} />
                              <FormSelect label="É PCD?" value={isPcdDraft} options={yesNoPreferNotOptions} onChange={(value) => {
                                setIsPcdDraft(value);
                                if (value !== "Sim") {
                                  setPcdDisabilityTypeDraft("");
                                  setPcdDisabilityOtherDraft("");
                                }
                              }} error={employeeFieldErrors.isPcd} />
                              {isPcdDraft === "Sim" ? (
                                <FormSelect label="Tipo de deficiência" value={pcdDisabilityTypeDraft} options={pcdDisabilityTypeOptions} onChange={(value) => {
                                  setPcdDisabilityTypeDraft(value);
                                  if (value !== "Outra") setPcdDisabilityOtherDraft("");
                                }} error={employeeFieldErrors.pcdDisabilityType} />
                              ) : null}
                              {isPcdDraft === "Sim" && pcdDisabilityTypeDraft === "Outra" ? (
                                <FormInput label="Especifique o tipo de deficiência" value={pcdDisabilityOtherDraft} onChange={setPcdDisabilityOtherDraft} error={employeeFieldErrors.pcdDisabilityOther} />
                              ) : null}
	                              <FormSelect label="Primeiro emprego?" value={firstJobDraft} options={["", "Sim", "Não"]} onChange={setFirstJobDraft} error={employeeFieldErrors.firstJob} />
	                              <FormSelect
	                                label="Já trabalhou em telemarketing?"
	                                value={hasTelemarketingExperienceDraft}
	                                options={["", "Sim", "Não"]}
	                                onChange={(value) => {
	                                  setHasTelemarketingExperienceDraft(value);
	                                  if (value === "Não") setTelemarketingWhereDraft("Não se aplica");
	                                }}
	                                error={employeeFieldErrors.hasTelemarketingExperience}
	                              />
	                              <FormInput label="Onde trabalhou em telemarketing?" value={telemarketingWhereDraft} onChange={setTelemarketingWhereDraft} error={employeeFieldErrors.telemarketingWhere} />
	                            </div>
	                          </ProfileSection>
	                        ) : null}
	                        <ProfileSection title="Observações">
                          <textarea value={internalNotesDraft} onChange={(event) => setInternalNotesDraft(event.target.value)} className={cn("min-h-24 w-full rounded-lg border p-3 text-sm outline-none", employeeFieldErrors.internalNotes ? "border-red-300 bg-red-50/40" : "border-border")} placeholder="Observações internas da operação" />
                          {employeeFieldErrors.internalNotes ? <span className="mt-1 block text-xs font-bold text-red-600">{employeeFieldErrors.internalNotes}</span> : null}
                        </ProfileSection>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <button disabled={savingEmployee} onClick={saveEmployeeOperationalData} className="rounded-lg bg-blue-600 px-3 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                            {savingEmployee ? "Salvando..." : "Salvar alterações"}
                          </button>
                          <button disabled={savingEmployee} onClick={() => setEditingEmployee(false)} className="rounded-lg border border-border bg-white px-3 py-2.5 text-sm font-bold text-navy-950 disabled:opacity-50">
                            Cancelar
                          </button>
                          {isAdmin ? (
                            <button onClick={() => setShowResetPassword(true)} className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm font-bold text-blue-700">
                              Resetar senha
                            </button>
                          ) : null}
                          {isAdmin ? (
                            <button disabled={savingEmployee} onClick={() => setShowDeleteEmployee(true)} className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-bold text-red-700 disabled:opacity-50">
                              Excluir cadastro
                            </button>
                          ) : null}
                        </div>
                        <p className="text-xs font-semibold text-muted">Mudar cargo não muda permissão automaticamente. Role/Permissão só muda quando Admin altera explicitamente.</p>
                      </div>
                    )}
                  </div>
                ) : null}
              </ProfileSection>
              {isSupervisorUser ? (
                <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm font-semibold text-blue-700">
                  Visão operacional do Supervisor: dados pessoais, bancários, familiares, documentos e contatos de emergência ficam ocultos.
                </div>
              ) : (
                <>
                  <ProfileSection title="Dados Cadastrais">
                    {selected.restrictedSections?.cadastrais ? (
                      <div className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
                        <InfoLine label="CPF" value={selected.canViewSensitive ? selected.sensitive?.cpf : selected.maskedSensitive?.cpf} />
                        <InfoLine label="RG" value={selected.canViewSensitive ? selected.sensitive?.rg : selected.maskedSensitive?.rg} />
                        <InfoLine label="CNPJ" value={selected.canViewSensitive ? selected.sensitive?.cnpj || "Não informado" : "Acesso restrito"} />
                        <InfoLine label="Nascimento" value={selected.canViewSensitive ? selected.sensitive?.birthDate : "Acesso restrito"} />
                        <InfoLine label="Família" value={selected.canViewSensitive ? selected.sensitive?.familyData : "Acesso restrito"} />
                      </div>
                    ) : (
                      <RestrictedSection />
                    )}
                  </ProfileSection>
                  <ProfileSection title="Dados de Contato e Emergência">
                    {selected.restrictedSections?.contato || selected.restrictedSections?.emergencia ? (
                      <div className="grid gap-2 text-sm sm:grid-cols-2">
                        <InfoLine label="Endereço" value={selected.canViewSensitive ? selected.sensitive?.address : "Acesso restrito"} />
                        <InfoLine label="Emergência" value={selected.maskedSensitive?.emergencyContactData ?? "Acesso restrito"} />
                      </div>
                    ) : (
                      <RestrictedSection />
                    )}
                  </ProfileSection>
                  <ProfileSection title="Dados Bancários">
                    {selected.restrictedSections?.bancarios ? (
                      <div className="grid gap-2 text-sm sm:grid-cols-2">
                        <InfoLine label="Banco/PIX" value={selected.sensitive?.bankData ?? selected.maskedSensitive?.bankData} />
                        <InfoLine label="Tipo da Chave PIX" value={selected.sensitive?.pixKeyType ?? selected.maskedSensitive?.pixKeyType ?? selected.pixKeyType ?? "Não informado"} />
                        <InfoLine label="Chave PIX" value={selected.sensitive?.pixKey ?? selected.maskedSensitive?.pixKey ?? selected.pixKey ?? "Não informada"} />
                      </div>
                    ) : <RestrictedSection />}
                  </ProfileSection>
                </>
              )}
              {!isSupervisorUser && (selected.ethnicity || selected.sexualOrientation || selected.isPcd || selected.pcdDisabilityType || selected.pcdDisabilityOther || selected.firstJob || selected.hasTelemarketingExperience || selected.telemarketingWhere) ? (
                <ProfileSection title="Dados cadastrais adicionais">
                  <div className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
                    <InfoLine label="Etnia" value={selected.ethnicity || "Não informado"} />
                    <InfoLine label="Orientação sexual" value={selected.sexualOrientation || "Não informado"} />
                    <InfoLine label="PCD" value={selected.isPcd || "Não informado"} />
                    {selected.isPcd === "Sim" ? <InfoLine label="Tipo de deficiência" value={selected.pcdDisabilityType || "Não informado"} /> : null}
                    {selected.isPcd === "Sim" && selected.pcdDisabilityType === "Outra" ? <InfoLine label="Especificação da deficiência" value={selected.pcdDisabilityOther || "Não informado"} /> : null}
                    <InfoLine label="Primeiro emprego" value={selected.firstJob || "Não informado"} />
                    <InfoLine label="Já trabalhou em telemarketing" value={selected.hasTelemarketingExperience || "Não informado"} />
                    <InfoLine label="Onde trabalhou em telemarketing" value={selected.telemarketingWhere || "Não informado"} />
                  </div>
                </ProfileSection>
              ) : null}
              <ProfileSection title="Histórico de Ausências">
                {selected.attendanceHistory?.length ? (
                  <MiniAlertList
                    items={selected.attendanceHistory.map((record) => ({
                      title: `${record.date} • ${cleanShiftName(record.shift) || "Sem turno"} • ${record.absenceReason ?? record.status}`,
                      status: record.status,
                      tone: record.impactsAbs ? "orange" : "green"
                    }))}
                  />
                ) : (
                  <p className="text-sm text-muted">Sem ausência recente registrada.</p>
                )}
              </ProfileSection>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
      {showResetPassword && selected ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-md p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">Resetar senha</h2>
                <p className="text-sm text-muted">{selected.name}</p>
              </div>
              <button onClick={() => setShowResetPassword(false)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            <div className="grid gap-3">
              <FormInput label="Nova senha" type="password" value={resetPasswordForm.password} onChange={(value) => setResetPasswordForm({ ...resetPasswordForm, password: value })} />
              <FormInput label="Confirmar nova senha" type="password" value={resetPasswordForm.confirmPassword} onChange={(value) => setResetPasswordForm({ ...resetPasswordForm, confirmPassword: value })} />
              <label className="flex items-center gap-2 rounded-lg border border-border bg-slate-50 p-3 text-sm font-semibold text-muted">
                <input type="checkbox" disabled />
                Solicitar troca no próximo login (preparado para fase futura)
              </label>
              <button disabled={resettingPassword} onClick={resetSelectedPassword} className="rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
                {resettingPassword ? "Salvando..." : "Salvar nova senha"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showDeleteEmployee && selected ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-lg p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-extrabold text-navy-950">Excluir cadastro do banco de dados</h2>
                <p className="text-sm text-muted">{selected.name} • {selected.wb}</p>
              </div>
              <button onClick={() => setShowDeleteEmployee(false)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-slate-100">×</button>
            </div>
            <div className="space-y-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
                Esta ação pode remover permanentemente dados do parceiro. Use apenas para cadastros incorretos, duplicados ou testes. Para parceiros reais com histórico, utilize Inativar parceiro.
              </div>
              <label className="block">
                <span className="mb-1.5 block text-sm font-bold text-muted">Motivo obrigatório</span>
                <textarea value={deleteEmployeeForm.reason} onChange={(event) => setDeleteEmployeeForm((current) => ({ ...current, reason: event.target.value }))} className="min-h-24 w-full rounded-lg border border-border p-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" placeholder="Descreva por que este cadastro deve ser excluído." />
              </label>
              <FormInput label="Digite EXCLUIR para confirmar" value={deleteEmployeeForm.confirmation} onChange={(value) => setDeleteEmployeeForm((current) => ({ ...current, confirmation: value }))} />
              <div className="grid gap-2 sm:grid-cols-2">
                <button disabled={deletingEmployee} onClick={() => setShowDeleteEmployee(false)} className="rounded-lg border border-border bg-white px-4 py-3 text-sm font-bold text-navy-950 disabled:opacity-50">Cancelar</button>
                <button disabled={deletingEmployee || deleteEmployeeForm.confirmation !== "EXCLUIR" || !deleteEmployeeForm.reason.trim()} onClick={deleteSelectedEmployee} className="rounded-lg bg-red-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
                  {deletingEmployee ? "Excluindo..." : "Excluir definitivamente"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}


function ProfileSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-slate-50/60 p-3">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-black text-navy-950">{title}</h3>
      {children}
    </div>
  );
}


function RestrictedSection() {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-700">
      <LockKeyhole className="h-4 w-4" />
      Acesso restrito por permissão.
    </div>
  );
}


function EmployeeSkillBadges({
  skills,
  fallback,
  compact = false
}: {
  skills?: Array<{ id: string; name: string; color: string; isPrimary: boolean; status?: "ACTIVE" | "INACTIVE" }>;
  fallback?: string;
  compact?: boolean;
}) {
  const visible = (skills?.length ? skills : fallback ? [{ id: `fallback:${fallback}`, name: fallback, color: "#2563EB", isPrimary: true as const }] : []);
  if (!visible.length) return <span className="text-muted">Sem skill</span>;
  const ordered = [...visible].sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary) || left.name.localeCompare(right.name));
  const limit = compact ? 2 : 3;
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1.5">
      {ordered.slice(0, limit).map((skill) => (
        <span
          key={skill.id}
          className="inline-flex max-w-[150px] items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[11px] font-black"
          style={{ color: skill.color, borderColor: `${skill.color}55`, backgroundColor: `${skill.color}12` }}
          title={`${skill.name}${skill.isPrimary ? " · principal" : ""}`}
        >
          {skill.isPrimary ? <span aria-hidden="true">★</span> : null}
          <span className="truncate">{skill.name}</span>
        </span>
      ))}
      {ordered.length > limit ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-600" title={ordered.slice(limit).map((skill) => skill.name).join(", ")}>+{ordered.length - limit}</span> : null}
    </span>
  );
}
