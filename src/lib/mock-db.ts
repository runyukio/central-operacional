import type { Session } from "next-auth";

import {
  announcements as seedAnnouncements,
  auditLogs as seedAuditLogs,
  chatMessages as seedChatMessages,
  employees as seedEmployees,
  equipmentRows as seedEquipmentRows,
  equipmentTickets as seedEquipmentTickets,
  qualityFeedback as seedQualityFeedback,
  requests as seedRequests,
  rewards as seedRewards,
  scheduleDays as seedScheduleDays,
  scheduleGridRows as seedScheduleGridRows,
  tokenHistory as seedTokenHistory
} from "@/lib/demo-data";
import { demoUsers, getDemoUser, type AppRole } from "@/lib/demo-auth";

export type Actor = {
  email: string;
  name: string;
  role: AppRole;
};

export type RequestStatus = "Aberto" | "Em análise" | "Aprovado" | "Recusado" | "Concluído" | "Cancelado";
export type Priority = "Baixa" | "Média" | "Alta" | "Crítica";

export type RequestRecord = {
  id: string;
  type: string;
  title?: string;
  requester: string;
  requesterEmail: string;
  priority: Priority;
  status: RequestStatus;
  area: string;
  time: string;
  description: string;
  assignee?: string;
  createdAt?: string;
  updatedAt?: string;
  payload: Record<string, unknown>;
  history: Array<{ at: string; actor: string; action: string; reason?: string }>;
  comments: Array<{ at: string; author: string; body: string }>;
};

export type ScheduleDayRecord = {
  date: number;
  outside: boolean;
  shift: string;
  label: string;
};

export type AnnouncementRecord = {
  id: string;
  title: string;
  category: string;
  body: string;
  date: string;
  area: string;
  status: string;
  requiresRead: boolean;
  readBy: string[];
};

export type QualityFeedbackRecord = {
  id: string;
  employee: string;
  employeeEmail: string;
  author: string;
  type: string;
  theme: string;
  quality: string;
  status: string;
  message: string;
  createdAt: string;
};

export type EquipmentRecord = {
  id: string;
  code: string;
  type: string;
  employee: string;
  employeeEmail?: string;
  status: string;
  delivered: string;
  impact: string;
};

export type EquipmentTicketRecord = {
  code: string;
  equipmentId: string;
  title: string;
  body: string;
  status: string;
  age: string;
};

export type TokenTransactionRecord = {
  title: string;
  amount: string;
  date: string;
  type: string;
};

export type RewardRecord = {
  id: string;
  name: string;
  cost: number;
  stock: number;
};

export type AuditRecord = {
  id: string;
  dateTime: string;
  user: string;
  action: string;
  entity: string;
  entityId: string;
  reason: string;
  before?: unknown;
  after?: unknown;
};

export type InternalNotificationRecord = {
  id: string;
  userEmail: string;
  title: string;
  body: string;
  type: string;
  href?: string;
  isRead: boolean;
  createdAt: string;
  readAt?: string;
};

export type ErrorLogRecord = {
  id: string;
  userEmail?: string;
  code?: string;
  message: string;
  route?: string;
  action?: string;
  severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  metadata?: unknown;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
  resolvedAt?: string;
};

export type StoredFileRecord = {
  id: string;
  bucket: string;
  path: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  category: string;
  entity?: string;
  entityId?: string;
  uploadedByEmail: string;
  ownerUserEmail?: string;
  employeeId?: string;
  isSensitive: boolean;
  createdAt: string;
};

export type EmployeeRegistrationStatus = "Rascunho" | "Enviado" | "Pendente de Aprovação" | "Ajuste Solicitado" | "Aprovado" | "Recusado" | "Ativo" | "Inativo";

export type EmployeeRegistrationRecord = {
  id: string;
  submittedAt: string;
  status: EmployeeRegistrationStatus;
  cnpj: string;
  fullName: string;
  addressType: string;
  addressName: string;
  addressNumber: string;
  complement?: string;
  neighborhood: string;
  city: string;
  stateUf: string;
  zipCode: string;
  primaryPhone: string;
  emergencyPhone: string;
  emergencyContactName: string;
  emergencyContactRelationship: string;
  birthDate: string;
  email: string;
  rg: string;
  rgIssuer: string;
  cpf: string;
  sex: string;
  maritalStatus: string;
  educationLevel: string;
  trainingStartDate: string;
  preferredSchedule: string;
  bankName: string;
  bankAgency: string;
  bankAccount: string;
  pixKey: string;
  pixKeyType: string;
  secondaryPixKey?: string;
  secondaryPixKeyType?: string;
  socialName?: string;
  hasChildren: boolean;
  childrenCount?: number;
  notes?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  createdUserEmail?: string;
  createdEmployeeProfileId?: string;
  operationalData?: RegistrationOperationalData;
  history: Array<{ at: string; actor: string; action: string; notes?: string }>;
  createdAt: string;
  updatedAt: string;
};

export type RegistrationOperationalData = {
  wbLogin: string;
  lob: string;
  team: string;
  supervisor: string;
  shift: string;
  schedule: string;
  roleTitle: string;
  employeeStatus: string;
  contractType: string;
  admissionDate: string;
  trainingDate: string;
  site: string;
  internalNotes?: string;
};

export type SensitiveEmployeeData = {
  employeeId: string;
  cpf: string;
  rg: string;
  rgIssuer: string;
  cnpj: string;
  birthDate: string;
  address: string;
  bankData: string;
  emergencyContactData: string;
  familyData: string;
};

export type AttendanceRecord = {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  shift: string;
  status: string;
  absenceReason?: string;
  reasonCategory?: string;
  supervisorJustification?: string;
  hasEvidence: boolean;
  evidenceUrl?: string;
  isJustified: boolean;
  impactsAbs: boolean;
  impactsCoverage: boolean;
  registeredBy: string;
  justifiedBy?: string;
  registeredAt: string;
  justifiedAt?: string;
  history: Array<{ at: string; actor: string; previousStatus?: string; newStatus: string; comment?: string }>;
};

export type ShiftReportRecord = {
  id: string;
  reportDate: string;
  submittedAt: string;
  shift: string;
  lob: string;
  operation: string;
  supervisor: string;
  rta: string;
  importance: Priority;
  plannedHeadcount: number;
  actualHeadcount: number;
  onlineAgents: number;
  absCount: number;
  absJustification: string;
  absentEmployees: Array<{ employeeId: string; employeeName: string; absenceReason: string; observation?: string; impactsAbs: boolean; impactsCoverage: boolean }>;
  queueStatusStart: string;
  queueStatusEnd: string;
  backlogStart: number;
  backlogEnd: number;
  latencyStart: string;
  latencyEnd: string;
  occurrenceCategory: string;
  impactLevel: string;
  occurrences: string;
  pendingTasks: string;
  generalMood: string;
  leadersPresent: string;
  mainRisks: string;
  actionsTaken: string;
  nextShiftAttentionPoints: string;
  requiresFollowUp: boolean;
  followUpOwner: string;
  followUpDueDate?: string;
  followUpStatus: string;
  additionalComments: string;
};

type MockDb = {
  employees: Array<(typeof seedEmployees)[number] & { email?: string }>;
  requests: RequestRecord[];
  scheduleDaysByEmail: Record<string, ScheduleDayRecord[]>;
  scheduleGridRows: typeof seedScheduleGridRows;
  scheduleImports: Array<{ id: string; fileName: string; importedRows: number; status: string; createdAt: string; user: string }>;
  registrationRequests: EmployeeRegistrationRecord[];
  sensitiveDataByEmployeeId: Record<string, SensitiveEmployeeData>;
  attendanceRecords: AttendanceRecord[];
  shiftReports: ShiftReportRecord[];
  birthdayNotifications: Array<{ id: string; employeeId: string; employeeName: string; birthdayDate: string; month: number; visibleTo: string }>;
  announcements: AnnouncementRecord[];
  qualityFeedback: QualityFeedbackRecord[];
  equipment: EquipmentRecord[];
  equipmentTickets: EquipmentTicketRecord[];
  tokenBalances: Record<string, number>;
  tokenHistoryByEmail: Record<string, TokenTransactionRecord[]>;
  rewards: RewardRecord[];
  chatMessagesByRoom: Record<string, Array<{ id: string; author: string; message: string; time: string; self: boolean }>>;
  climateAnswers: Array<{ id: string; userEmail: string; surveyId: string; answers: unknown; submittedAt: string }>;
  anonymousFeedback: Array<{ id: string; category: string; message: string; status: string; evidenceUrl?: string; createdAt: string }>;
  notifications: InternalNotificationRecord[];
  errorLogs: ErrorLogRecord[];
  storedFiles: StoredFileRecord[];
  audit: AuditRecord[];
};

const globalForMockDb = globalThis as unknown as { __centralOperacionalMockDb?: MockDb };

export function getActorFromSession(session: Session | null): Actor {
  if (session?.user?.email) {
    return {
      email: session.user.email,
      name: session.user.name ?? session.user.email,
      role: (session.user.role as AppRole | undefined) ?? "COLABORADOR"
    };
  }

  if (process.env.ALLOW_DEMO_LOGIN === "true" || process.env.ALLOW_DEMO_DATA === "true") {
    const demoUser = getDemoUser("admin@central.com");
    return {
      email: demoUser.email,
      name: demoUser.name,
      role: demoUser.role
    };
  }

  return {
    email: "",
    name: "Usuário não autenticado",
    role: "COLABORADOR"
  };
}

export function getMockDb() {
  if (!globalForMockDb.__centralOperacionalMockDb) {
    globalForMockDb.__centralOperacionalMockDb = createInitialDb();
  }

  return globalForMockDb.__centralOperacionalMockDb;
}

export function listNotifications(actor: Actor) {
  const db = getMockDb();
  return db.notifications
    .filter((notification) => notification.userEmail === actor.email || notification.userEmail === "ALL")
    .sort((a, b) => Number(a.isRead) - Number(b.isRead))
    .slice(0, 20);
}

export function markNotificationRead(actor: Actor, id: string) {
  const db = getMockDb();
  const targets =
    id === "ALL"
      ? db.notifications.filter((notification) => notification.userEmail === actor.email || notification.userEmail === "ALL")
      : db.notifications.filter((notification) => notification.id === id && (notification.userEmail === actor.email || notification.userEmail === "ALL"));

  for (const notification of targets) {
    notification.isRead = true;
    notification.readAt = timestamp();
  }

  return listNotifications(actor);
}

export function createInternalNotification(input: Omit<InternalNotificationRecord, "id" | "createdAt" | "isRead"> & { isRead?: boolean }) {
  const db = getMockDb();
  const notification: InternalNotificationRecord = {
    ...input,
    id: `NOT-${Date.now()}-${db.notifications.length}`,
    isRead: input.isRead ?? false,
    createdAt: timestamp()
  };
  db.notifications.unshift(notification);
  return notification;
}

export function recordErrorLog(input: Omit<ErrorLogRecord, "id" | "createdAt" | "severity"> & { severity?: ErrorLogRecord["severity"] }) {
  const db = getMockDb();
  const record: ErrorLogRecord = {
    ...input,
    id: `ERR-${Date.now()}-${db.errorLogs.length}`,
    severity: input.severity ?? "ERROR",
    createdAt: timestamp()
  };
  db.errorLogs.unshift(record);
  return record;
}

export function listErrorLogs(actor: Actor) {
  if (!["ADMIN", "GESTOR"].includes(actor.role)) return [];
  return getMockDb().errorLogs;
}

export function registerStoredFile(actor: Actor, input: Omit<StoredFileRecord, "id" | "createdAt" | "uploadedByEmail">) {
  const db = getMockDb();
  const record: StoredFileRecord = {
    ...input,
    id: `FILE-${Date.now()}-${db.storedFiles.length}`,
    uploadedByEmail: actor.email,
    createdAt: timestamp()
  };
  db.storedFiles.unshift(record);
  addAudit(actor, "UPLOAD", "StoredFile", record.id, `Arquivo enviado em ${record.bucket}`, undefined, {
    bucket: record.bucket,
    path: record.path,
    fileName: record.fileName,
    sizeBytes: record.sizeBytes,
    entity: record.entity,
    entityId: record.entityId
  });
  return record;
}

export function getPlatformUsage(actor: Actor) {
  if (!["ADMIN", "GESTOR"].includes(actor.role)) {
    return { error: "Sem permissão para visualizar uso da plataforma." };
  }

  const db = getMockDb();
  const totalStorageBytes = db.storedFiles.reduce((total, file) => total + file.sizeBytes, 0);
  const openRequests = db.requests.filter((request) => !["Concluído", "Cancelado", "Recusado"].includes(request.status)).length;
  const pendingRegistrations = db.registrationRequests.filter((item) => item.status === "Pendente de Aprovação").length;
  const alerts = [
    pendingRegistrations > 5 ? "Cadastros pendentes acima do esperado." : null,
    openRequests > 20 ? "Fila de solicitações acumulada." : null,
    db.errorLogs.length > 10 ? "Muitos erros internos registrados nas últimas execuções." : null,
    totalStorageBytes > 250 * 1024 * 1024 ? "Storage estimado em crescimento acelerado." : null
  ].filter(Boolean);

  return {
    activeUsers: demoUsers.length + db.employees.length,
    employees: db.employees.length,
    uploadedFiles: db.storedFiles.length,
    storageBytes: totalStorageBytes,
    storageLabel: `${Math.max(0.01, totalStorageBytes / 1024 / 1024).toFixed(2)} MB`,
    requests: db.requests.length,
    openRequests,
    scheduleImports: db.scheduleImports.length,
    shiftReports: db.shiftReports.length,
    auditLogs: db.audit.length,
    notifications: db.notifications.length,
    unreadNotifications: db.notifications.filter((notification) => !notification.isRead).length,
    errorLogs: db.errorLogs.length,
    pendingRegistrations,
    alerts: alerts.length ? alerts : ["Uso dentro do esperado para o MVP."]
  };
}

export function listRequests(actor: Actor) {
  const db = getMockDb();
  return db.requests.filter((request) => canSeeRequest(actor, request));
}

export function listEmployeesForActor(actor: Actor) {
  const db = getMockDb();
  const canViewSensitive = ["ADMIN", "GESTOR", "RH"].includes(actor.role);
  const canViewBank = ["ADMIN", "GESTOR"].includes(actor.role);
  const canViewContact = ["ADMIN", "GESTOR", "RH", "TI"].includes(actor.role);
  const visibleEmployees =
    actor.role === "COLABORADOR"
      ? db.employees.filter((employee) => employeeEmail(employee) === actor.email)
      : actor.role === "SUPERVISOR"
        ? db.employees.filter((employee) => employee.supervisor === actor.name)
        : db.employees;

  return visibleEmployees.map((employee) => {
    const sensitive = db.sensitiveDataByEmployeeId[employee.id];
    const attendanceHistory = db.attendanceRecords.filter((record) => record.employeeId === employee.id).slice(0, 8);
    return {
      ...employee,
      canViewSensitive,
      sensitive: canViewSensitive ? sensitive : undefined,
      restrictedSections: {
        cadastrais: canViewSensitive || actor.role === "COLABORADOR",
        contato: canViewContact || actor.role === "COLABORADOR",
        emergencia: canViewContact || canViewSensitive,
        bancarios: canViewBank,
        familia: canViewSensitive
      },
      maskedSensitive: sensitive
        ? {
            cpf: maskDocument(sensitive.cpf),
            rg: maskDocument(sensitive.rg),
            bankData: canViewBank ? sensitive.bankData : "Acesso restrito",
            emergencyContactData: canViewContact ? sensitive.emergencyContactData : "Acesso restrito"
          }
        : undefined,
      attendanceHistory,
      lastPresence: attendanceHistory[0]?.registeredAt ?? "Sem registro recente"
    };
  });
}

export function submitEmployeeRegistration(input: Omit<EmployeeRegistrationRecord, "id" | "submittedAt" | "status" | "history" | "createdAt" | "updatedAt">) {
  const db = getMockDb();
  const errors = validateRegistration(input);

  if (db.registrationRequests.some((item) => digits(item.cpf) === digits(input.cpf))) errors.push("CPF já possui cadastro ou solicitação.");
  if (db.registrationRequests.some((item) => item.email.toLowerCase() === input.email.toLowerCase())) errors.push("E-mail já possui cadastro ou solicitação.");
  if (db.employees.some((employee) => employeeEmail(employee)?.toLowerCase() === input.email.toLowerCase())) errors.push("E-mail já está vinculado a colaborador ativo.");

  if (errors.length) return { error: errors.join(" ") };

  const now = timestamp();
  const record: EmployeeRegistrationRecord = {
    ...input,
    id: `CAD-${Date.now().toString().slice(-6)}`,
    submittedAt: now,
    status: "Pendente de Aprovação",
    history: [{ at: now, actor: input.fullName, action: "Cadastro enviado" }],
    createdAt: now,
    updatedAt: now
  };

  db.registrationRequests.unshift(record);
  for (const userEmail of ["rh@central.com", "admin@central.com", "wfm@central.com"]) {
    createInternalNotification({
      userEmail,
      title: "Cadastro enviado para aprovação",
      body: `${record.fullName} enviou cadastro e aguarda validação.`,
      type: "CADASTRO",
      href: "/cadastros"
    });
  }
  addAudit(systemActor(), "CRIAÇÃO", "EmployeeRegistrationRequest", record.id, "Cadastro público enviado", undefined, { fullName: record.fullName, email: record.email, status: record.status });
  return { data: record };
}

export function listEmployeeRegistrations(actor: Actor) {
  if (!["ADMIN", "GESTOR", "RH", "WFM"].includes(actor.role)) return [];
  return getMockDb().registrationRequests;
}

export function reviewEmployeeRegistration(
  actor: Actor,
  input: { id: string; action: "approve" | "reject" | "request_adjustment"; reviewNotes: string; operationalData?: RegistrationOperationalData }
) {
  const db = getMockDb();
  if (!["ADMIN", "GESTOR", "RH", "WFM"].includes(actor.role)) return { error: "Sem permissão para revisar cadastros." };

  const record = db.registrationRequests.find((item) => item.id === input.id);
  if (!record) return { error: "Cadastro não encontrado." };

  const before = { status: record.status, operationalData: record.operationalData };
  record.reviewedBy = actor.name;
  record.reviewedAt = timestamp();
  record.reviewNotes = input.reviewNotes;
  record.updatedAt = timestamp();

  if (input.action === "request_adjustment") {
    record.status = "Ajuste Solicitado";
    record.history.unshift({ at: timestamp(), actor: actor.name, action: "Ajuste solicitado", notes: input.reviewNotes });
    createInternalNotification({ userEmail: record.email, title: "Ajuste de cadastro solicitado", body: input.reviewNotes, type: "CADASTRO", href: "/cadastro-colaborador" });
    addAudit(actor, "AJUSTE_SOLICITADO", "EmployeeRegistrationRequest", record.id, input.reviewNotes, before, { status: record.status });
    return { data: record };
  }

  if (input.action === "reject") {
    record.status = "Recusado";
    record.history.unshift({ at: timestamp(), actor: actor.name, action: "Cadastro recusado", notes: input.reviewNotes });
    createInternalNotification({ userEmail: record.email, title: "Cadastro recusado", body: input.reviewNotes, type: "CADASTRO", href: "/cadastro-colaborador" });
    addAudit(actor, "RECUSA", "EmployeeRegistrationRequest", record.id, input.reviewNotes, before, { status: record.status });
    return { data: record };
  }

  const operationalData = input.operationalData ?? defaultOperationalData(record);
  const duplicateWb = db.employees.some((employee) => employee.wb === operationalData.wbLogin);
  if (duplicateWb) return { error: "WB/Login já existe no Mapa de Funcionários." };

  const employee = {
    id: `EMP-${Date.now().toString().slice(-6)}`,
    name: record.socialName?.trim() || record.fullName,
    wb: operationalData.wbLogin,
    lob: operationalData.lob,
    supervisor: operationalData.supervisor,
    shift: operationalData.shift,
    schedule: operationalData.schedule,
    status: operationalData.employeeStatus,
    quality: 92,
    productivity: 88,
    equipment: 0,
    admission: formatBrazilianDate(operationalData.admissionDate),
    role: operationalData.roleTitle,
    email: record.email
  };

  db.employees.unshift(employee);
  db.scheduleDaysByEmail[record.email] = cloneScheduleDays(operationalData.shift);
  db.sensitiveDataByEmployeeId[employee.id] = {
    employeeId: employee.id,
    cpf: record.cpf,
    rg: record.rg,
    rgIssuer: record.rgIssuer,
    cnpj: record.cnpj,
    birthDate: record.birthDate,
    address: `${record.addressType} ${record.addressName}, ${record.addressNumber}${record.complement ? ` - ${record.complement}` : ""}, ${record.neighborhood}, ${record.city}/${record.stateUf}, ${record.zipCode}`,
    bankData: `${record.bankName} • Ag ${record.bankAgency} • CC ${record.bankAccount} • PIX ${record.pixKeyType}: ${record.pixKey}`,
    emergencyContactData: `${record.emergencyContactName} (${record.emergencyContactRelationship}) • ${record.emergencyPhone}`,
    familyData: record.hasChildren ? `${record.childrenCount ?? 0} filho(s)` : "Sem filhos"
  };
  db.birthdayNotifications.unshift({
    id: `BD-${employee.id}`,
    employeeId: employee.id,
    employeeName: employee.name,
    birthdayDate: record.birthDate,
    month: Number(record.birthDate.slice(5, 7)),
    visibleTo: "RH,Gestão,Supervisor"
  });

  record.status = "Ativo";
  record.operationalData = operationalData;
  record.createdUserEmail = record.email;
  record.createdEmployeeProfileId = employee.id;
  record.history.unshift({ at: timestamp(), actor: actor.name, action: "Cadastro aprovado e colaborador ativado", notes: input.reviewNotes });
  createInternalNotification({ userEmail: record.email, title: "Cadastro aprovado", body: "Seu acesso foi liberado e seus dados já aparecem no Mapa de Funcionários.", type: "CADASTRO", href: "/minha-escala" });
  addAudit(actor, "APROVAÇÃO", "EmployeeRegistrationRequest", record.id, "Cadastro aprovado e Mapa de Funcionários atualizado", before, { status: record.status, employee });
  return { data: record, employee };
}

export function createRequest(actor: Actor, input: { type: string; title?: string; priority: Priority; description: string; payload?: Record<string, unknown>; requester?: string }) {
  const db = getMockDb();
  const requester = input.requester?.trim() || actor.name;
  const requesterEmail = findEmployeeEmailByName(requester) ?? actor.email;
  const record: RequestRecord = {
    id: `REQ-${Date.now().toString().slice(-6)}`,
    type: input.type,
    title: input.title?.trim() || input.type,
    requester,
    requesterEmail,
    priority: input.priority,
    status: "Aberto",
    area: areaForRequest(input.type),
    time: "Agora",
    description: input.description,
    payload: input.payload ?? {},
    history: [{ at: timestamp(), actor: actor.name, action: "Criação" }],
    comments: [{ at: timestamp(), author: actor.name, body: input.description }],
    createdAt: timestamp(),
    updatedAt: timestamp()
  };

  db.requests.unshift(record);
  createInternalNotification({ userEmail: actor.email, title: isMockDayOff(record) ? "Solicitação de folga criada" : "Solicitação criada", body: isMockDayOff(record) ? "Sua solicitação foi enviada para aprovação." : `${record.type} foi registrada com status Aberto.`, type: "SOLICITACAO", href: "/solicitacoes" });
  for (const userEmail of firstStepRecipients(record)) {
    createInternalNotification({ userEmail, title: isMockDayOff(record) ? "Nova solicitação de folga" : "Nova solicitação", body: isMockDayOff(record) ? `${record.type} aguardando análise.` : `${record.type} aberta por ${record.requester}.`, type: "SOLICITACAO", href: "/esteiras" });
  }
  addAudit(actor, "CRIAÇÃO", "Request", record.id, "Solicitação criada", undefined, record);
  return record;
}

export function updateRequestStatus(actor: Actor, id: string, status: RequestStatus, reason?: string, actionInput?: { finalApprovedShift?: string; finalApprovedStartTime?: string; finalApprovedEndTime?: string }) {
  const db = getMockDb();
  const record = db.requests.find((request) => request.id === id);

  if (!record) {
    return null;
  }

  if (!canSeeRequest(actor, record)) {
    return "FORBIDDEN" as const;
  }

  const transition = resolveMockTransition(actor, record, status);
  if (transition === "FORBIDDEN") return transition;
  if ("error" in transition) return transition;
  if (status === "Recusado" && !reason?.trim()) return { error: "Informe o motivo da recusa." };

  if (record.status === transition.nextStatus || ["Concluído", "Recusado", "Cancelado"].includes(record.status) || (record.status === "Aprovado" && transition.nextStatus !== "Concluído")) {
    return { error: "Esta solicitação já foi processada." };
  }

  const before = { status: record.status, payload: record.payload };
  let scheduleUpdated = false;
  if (transition.applySchedule && isMockDayOff(record)) {
    scheduleUpdated = applyMockDayOffToSchedule(record, actor, actionInput);
    if (!scheduleUpdated) return { error: "Não foi possível aplicar a solicitação no cronograma. Verifique as datas e tente novamente." };
    record.history.unshift({ at: timestamp(), actor: actor.name, action: "Cronograma atualizado", reason: "Solicitação de folga aplicada no cronograma." });
  }

  record.status = transition.nextStatus;
  record.updatedAt = timestamp();
  record.history.unshift({ at: timestamp(), actor: actor.name, action: transition.historyAction, reason });

  if (reason) {
    record.comments.unshift({ at: timestamp(), author: actor.name, body: reason });
  }

  createInternalNotification({
    userEmail: record.requesterEmail,
    title: transition.requesterTitle,
    body: transition.requesterBody(reason),
    type: "SOLICITACAO",
    href: "/solicitacoes"
  });

  if (transition.notifyWfm) {
    for (const userEmail of ["wfm@central.com", "admin@central.com", "gestor@central.com"]) {
      createInternalNotification({ userEmail, title: "Solicitação aguardando WFM", body: `${record.type} aprovada pelo supervisor e aguardando análise final.`, type: "SOLICITACAO", href: "/esteiras" });
    }
  }

  if (transition.notifySupervisor) {
    const supervisorEmail = supervisorEmailForRequest(record);
    if (supervisorEmail) {
      createInternalNotification({ userEmail: supervisorEmail, title: "Solicitação atualizada pelo WFM", body: `${record.id} foi atualizada pelo WFM.`, type: "SOLICITACAO", href: "/esteiras" });
    }
  }

  addAudit(
    actor,
    transition.auditAction,
    "Request",
    record.id,
    reason ?? `Status: ${record.status}`,
    before,
    { status: record.status, payload: record.payload, scheduleUpdated }
  );

  return { record, scheduleUpdated };
}

export function addRequestComment(actor: Actor, id: string, body: string) {
  const db = getMockDb();
  const record = db.requests.find((request) => request.id === id);
  if (!record) return null;
  if (!canSeeRequest(actor, record)) return "FORBIDDEN" as const;

  const comment = { at: timestamp(), author: actor.name, body };
  record.comments.unshift(comment);
  record.history.unshift({ at: timestamp(), actor: actor.name, action: "Comentário", reason: body });
  record.updatedAt = timestamp();

  const participants = new Set<string>([record.requesterEmail, actor.email]);
  for (const participant of participants) {
    if (participant !== actor.email) {
      createInternalNotification({
        userEmail: participant,
        title: "Novo comentário na solicitação",
        body: `${actor.name}: ${body}`,
        type: "REQUEST",
        href: `/solicitacoes?request=${record.id}`
      });
    }
  }

  addAudit(actor, "COMENTÁRIO", "Request", record.id, body, undefined, comment);
  return record;
}

export function previewScheduleRows(rows: Array<Record<string, unknown>>) {
  const required = ["wb_login", "nome", "data", "status"];
  const validStatus = ["Escalado", "Folga", "Férias", "Treinamento", "Feriado", "Conflito", "Descoberto"];
  const validLobs = ["CEC", "TNS", "ADS"];
  const validSupervisors = new Set(seedEmployees.map((employee) => employee.supervisor));
  const seen = new Set<string>();

  const validation = rows.map((row, index) => {
    const errors = required.filter((field) => !String(row[field] ?? "").trim()).map((field) => `${field} obrigatório`);
    const status = String(row.status ?? "");
    if (status && !validStatus.includes(status)) errors.push("status inválido");
    if (status === "Escalado" && !String(row.turno ?? "").trim()) errors.push("turno obrigatório quando status for Escalado");

    const key = `${row.wb_login ?? ""}-${row.data ?? ""}`;
    if (seen.has(key)) errors.push("conflito para mesma pessoa no mesmo dia");
    seen.add(key);

    const warnings = [];
    if (row.lob && !validLobs.includes(String(row.lob))) warnings.push("LOB não existe");
    if (row.supervisor && !validSupervisors.has(String(row.supervisor))) warnings.push("supervisor não existe");
    if (index % 11 === 0) warnings.push("cobertura abaixo do mínimo configurado");

    return { rowNumber: index + 2, errors, warnings };
  });

  return {
    totalRows: rows.length,
    validRows: validation.filter((item) => item.errors.length === 0).length,
    errorRows: validation.filter((item) => item.errors.length > 0).length,
    rows: rows.slice(0, 25),
    validation
  };
}

export function commitScheduleImport(actor: Actor, input: { fileName: string; allowPartial: boolean; rows: Array<Record<string, unknown>> }) {
  const db = getMockDb();
  const preview = previewScheduleRows(input.rows);

  if (preview.errorRows > 0 && !input.allowPartial) {
    return { error: "Existem linhas com erro. Confirme importação parcial para continuar.", preview };
  }

  for (const row of input.rows) {
    const wb = String(row.wb_login ?? "");
    const employee = db.employees.find((item) => item.wb === wb || item.name === row.nome);
    if (!employee) continue;

    const email = findEmployeeEmailByName(employee.name);
    if (!email) continue;

    const day = extractDay(row.data);
    if (!day) continue;

    const days = db.scheduleDaysByEmail[email] ?? cloneScheduleDays();
    const target = days.find((item) => item.date === day && !item.outside);
    if (!target) continue;

    const status = String(row.status ?? "");
    const shift = status === "Escalado" ? String(row.turno ?? target.shift) : status;
    target.shift = shift || target.shift;
    target.label = shift || target.label;
    db.scheduleDaysByEmail[email] = days;
  }

  const record = {
    id: `IMP-${Date.now()}`,
    fileName: input.fileName,
    importedRows: input.allowPartial ? preview.validRows : input.rows.length,
    status: input.allowPartial ? "Importação parcial concluída" : "Importação concluída",
    createdAt: timestamp(),
    user: actor.name
  };

  db.scheduleImports.unshift(record);
  createInternalNotification({ userEmail: actor.email, title: "Importação de cronograma concluída", body: `${record.fileName}: ${record.importedRows} linhas importadas.`, type: "ESCALA", href: "/escalas" });
  addAudit(actor, "IMPORTAÇÃO", "ScheduleImport", record.fileName, `${record.importedRows} linhas válidas`, undefined, record);
  return { data: record, preview };
}

export function getSchedulesForActor(actor: Actor) {
  const db = getMockDb();
  if (actor.role === "COLABORADOR") {
    return {
      scheduleDays: db.scheduleDaysByEmail[actor.email] ?? cloneScheduleDays(),
      scheduleGridRows: [],
      imports: db.scheduleImports.slice(0, 5)
    };
  }

  if (actor.role === "SUPERVISOR") {
    return {
      scheduleDays: db.scheduleDaysByEmail[actor.email] ?? cloneScheduleDays(),
      scheduleGridRows: db.scheduleGridRows.filter((row) => row.employee.supervisor === actor.name),
      imports: db.scheduleImports.slice(0, 5)
    };
  }

  return {
    scheduleDays: db.scheduleDaysByEmail["colaborador@central.com"] ?? cloneScheduleDays(),
    scheduleGridRows: db.scheduleGridRows,
    imports: db.scheduleImports.slice(0, 5),
    attendanceSummary: getAttendanceSummary(actor)
  };
}

export function listAttendanceRecords(actor: Actor) {
  const db = getMockDb();
  if (actor.role === "COLABORADOR") {
    const employee = db.employees.find((item) => employeeEmail(item) === actor.email);
    return employee ? db.attendanceRecords.filter((record) => record.employeeId === employee.id) : [];
  }
  if (actor.role === "SUPERVISOR") {
    const teamIds = new Set(db.employees.filter((employee) => employee.supervisor === actor.name).map((employee) => employee.id));
    return db.attendanceRecords.filter((record) => teamIds.has(record.employeeId));
  }
  return db.attendanceRecords;
}

export function updateAttendance(actor: Actor, input: { employeeId: string; date: string; shift: string; status: string; absenceReason?: string; reasonCategory?: string; supervisorJustification?: string; hasEvidence?: boolean; evidenceUrl?: string }) {
  const db = getMockDb();
  const employee = db.employees.find((item) => item.id === input.employeeId);
  if (!employee) return { error: "Colaborador não encontrado." };
  if (actor.role === "COLABORADOR") return { error: "Colaborador não pode alterar presença." };
  if (actor.role === "SUPERVISOR" && employee.supervisor !== actor.name) return { error: "Supervisor só pode justificar o próprio time." };
  if (!["ADMIN", "GESTOR", "WFM", "SUPERVISOR"].includes(actor.role)) return { error: "Sem permissão para alterar presença." };

  const impactsAbs = shouldImpactAbs(input.status, input.absenceReason);
  const impactsCoverage = shouldImpactCoverage(input.status);
  const current = db.attendanceRecords.find((record) => record.employeeId === employee.id && record.date === input.date && record.shift === input.shift);
  const before = current ? { ...current } : undefined;

  const record: AttendanceRecord =
    current ??
    {
      id: `ATT-${Date.now().toString().slice(-6)}`,
      employeeId: employee.id,
      employeeName: employee.name,
      date: input.date,
      shift: input.shift,
      status: "Presente",
      hasEvidence: false,
      isJustified: false,
      impactsAbs: false,
      impactsCoverage: false,
      registeredBy: actor.name,
      registeredAt: timestamp(),
      history: []
    };

  const previousStatus = record.status;
  record.status = input.status;
  record.absenceReason = input.absenceReason;
  record.reasonCategory = input.reasonCategory;
  record.supervisorJustification = input.supervisorJustification;
  record.hasEvidence = Boolean(input.hasEvidence);
  record.evidenceUrl = input.evidenceUrl;
  record.isJustified = Boolean(input.supervisorJustification) || ["Presente", "Folga", "Férias", "Treinamento", "Erro de cronograma"].includes(input.status);
  record.impactsAbs = impactsAbs;
  record.impactsCoverage = impactsCoverage;
  record.registeredBy = actor.name;
  record.registeredAt = timestamp();
  if (actor.role === "SUPERVISOR") {
    record.justifiedBy = actor.name;
    record.justifiedAt = timestamp();
  }
  record.history.unshift({ at: timestamp(), actor: actor.name, previousStatus, newStatus: record.status, comment: input.supervisorJustification });

  if (!current) db.attendanceRecords.unshift(record);

  employee.status = statusToEmployeeStatus(input.status);
  updateSchedulePresence(employee, input.date, input.status);

  if (/problema técnico|falta de equipamento|internet/i.test(input.absenceReason ?? "")) {
    createRequest(actor, {
      type: /equipamento/i.test(input.absenceReason ?? "") ? "Problema com equipamento" : "Suporte geral",
      priority: "Alta",
      requester: employee.name,
      description: `Ausência/impacto operacional por ${input.absenceReason}`,
      payload: { attendanceRecordId: record.id, employeeId: employee.id, date: input.date }
    });
  }

  const summary = getAttendanceSummary(actor);
  const employeeEmail = employeeEmailFromEmployee(employee);
  if (employeeEmail) {
    createInternalNotification({ userEmail: employeeEmail, title: "Presença atualizada", body: `Status ${record.status} registrado para ${input.date}.`, type: "PRESENCA", href: "/minha-escala" });
  }
  if (record.impactsCoverage) {
    createInternalNotification({ userEmail: "wfm@central.com", title: "Ausência registrada", body: `${employee.name} registrado como ${record.status}; cobertura recalculada.`, type: "PRESENCA", href: "/staff-cobertura" });
  }
  addAudit(actor, "ALTERAÇÃO_PRESENÇA", "AttendanceRecord", record.id, `Status ${previousStatus} -> ${record.status}`, before, record);
  if (summary.riskLevel === "Crítico") {
    addAudit(actor, "ALERTA_COBERTURA", "CoverageSnapshot", input.date, "Ausência gerou risco crítico de cobertura", undefined, summary);
  }
  return { data: record, summary };
}

export function getAttendanceSummary(_actor?: Actor) {
  const db = getMockDb();
  const todayRecords = db.attendanceRecords;
  const absent = todayRecords.filter((record) => record.impactsAbs).length;
  const late = todayRecords.filter((record) => record.status === "Atraso").length;
  const earlyLeave = todayRecords.filter((record) => record.status === "Saída antecipada").length;
  const planned = db.employees.length || 1;
  const present = Math.max(0, planned - todayRecords.filter((record) => record.impactsCoverage).length);
  const coverageRate = Math.round((present / planned) * 1000) / 10;
  const gap = present - planned;
  const riskLevel = coverageRate >= 95 ? "Excelente" : coverageRate >= 90 ? "Adequado" : coverageRate >= 85 ? "Atenção" : "Crítico";
  const byReason = todayRecords.reduce<Record<string, number>>((acc, record) => {
    if (!record.absenceReason) return acc;
    acc[record.absenceReason] = (acc[record.absenceReason] ?? 0) + 1;
    return acc;
  }, {});

  return {
    planned,
    present,
    absent,
    absRate: Math.round((absent / planned) * 1000) / 10,
    late,
    earlyLeave,
    unjustified: todayRecords.filter((record) => record.impactsAbs && !record.isJustified).length,
    coverageRate,
    gap,
    riskLevel,
    byReason
  };
}

export function createShiftReport(actor: Actor, input: Omit<ShiftReportRecord, "id" | "submittedAt" | "supervisor"> & { supervisor?: string }) {
  if (!["ADMIN", "GESTOR", "SUPERVISOR", "WFM"].includes(actor.role)) return { error: "Sem permissão para enviar report de turno." };
  const db = getMockDb();
  const report: ShiftReportRecord = {
    ...input,
    id: `SRT-${Date.now().toString().slice(-6)}`,
    submittedAt: timestamp(),
    supervisor: input.supervisor?.trim() || actor.name
  };
  db.shiftReports.unshift(report);
  for (const userEmail of ["gestor@central.com", "admin@central.com", "wfm@central.com"]) {
    createInternalNotification({ userEmail, title: "Report de turno enviado", body: `${report.shift}/${report.lob} enviado por ${report.supervisor}.`, type: "REPORT_TURNO", href: "/report-turno" });
  }

  for (const absent of report.absentEmployees) {
    updateAttendance(actor, {
      employeeId: absent.employeeId,
      date: report.reportDate,
      shift: report.shift,
      status: "Ausente",
      absenceReason: absent.absenceReason,
      reasonCategory: "Pessoas",
      supervisorJustification: absent.observation,
      hasEvidence: false
    });
  }

  addAudit(actor, "CRIAÇÃO", "ShiftReport", report.id, `Report ${report.shift}/${report.lob} enviado`, undefined, report);
  return { data: report, briefing: generateShiftBriefing() };
}

export function listShiftReports(actor: Actor) {
  const db = getMockDb();
  if (["ADMIN", "GESTOR", "WFM"].includes(actor.role)) return db.shiftReports;
  if (actor.role === "SUPERVISOR") return db.shiftReports.filter((report) => report.supervisor === actor.name);
  return [];
}

export function getShiftReportDashboard(actor: Actor) {
  const reports = listShiftReports(actor);
  const critical = reports.filter((report) => report.importance === "Crítica" || report.impactLevel === "Crítico").length;
  const absTotal = reports.reduce((total, report) => total + report.absCount, 0);
  const pendingFollowUps = reports.filter((report) => report.requiresFollowUp && report.followUpStatus !== "Concluído").length;
  const byCategory = reports.reduce<Record<string, number>>((acc, report) => {
    acc[report.occurrenceCategory] = (acc[report.occurrenceCategory] ?? 0) + 1;
    return acc;
  }, {});
  const moodByShift = reports.reduce<Record<string, string>>((acc, report) => {
    acc[report.shift] = report.generalMood;
    return acc;
  }, {});

  return {
    total: reports.length,
    byShift: countBy(reports, "shift"),
    critical,
    absTotal,
    pendingFollowUps,
    overdueFollowUps: reports.filter((report) => report.requiresFollowUp && report.followUpDueDate && new Date(report.followUpDueDate) < new Date()).length,
    byCategory,
    moodByShift,
    backlogDelta: reports.map((report) => ({ report: report.id, start: report.backlogStart, end: report.backlogEnd })),
    recent: reports.slice(0, 6),
    briefing: generateShiftBriefing()
  };
}

export function generateShiftBriefing() {
  const db = getMockDb();
  const reports = db.shiftReports.slice(0, 5);
  const attendance = getAttendanceSummary();
  const criticalReports = reports.filter((report) => report.importance === "Crítica" || report.impactLevel === "Crítico");
  const risks = reports.flatMap((report) => report.mainRisks.split(/\n|;|\./).map((item) => item.trim()).filter(Boolean)).slice(0, 5);
  const actions = reports.flatMap((report) => report.actionsTaken.split(/\n|;|\./).map((item) => item.trim()).filter(Boolean)).slice(0, 5);
  return {
    title: "Resumo Gerencial do Dia",
    generatedAt: timestamp(),
    whatHappened: reports.length
      ? `${reports.length} report(s) analisados; ${criticalReports.length} crítico(s); ABS consolidado de ${attendance.absRate}%.`
      : "Sem reports enviados para o período selecionado.",
    mainRisks: risks.length ? risks : ["Cobertura em monitoramento", "Backlog por turno ainda sem consolidação completa"],
    worstImpacts: criticalReports.map((report) => `${report.shift}/${report.lob}: ${report.occurrenceCategory} com impacto ${report.impactLevel}`).slice(0, 4),
    decisionsNeeded: reports.filter((report) => report.requiresFollowUp).map((report) => `${report.followUpOwner}: ${report.pendingTasks || report.nextShiftAttentionPoints}`).slice(0, 5),
    abs: `${attendance.absent} ausência(s), ${attendance.unjustified} sem justificativa, risco ${attendance.riskLevel}.`,
    mood: reports[0]?.generalMood ?? "Neutro",
    queueStatus: reports[0] ? `Início: ${reports[0].queueStatusStart}; Fim: ${reports[0].queueStatusEnd}` : "Sem report recente",
    actionsTaken: actions,
    recommendations: [
      "Priorizar follow-ups vencidos antes do próximo pico de volume.",
      "Validar ausências sem justificativa com supervisores responsáveis.",
      "Escalar impactos críticos de sistema/equipamento para TI e WFM."
    ]
  };
}

export function listAnnouncements(actor: Actor) {
  const db = getMockDb();
  const currentMonth = new Date().getMonth() + 1;
  const birthdays = db.birthdayNotifications
    .filter((item) => item.month === currentMonth || item.month === 5)
    .slice(0, 4)
    .map<AnnouncementRecord>((birthday) => ({
      id: birthday.id,
      title: `Aniversariante do mês: ${birthday.employeeName}`,
      category: "Campanha interna",
      body: `Celebre com ${birthday.employeeName}. Campanhas segmentadas respeitam a visibilidade configurada.`,
      date: birthday.birthdayDate,
      area: "RH",
      status: "Informativo",
      requiresRead: false,
      readBy: []
    }));

  return [...birthdays, ...db.announcements].map((announcement) => ({
    ...announcement,
    read: announcement.readBy.includes(actor.email),
    status: announcement.readBy.includes(actor.email) ? "Lido" : announcement.status
  }));
}

export function markAnnouncementRead(actor: Actor, announcementId: string) {
  const db = getMockDb();
  const targets = announcementId === "ALL" ? db.announcements : db.announcements.filter((announcement) => announcement.id === announcementId);

  for (const announcement of targets) {
    if (!announcement.readBy.includes(actor.email)) {
      announcement.readBy.push(actor.email);
      addAudit(actor, "CONFIRMAÇÃO_LEITURA", "Announcement", announcement.id, announcement.title, undefined, { readBy: actor.email });
    }
  }

  return listAnnouncements(actor);
}

export function listQualityFeedback(actor: Actor) {
  const db = getMockDb();
  if (["ADMIN", "GESTOR", "QUALIDADE"].includes(actor.role)) return db.qualityFeedback;
  if (actor.role === "COLABORADOR") return db.qualityFeedback.filter((item) => item.employeeEmail === actor.email);
  if (actor.role === "SUPERVISOR") {
    const teamNames = new Set(db.employees.filter((employee) => employee.supervisor === actor.name).map((employee) => employee.name));
    return db.qualityFeedback.filter((item) => teamNames.has(item.employee));
  }
  return [];
}

export function createQualityFeedback(actor: Actor, input: { employeeId: string; type: string; theme: string; message: string; classification: "POSITIVO" | "ATENCAO" | "CRITICO" }) {
  const db = getMockDb();
  const employee = db.employees.find((item) => item.id === input.employeeId || item.name === input.employeeId) ?? db.employees[0];
  const record: QualityFeedbackRecord = {
    id: `QF-${Date.now().toString().slice(-6)}`,
    employee: employee.name,
    employeeEmail: findEmployeeEmailByName(employee.name) ?? `${employee.wb.toLowerCase()}@central.local`,
    author: actor.name,
    type: input.type || classificationLabel(input.classification),
    theme: input.theme,
    quality: input.classification === "CRITICO" ? "68%" : input.classification === "ATENCAO" ? "78%" : "96%",
    status: "Pendente",
    message: input.message,
    createdAt: timestamp()
  };

  db.qualityFeedback.unshift(record);
  createInternalNotification({ userEmail: record.employeeEmail, title: "Novo feedback de qualidade", body: `${record.theme}: ${record.message}`, type: "QUALIDADE", href: "/qualidade" });
  addAudit(actor, "CRIAÇÃO", "QualityFeedback", record.id, "Pílula enviada", undefined, record);
  return record;
}

export function listEquipment(actor: Actor) {
  const db = getMockDb();
  if (["ADMIN", "GESTOR", "TI"].includes(actor.role)) return db.equipment;
  if (actor.role === "COLABORADOR") return db.equipment.filter((item) => item.employeeEmail === actor.email);
  if (actor.role === "SUPERVISOR") {
    const teamEmails = new Set<string>(db.employees.filter((employee) => employee.supervisor === actor.name).map((employee) => findEmployeeEmailByName(employee.name)).filter(Boolean) as string[]);
    return db.equipment.filter((item) => item.employeeEmail && teamEmails.has(item.employeeEmail));
  }
  return db.equipment;
}

export function createEquipment(actor: Actor, input: { code: string; type: string; employeeId?: string; status: string; impact: string }) {
  const db = getMockDb();
  if (db.equipment.some((item) => item.code === input.code && !["Devolvido", "Perdido", "Bloqueado"].includes(item.status))) {
    return { error: "Código já está vinculado a um equipamento ativo." };
  }

  const employee = input.employeeId ? db.employees.find((item) => item.id === input.employeeId || item.name === input.employeeId) : undefined;
  const record: EquipmentRecord = {
    id: `EQ-${Date.now()}`,
    code: input.code,
    type: input.type,
    employee: employee?.name ?? "Disponível",
    employeeEmail: employee ? findEmployeeEmailByName(employee.name) : undefined,
    status: input.status,
    delivered: employee ? "Hoje" : "-",
    impact: input.impact
  };

  db.equipment.unshift(record);
  if (record.employeeEmail) {
    createInternalNotification({ userEmail: record.employeeEmail, title: "Equipamento atualizado", body: `${record.code} vinculado/atualizado com status ${record.status}.`, type: "EQUIPAMENTO", href: "/equipamentos" });
  }
  addAudit(actor, "ALTERAÇÃO_EQUIPAMENTO", "Equipment", record.code, "Equipamento cadastrado/vinculado", undefined, record);
  return { data: record };
}

export function listEquipmentTickets() {
  return getMockDb().equipmentTickets;
}

export function createEquipmentTicket(actor: Actor, input: { equipmentId: string; title: string; description: string; impact: string }) {
  const db = getMockDb();
  const ticket: EquipmentTicketRecord = {
    code: `#CHM-${Date.now().toString().slice(-4)}`,
    equipmentId: input.equipmentId,
    title: input.title,
    body: input.description,
    status: input.impact,
    age: "Aberto agora"
  };

  db.equipmentTickets.unshift(ticket);
  createInternalNotification({ userEmail: "ti@central.com", title: "Chamado técnico aberto", body: `${ticket.code}: ${ticket.title}`, type: "EQUIPAMENTO", href: "/equipamentos" });
  addAudit(actor, "CRIAÇÃO", "EquipmentTicket", ticket.code, input.description, undefined, ticket);
  return ticket;
}

export function getTokenState(actor: Actor) {
  const db = getMockDb();
  const email = actor.role === "COLABORADOR" ? actor.email : "colaborador@central.com";
  return {
    employeeEmail: email,
    balance: db.tokenBalances[email] ?? 0,
    history: db.tokenHistoryByEmail[email] ?? [],
    rewards: db.rewards
  };
}

export function redeemReward(actor: Actor, input: { employeeId?: string; rewardId: string; cost?: number }) {
  const db = getMockDb();
  const reward = db.rewards.find((item) => item.id === input.rewardId || item.name === input.rewardId);
  if (!reward) return { error: "Recompensa não encontrada." };

  const email = actor.role === "COLABORADOR" ? actor.email : input.employeeId ?? "colaborador@central.com";
  const currentBalance = db.tokenBalances[email] ?? 0;
  const cost = input.cost ?? reward.cost;
  if (currentBalance < cost) return { error: "Saldo insuficiente." };

  db.tokenBalances[email] = currentBalance - cost;
  const transaction = { title: `Resgate ${reward.name}`, amount: `-${cost}`, date: "Agora", type: "Resgate" };
  db.tokenHistoryByEmail[email] = [transaction, ...(db.tokenHistoryByEmail[email] ?? [])];

  const request = createRequest(actor, {
    type: "Resgate de recompensa",
    priority: "Baixa",
    description: `Solicitação de resgate: ${reward.name}`,
    payload: { rewardId: reward.id, cost, employeeEmail: email },
    requester: actor.name
  });
  request.status = "Em análise";
  request.history.unshift({ at: timestamp(), actor: "Sistema", action: "Fluxo de aprovação de tokens iniciado" });
  createInternalNotification({ userEmail: actor.email, title: "Resgate solicitado", body: `${reward.name} enviado para aprovação.`, type: "TOKENS", href: "/tokens" });
  createInternalNotification({ userEmail: "gestor@central.com", title: "Resgate de tokens pendente", body: `${actor.name} solicitou ${reward.name}.`, type: "TOKENS", href: "/esteiras" });

  addAudit(actor, "RESGATE_TOKEN", "RewardRedemption", request.id, `Resgate ${reward.name}`, { balance: currentBalance }, { balance: db.tokenBalances[email] });

  return {
    data: {
      redemptionId: `RR-${Date.now()}`,
      requestId: request.id,
      status: "Solicitado",
      newBalance: db.tokenBalances[email],
      transaction
    }
  };
}

export function listChatMessages(roomId = "equipe-alfa") {
  return getMockDb().chatMessagesByRoom[roomId] ?? [];
}

export function createChatMessage(actor: Actor, input: { roomId: string; content: string }) {
  const db = getMockDb();
  const message = {
    id: `MSG-${Date.now()}`,
    author: actor.name,
    message: input.content,
    time: "Agora",
    self: true
  };
  db.chatMessagesByRoom[input.roomId] = [...(db.chatMessagesByRoom[input.roomId] ?? []), message];
  addAudit(actor, "CRIAÇÃO", "ChatMessage", message.id, "Mensagem enviada");
  return message;
}

export function saveClimateAnswer(actor: Actor, input: { surveyId: string; answers: unknown }) {
  const db = getMockDb();
  const record = { id: `CLA-${Date.now()}`, userEmail: actor.email, surveyId: input.surveyId, answers: input.answers, submittedAt: timestamp() };
  db.climateAnswers.push(record);
  addAudit(actor, "CRIAÇÃO", "ClimateAnswer", record.id, "Resposta de clima registrada", undefined, { surveyId: input.surveyId });
  return record;
}

export function saveAnonymousFeedback(actor: Actor, input: { category: string; message: string; evidenceUrl?: string }) {
  const db = getMockDb();
  const record = {
    id: `AF-${Date.now()}`,
    category: input.category,
    message: input.message,
    status: "Recebido",
    evidenceUrl: input.evidenceUrl,
    createdAt: timestamp()
  };
  db.anonymousFeedback.push(record);
  addAudit(actor, "CRIAÇÃO", "AnonymousFeedback", record.id, "Feedback anônimo recebido", undefined, { category: input.category, identityStored: false });
  return record;
}

export function listAudit(actor: Actor) {
  if (!["ADMIN", "GESTOR"].includes(actor.role)) return [];
  return getMockDb().audit;
}

export function addAudit(actor: Actor, action: string, entity: string, entityId: string, reason: string, before?: unknown, after?: unknown) {
  const db = getMockDb();
  db.audit.unshift({
    id: `AUD-${Date.now()}-${db.audit.length}`,
    dateTime: timestamp(),
    user: actor.name,
    action,
    entity,
    entityId,
    reason,
    before,
    after
  });
}

function validateRegistration(input: Omit<EmployeeRegistrationRecord, "id" | "submittedAt" | "status" | "history" | "createdAt" | "updatedAt">) {
  const errors: string[] = [];
  const requiredFields: Array<keyof typeof input> = [
    "cnpj",
    "fullName",
    "addressType",
    "addressName",
    "addressNumber",
    "neighborhood",
    "city",
    "stateUf",
    "zipCode",
    "primaryPhone",
    "emergencyPhone",
    "emergencyContactName",
    "emergencyContactRelationship",
    "birthDate",
    "email",
    "rg",
    "rgIssuer",
    "cpf",
    "sex",
    "maritalStatus",
    "educationLevel",
    "trainingStartDate",
    "preferredSchedule",
    "bankName",
    "bankAgency",
    "bankAccount",
    "pixKey",
    "pixKeyType"
  ];

  for (const field of requiredFields) {
    if (!String(input[field] ?? "").trim()) errors.push(`${String(field)} obrigatório.`);
  }

  if (!isValidCpf(input.cpf)) errors.push("CPF inválido.");
  if (!isValidCnpj(input.cnpj)) errors.push("CNPJ inválido.");
  if (!/^\d{5}-?\d{3}$/.test(input.zipCode)) errors.push("CEP deve seguir 00000-000.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) errors.push("E-mail inválido.");
  if (!/^\d{2}\s\d{4,5}-?\d{4}$/.test(input.primaryPhone)) errors.push("Contato principal inválido.");
  if (!/^\d{2}\s\d{4,5}-?\d{4}$/.test(input.emergencyPhone)) errors.push("Contato de emergência inválido.");
  if (new Date(input.birthDate) > new Date()) errors.push("Data de nascimento não pode ser futura.");
  if (!input.trainingStartDate) errors.push("Data de início do treinamento obrigatória.");
  if (!["rua", "avenida", "alameda"].includes(input.addressType.toLowerCase())) errors.push("Endereço deve ser rua, avenida ou alameda.");
  if (input.hasChildren && (!input.childrenCount || input.childrenCount < 1)) errors.push("Informe a quantidade de filhos.");

  return errors;
}

function isValidCpf(value: string) {
  const cpf = digits(value);
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  const calc = (factor: number) => {
    let total = 0;
    for (let i = 0; i < factor - 1; i += 1) total += Number(cpf[i]) * (factor - i);
    const digit = (total * 10) % 11;
    return digit === 10 ? 0 : digit;
  };
  return calc(10) === Number(cpf[9]) && calc(11) === Number(cpf[10]);
}

function isValidCnpj(value: string) {
  const cnpj = digits(value);
  return cnpj.length === 14 && !/^(\d)\1+$/.test(cnpj);
}

function defaultOperationalData(record: EmployeeRegistrationRecord): RegistrationOperationalData {
  return {
    wbLogin: `WB${String(3000 + getMockDb().employees.length).padStart(4, "0")}`,
    lob: "CEC",
    team: "Equipe Alfa",
    supervisor: "Carla Supervisora",
    shift: record.preferredSchedule.includes("Noite") ? "Noite" : "Manhã",
    schedule: "6x1",
    roleTitle: "Atendente",
    employeeStatus: "Online",
    contractType: "PJ",
    admissionDate: record.trainingStartDate,
    trainingDate: record.trainingStartDate,
    site: "Remoto",
    internalNotes: "Criado via aprovação cadastral."
  };
}

function shouldImpactAbs(status: string, reason?: string) {
  if (["Falta", "Ausente", "Atraso", "Saída antecipada", "Afastado"].includes(status)) return !/erro de escala|folga|férias|ferias|treinamento/i.test(reason ?? "");
  return false;
}

function shouldImpactCoverage(status: string) {
  return ["Ausente", "Falta", "Atraso", "Saída antecipada", "Afastado", "Sem escala"].includes(status);
}

function statusToEmployeeStatus(status: string) {
  if (status === "Presente") return "Online";
  if (status === "Atraso") return "Em Atendimento";
  if (["Ausente", "Falta", "Afastado"].includes(status)) return "Offline";
  return status;
}

function updateSchedulePresence(employee: { id: string; name: string; email?: string }, date: string, status: string) {
  const db = getMockDb();
  const day = extractDay(date);
  const email = employee.email ?? employeeEmail(employee);
  if (day && email && db.scheduleDaysByEmail[email]) {
    const target = db.scheduleDaysByEmail[email].find((item) => item.date === day && !item.outside);
    if (target) {
      target.label = status;
      target.shift = status;
    }
  }

  const row = db.scheduleGridRows.find((item) => item.employee.id === employee.id);
  if (row && day && day <= row.days.length) {
    row.days[day - 1] = status;
  }
}

function countBy<T extends Record<string, unknown>>(rows: T[], key: keyof T) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const value = String(row[key] ?? "Não informado");
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function sampleRegistration(id: string, fullName: string, email: string, cpf: string): EmployeeRegistrationRecord {
  const now = "23/05/2026 09:05";
  return {
    id,
    submittedAt: now,
    status: "Pendente de Aprovação",
    cnpj: "12.345.678/0001-90",
    fullName,
    addressType: "Rua",
    addressName: "das Operações",
    addressNumber: "120",
    complement: "Apto 42",
    neighborhood: "Centro",
    city: "São Paulo",
    stateUf: "SP",
    zipCode: "01000-000",
    primaryPhone: "11 99999-0000",
    emergencyPhone: "11 98888-0000",
    emergencyContactName: "Contato Familiar",
    emergencyContactRelationship: "Irmã(o)",
    birthDate: "1994-05-20",
    email,
    rg: "MG-1234567",
    rgIssuer: "SSP/SP",
    cpf,
    sex: "Feminino",
    maritalStatus: "Solteiro(a)",
    educationLevel: "Superior cursando",
    trainingStartDate: "2026-06-03",
    preferredSchedule: "Manhã",
    bankName: "Banco Demo",
    bankAgency: "0001-1",
    bankAccount: "12345-6",
    pixKey: email,
    pixKeyType: "E-mail",
    secondaryPixKey: "",
    secondaryPixKeyType: "",
    socialName: "",
    hasChildren: false,
    childrenCount: 0,
    notes: "Cadastro seedado para aprovação.",
    history: [],
    createdAt: now,
    updatedAt: now
  };
}

function employeeEmail(employee: { name: string; wb?: string; email?: string }) {
  return employee.email ?? findEmployeeEmailByName(employee.name) ?? (employee.wb ? `${employee.wb.toLowerCase()}@central.local` : undefined);
}

function maskDocument(value: string) {
  const clean = digits(value);
  if (clean.length <= 4) return "****";
  return `${clean.slice(0, 3)}***${clean.slice(-2)}`;
}

function digits(value: string) {
  return String(value ?? "").replace(/\D/g, "");
}

function formatBrazilianDate(value: string) {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function systemActor(): Actor {
  return { email: "sistema@central.com", name: "Sistema", role: "ADMIN" };
}

function createInitialDb(): MockDb {
  const tokenBalances: Record<string, number> = {};
  const tokenHistoryByEmail: Record<string, TokenTransactionRecord[]> = {};
  const scheduleDaysByEmail: Record<string, ScheduleDayRecord[]> = {};
  const employees = seedEmployees.map((employee) => ({ ...employee, email: findEmployeeEmailByName(employee.name) ?? `${employee.wb.toLowerCase()}@central.local` }));
  const sensitiveDataByEmployeeId = employees.reduce<Record<string, SensitiveEmployeeData>>((acc, employee, index) => {
    acc[employee.id] = {
      employeeId: employee.id,
      cpf: `123.456.78${index % 10}-0${index % 9}`,
      rg: `MG-${String(1234560 + index)}`,
      rgIssuer: "SSP/SP",
      cnpj: "12.345.678/0001-90",
      birthDate: `199${index % 9}-05-${String((index % 24) + 1).padStart(2, "0")}`,
      address: `Rua Operacional, ${100 + index}, Centro, São Paulo/SP, 01000-000`,
      bankData: `Banco Central Demo • Ag 000${index}-1 • CC 12345-${index % 9} • PIX CPF`,
      emergencyContactData: `Contato ${index + 1} (Familiar) • 11 99999-000${index % 10}`,
      familyData: index % 3 === 0 ? "1 filho(a)" : "Sem filhos"
    };
    return acc;
  }, {});

  const attendanceRecords: AttendanceRecord[] = [
    {
      id: "ATT-001",
      employeeId: employees[0].id,
      employeeName: employees[0].name,
      date: "2026-05-23",
      shift: "Manhã",
      status: "Presente",
      hasEvidence: false,
      isJustified: true,
      impactsAbs: false,
      impactsCoverage: false,
      registeredBy: "WFM Operações",
      registeredAt: "23/05/2026 08:02",
      history: [{ at: "23/05/2026 08:02", actor: "WFM Operações", newStatus: "Presente", comment: "Registro automático de presença" }]
    },
    {
      id: "ATT-002",
      employeeId: employees[4].id,
      employeeName: employees[4].name,
      date: "2026-05-23",
      shift: "Manhã",
      status: "Falta",
      absenceReason: "Problema de saúde",
      reasonCategory: "Pessoas",
      supervisorJustification: "Aguardando atestado.",
      hasEvidence: false,
      isJustified: false,
      impactsAbs: true,
      impactsCoverage: true,
      registeredBy: "Carla Supervisora",
      registeredAt: "23/05/2026 09:12",
      history: [{ at: "23/05/2026 09:12", actor: "Carla Supervisora", newStatus: "Falta", comment: "Aguardando documento" }]
    }
  ];

  const registrationRequests: EmployeeRegistrationRecord[] = [
    {
      ...sampleRegistration("CAD-001", "Mariana Rocha", "mariana.rocha@central.com", "456.789.123-40"),
      status: "Pendente de Aprovação",
      history: [{ at: "23/05/2026 09:05", actor: "Mariana Rocha", action: "Cadastro enviado" }]
    },
    {
      ...sampleRegistration("CAD-002", "Pedro Almeida", "pedro.almeida@central.com", "987.654.321-00"),
      status: "Ajuste Solicitado",
      reviewNotes: "Corrigir agência bancária com dígito.",
      history: [
        { at: "23/05/2026 10:22", actor: "Beatriz RH", action: "Ajuste solicitado", notes: "Corrigir agência bancária com dígito." },
        { at: "23/05/2026 08:40", actor: "Pedro Almeida", action: "Cadastro enviado" }
      ]
    }
  ];

  const shiftReports: ShiftReportRecord[] = [
    {
      id: "SRT-001",
      reportDate: "2026-05-23",
      submittedAt: "23/05/2026 14:08",
      shift: "Manhã",
      lob: "CEC",
      operation: "Atendimento",
      supervisor: "Carla Supervisora",
      rta: "WFM Operações",
      importance: "Alta",
      plannedHeadcount: 42,
      actualHeadcount: 39,
      onlineAgents: 37,
      absCount: 3,
      absJustification: "2 atestados em análise e 1 problema técnico.",
      absentEmployees: [{ employeeId: employees[4].id, employeeName: employees[4].name, absenceReason: "Problema de saúde", observation: "Aguardando atestado", impactsAbs: true, impactsCoverage: true }],
      queueStatusStart: "Fila estável, TMA dentro da meta",
      queueStatusEnd: "Fila em atenção por absenteísmo",
      backlogStart: 18,
      backlogEnd: 31,
      latencyStart: "SLA 94%",
      latencyEnd: "SLA 88%",
      occurrenceCategory: "Pessoas",
      impactLevel: "Médio",
      occurrences: "Aumento de ABS no meio do turno e dois atrasos por transporte.",
      pendingTasks: "Validar cobertura do próximo turno e confirmar atestado.",
      generalMood: "Neutro",
      leadersPresent: "Carla Supervisora; WFM Operações",
      mainRisks: "Cobertura do turno da tarde; backlog em CEC.",
      actionsTaken: "Redistribuição de pausas; reforço temporário em fila crítica.",
      nextShiftAttentionPoints: "Monitorar backlog e equipamentos pendentes.",
      requiresFollowUp: true,
      followUpOwner: "WFM Operações",
      followUpDueDate: "2026-05-24",
      followUpStatus: "Aberto",
      additionalComments: "Report seedado para visão executiva."
    }
  ];

  for (const user of demoUsers) {
    tokenBalances[user.email] = user.role === "COLABORADOR" ? 430 : 0;
    tokenHistoryByEmail[user.email] = user.role === "COLABORADOR" ? seedTokenHistory.map((item) => ({ ...item })) : [];
    scheduleDaysByEmail[user.email] = cloneScheduleDays();
  }

  for (const employee of employees) {
    const email = employee.email ?? `${employee.wb.toLowerCase()}@central.local`;
    scheduleDaysByEmail[email] = cloneScheduleDays(employee.shift);
    if (!tokenHistoryByEmail[email]) tokenHistoryByEmail[email] = seedTokenHistory.map((item) => ({ ...item }));
    if (!tokenBalances[email]) tokenBalances[email] = 360 + (employee.name.length % 8) * 25;
  }

  const requests = seedRequests.map<RequestRecord>((request, index) => ({
    id: request.id,
    type: request.type,
    requester: request.requester,
    requesterEmail: findEmployeeEmailByName(request.requester) ?? (index % 2 === 0 ? "colaborador@central.com" : `${request.id.toLowerCase()}@central.local`),
    priority: request.priority as Priority,
    status: officialRequestStatus(request.status),
    area: request.area,
    time: request.time,
    description: `${request.type} aberta para validação operacional.`,
    payload:
      /troca de folga/i.test(request.type)
        ? { internalType: "DAY_OFF_SWAP", dayOffKind: "DAY_OFF_SWAP", currentDayOffDate: "2026-05-04", desiredDayOffDate: "2026-05-06", dataAtual: "2026-05-04", dataDesejada: "2026-05-06", coberturaImpacto: "-1,8pp", scheduleApplicationStatus: "PENDING" }
        : { origem: "seed" },
    history: [
      { at: "23/05/2026 09:15", actor: "Sistema", action: "Solicitação criada" },
      { at: "23/05/2026 09:18", actor: "WFM Operações", action: "Impacto calculado", reason: "Cobertura validada" }
    ],
    comments: [
      { at: "23/05/2026 09:18", author: "WFM Operações", body: "Impacto de cobertura calculado em -1,8pp." },
      { at: "23/05/2026 09:16", author: "Supervisor", body: "Solicitação recebida e em acompanhamento." }
    ]
  }));

  requests.unshift({
    id: "REQ-1001",
    type: "Troca de Folga",
    requester: "João Silva",
    requesterEmail: "colaborador@central.com",
    priority: "Média",
    status: "Aberto",
    area: "WFM",
    time: "Hoje, 08:20",
    description: "Solicito trocar a folga do dia 04/05 para 06/05 por compromisso familiar.",
    payload: { internalType: "DAY_OFF_SWAP", dayOffKind: "DAY_OFF_SWAP", currentDayOffDate: "2026-05-04", desiredDayOffDate: "2026-05-06", dataAtual: "2026-05-04", dataDesejada: "2026-05-06", coberturaImpacto: "-0,9pp", scheduleApplicationStatus: "PENDING" },
    history: [{ at: "23/05/2026 08:20", actor: "João Silva", action: "Solicitação criada" }],
    comments: [{ at: "23/05/2026 08:20", author: "João Silva", body: "Compromisso familiar confirmado." }]
  });

  return {
    employees,
    requests,
    scheduleDaysByEmail,
    scheduleGridRows: seedScheduleGridRows,
    scheduleImports: [
      { id: "IMP-001", fileName: "Cronograma_Maio_2026_v3.xlsx", importedRows: 241, status: "Sucesso", createdAt: "Hoje, 08:45", user: "Admin Central" },
      { id: "IMP-002", fileName: "Cronograma_Maio_2026_v2.xlsx", importedRows: 238, status: "Sucesso", createdAt: "Ontem, 18:12", user: "Admin Central" },
      { id: "IMP-003", fileName: "Cronograma_Maio_2026_v1.xlsx", importedRows: 230, status: "Atenção", createdAt: "21/05/2026", user: "Admin Central" }
    ],
    registrationRequests,
    sensitiveDataByEmployeeId,
    attendanceRecords,
    shiftReports,
    birthdayNotifications: employees.map((employee, index) => ({
      id: `BD-${employee.id}`,
      employeeId: employee.id,
      employeeName: employee.name,
      birthdayDate: sensitiveDataByEmployeeId[employee.id].birthDate,
      month: Number(sensitiveDataByEmployeeId[employee.id].birthDate.slice(5, 7)),
      visibleTo: "RH,Gestão,Supervisor"
    })),
    announcements: seedAnnouncements.map((announcement, index) => ({
      id: `ANN-${String(index + 1).padStart(3, "0")}`,
      ...announcement,
      requiresRead: true,
      readBy: []
    })),
    qualityFeedback: [
      {
        id: "QF-001",
        employee: "João Silva",
        employeeEmail: "colaborador@central.com",
        author: "Ana Qualidade",
        type: "Positivo",
        theme: "Pontualidade e postura",
        quality: "96%",
        status: "Lido",
        message: "Boa aderência ao roteiro e postura colaborativa no turno.",
        createdAt: "22/05/2026 14:10"
      },
      ...seedQualityFeedback.map((feedback, index) => ({
        id: `QF-${String(index + 2).padStart(3, "0")}`,
        ...feedback,
        employeeEmail: findEmployeeEmailByName(feedback.employee) ?? `quality-${index}@central.local`,
        author: "Ana Qualidade",
        createdAt: `23/05/2026 0${Math.max(4, 9 - index)}:15`
      }))
    ],
    equipment: seedEquipmentRows.map((equipment, index) => ({
      id: `EQ-${String(index + 1).padStart(4, "0")}`,
      ...equipment,
      employeeEmail: findEmployeeEmailByName(equipment.employee)
    })),
    equipmentTickets: seedEquipmentTickets.map((ticket, index) => ({
      ...ticket,
      equipmentId: `EQ-${String(index + 1).padStart(4, "0")}`
    })),
    tokenBalances,
    tokenHistoryByEmail,
    rewards: seedRewards.map((reward, index) => ({
      id: `RWD-${String(index + 1).padStart(3, "0")}`,
      name: reward.name,
      cost: reward.cost,
      stock: reward.stock
    })),
    chatMessagesByRoom: {
      "equipe-alfa": seedChatMessages.map((message, index) => ({ id: `MSG-${index + 1}`, ...message }))
    },
    climateAnswers: [],
    anonymousFeedback: [],
    notifications: [
      {
        id: "NOT-001",
        userEmail: "admin@central.com",
        title: "Cadastros pendentes",
        body: "2 cadastros aguardam aprovação de RH/Admin/WFM.",
        type: "CADASTRO",
        href: "/cadastros",
        isRead: false,
        createdAt: "23/05/2026 09:32"
      },
      {
        id: "NOT-002",
        userEmail: "wfm@central.com",
        title: "Ausência sem justificativa",
        body: "Há presença impactando cobertura no turno da manhã.",
        type: "PRESENCA",
        href: "/staff-cobertura",
        isRead: false,
        createdAt: "23/05/2026 09:20"
      },
      {
        id: "NOT-003",
        userEmail: "colaborador@central.com",
        title: "Comunicado publicado",
        body: "Atualização no Plano de Saúde exige confirmação de leitura.",
        type: "COMUNICADO",
        href: "/mural",
        isRead: false,
        createdAt: "23/05/2026 09:15"
      }
    ],
    errorLogs: [
      {
        id: "ERR-001",
        userEmail: "admin@central.com",
        code: "DEMO_UPLOAD_VALIDATION",
        message: "Arquivo de cronograma com 3 linhas inválidas no preview.",
        route: "/api/schedules/import/preview",
        action: "UPLOAD_EXCEL_PREVIEW",
        severity: "WARNING",
        createdAt: "23/05/2026 08:45"
      }
    ],
    storedFiles: [
      {
        id: "FILE-001",
        bucket: "schedule-imports",
        path: "2026/05/Cronograma_Maio_2026_v3.xlsx",
        fileName: "Cronograma_Maio_2026_v3.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: 420000,
        category: "schedule-imports",
        entity: "ScheduleImport",
        entityId: "IMP-001",
        uploadedByEmail: "admin@central.com",
        isSensitive: true,
        createdAt: "23/05/2026 08:45"
      }
    ],
    audit: seedAuditLogs.map((row, index) => ({
      id: `AUD-${index + 1}`,
      dateTime: row[0],
      user: row[1],
      action: row[2],
      entity: row[3],
      entityId: row[4],
      reason: row[5]
    }))
  };
}

function canSeeRequest(actor: Actor, request: RequestRecord) {
  if (["ADMIN", "GESTOR"].includes(actor.role)) return true;
  if (actor.role === "COLABORADOR") return request.requesterEmail === actor.email || request.requester === actor.name;
  if (actor.role === "SUPERVISOR") {
    const employee = seedEmployees.find((item) => item.name === request.requester);
    return request.requesterEmail === actor.email || employee?.supervisor === actor.name;
  }
  if (actor.role === "WFM") return request.area === "WFM" || /(escala|folga|ponto|presença)/i.test(request.type);
  if (actor.role === "TI") return request.area === "TI" || /(equipamento|notebook|computador|acesso|suporte)/i.test(request.type);
  if (actor.role === "QUALIDADE") return request.area === "Qualidade" || /qualidade/i.test(request.type);
  if (actor.role === "RH") return request.area === "RH" || /(rh|clima|anonimo|anônimo|cadastral)/i.test(request.type);
  return false;
}

function firstStepRecipients(request: RequestRecord) {
  const supervisorEmail = supervisorEmailForRequest(request);
  if (isMockDayOff(request) && supervisorEmail) return [supervisorEmail, "admin@central.com"];
  return recipientsForArea(request.area);
}

function supervisorEmailForRequest(request: RequestRecord) {
  const employee = seedEmployees.find((item) => item.name === request.requester || employeeEmail(item) === request.requesterEmail);
  if (!employee?.supervisor) return null;
  const supervisor = seedEmployees.find((item) => item.name === employee.supervisor);
  return supervisor ? employeeEmail(supervisor) ?? "supervisor@central.com" : "supervisor@central.com";
}

function resolveMockTransition(actor: Actor, record: RequestRecord, status: RequestStatus) {
  const isRequester = record.requesterEmail === actor.email || record.requester === actor.name;
  const isSupervisor = actor.role === "SUPERVISOR";
  const isFinalApprover = ["ADMIN", "GESTOR", "WFM"].includes(actor.role);
  const isSupervisorStep = ["ADMIN", "GESTOR", "SUPERVISOR"].includes(actor.role);

  if (actor.role === "COLABORADOR") {
    if (status === "Cancelado" && isRequester && record.status === "Aberto") {
      return {
        nextStatus: "Cancelado" as RequestStatus,
        applySchedule: false,
        historyAction: "Cancelamento",
        auditAction: "CANCELAMENTO",
        requesterTitle: "Solicitação cancelada",
        requesterBody: () => `${record.id} foi cancelada.`
      };
    }
    return "FORBIDDEN" as const;
  }

  if (status === "Aprovado") {
    if (record.status === "Aberto") {
      if (!isSupervisorStep || (isSupervisor && !canSeeRequest(actor, record))) return "FORBIDDEN" as const;
      return {
        nextStatus: "Em análise" as RequestStatus,
        applySchedule: false,
        historyAction: "Aprovação do supervisor",
        auditAction: "APROVACAO_SUPERVISOR",
        requesterTitle: "Solicitação encaminhada ao WFM",
        requesterBody: () => "Seu supervisor aprovou a primeira etapa. A solicitação está em análise pelo WFM.",
        notifyWfm: true
      };
    }
    if (record.status === "Em análise") {
      if (!isFinalApprover) return "FORBIDDEN" as const;
      return {
        nextStatus: "Aprovado" as RequestStatus,
        applySchedule: isMockDayOff(record),
        historyAction: "Aprovação final WFM",
        auditAction: "APROVACAO_FINAL_WFM",
        requesterTitle: `${record.type} aprovada`,
        requesterBody: () => mockNotificationBody(record, "Aprovado"),
        notifySupervisor: true
      };
    }
    return { error: "Esta solicitação não pode ser aprovada neste status." };
  }

  if (status === "Recusado") {
    if (record.status === "Aberto" && !isSupervisorStep && !isFinalApprover) return "FORBIDDEN" as const;
    if (record.status === "Em análise" && !isFinalApprover) return "FORBIDDEN" as const;
    return {
      nextStatus: "Recusado" as RequestStatus,
      applySchedule: false,
      historyAction: record.status === "Em análise" ? "Recusa WFM" : "Recusa do supervisor",
      auditAction: record.status === "Em análise" ? "RECUSA_WFM" : "RECUSA_SUPERVISOR",
      requesterTitle: "Sua solicitação de folga foi recusada",
      requesterBody: (reason?: string) => mockNotificationBody(record, "Recusado", reason),
      notifySupervisor: record.status === "Em análise"
    };
  }

  if (status === "Concluído") {
    if (record.status !== "Aprovado" || !isFinalApprover) return "FORBIDDEN" as const;
    return {
      nextStatus: "Concluído" as RequestStatus,
      applySchedule: false,
      historyAction: "Conclusão administrativa",
      auditAction: "CONCLUSAO",
      requesterTitle: "Solicitação concluída",
      requesterBody: () => `${record.id} foi concluída administrativamente.`
    };
  }

  if (status === "Cancelado") {
    if (!isFinalApprover && !(isRequester && record.status === "Aberto")) return "FORBIDDEN" as const;
    if (!["Aberto", "Em análise"].includes(record.status)) return { error: "Esta solicitação não pode mais ser cancelada." };
    return {
      nextStatus: "Cancelado" as RequestStatus,
      applySchedule: false,
      historyAction: "Cancelamento",
      auditAction: "CANCELAMENTO",
      requesterTitle: "Solicitação cancelada",
      requesterBody: () => `${record.id} foi cancelada.`,
      notifySupervisor: record.status === "Em análise"
    };
  }

  if (status === "Em análise" && record.status === "Aberto" && isSupervisorStep) {
    return {
      nextStatus: "Em análise" as RequestStatus,
      applySchedule: false,
      historyAction: "Aprovação do supervisor",
      auditAction: "APROVACAO_SUPERVISOR",
      requesterTitle: "Solicitação encaminhada ao WFM",
      requesterBody: () => "Seu supervisor aprovou a primeira etapa. A solicitação está em análise pelo WFM.",
      notifyWfm: true
    };
  }

  return { error: "Transição de status não permitida." };
}

function officialRequestStatus(value: string): RequestStatus {
  if (value === "Pendente") return "Aberto";
  if (value === "Aguardando aprovação" || value === "Ajuste solicitado") return "Em análise";
  if (value === "Finalizado") return "Concluído";
  if (["Aberto", "Em análise", "Aprovado", "Recusado", "Concluído", "Cancelado"].includes(value)) return value as RequestStatus;
  return "Aberto";
}

function isMockDayOff(request: RequestRecord) {
  return /troca de folga|venda de folga|dia de folga/i.test(request.type) || ["DAY_OFF_SWAP", "DAY_OFF_SELL", "DAY_OFF_REQUEST"].includes(String(request.payload.dayOffKind ?? request.payload.internalType ?? ""));
}

function mockDayOffKind(request: RequestRecord) {
  const raw = String(request.payload.dayOffKind ?? request.payload.internalType ?? "");
  if (raw === "DAY_OFF_SELL" || /venda de folga/i.test(request.type)) return "DAY_OFF_SELL";
  if (raw === "DAY_OFF_REQUEST" || /dia de folga/i.test(request.type)) return "DAY_OFF_REQUEST";
  return "DAY_OFF_SWAP";
}

function applyMockDayOffToSchedule(request: RequestRecord, actor: Actor, actionInput?: { finalApprovedShift?: string; finalApprovedStartTime?: string; finalApprovedEndTime?: string }) {
  const db = getMockDb();
  const email = request.requesterEmail;
  const days = db.scheduleDaysByEmail[email] ?? cloneScheduleDays();
  const employee = db.employees.find((item) => employeeEmail(item) === email || item.name === request.requester);
  const row = employee ? db.scheduleGridRows.find((item) => item.employee.id === employee.id) : undefined;
  const kind = mockDayOffKind(request);

  if (kind === "DAY_OFF_SWAP") {
    const currentDay = extractDay(request.payload.currentDayOffDate ?? request.payload.dataAtual ?? request.payload.currentDate);
    const desiredDay = extractDay(request.payload.desiredDayOffDate ?? request.payload.dataDesejada ?? request.payload.desiredDate);
    if (!currentDay || !desiredDay) return false;

    const current = days.find((day) => day.date === currentDay && !day.outside);
    const desired = days.find((day) => day.date === desiredDay && !day.outside);
    if (!current || !desired || current.shift !== "Folga" || desired.shift === "Folga") return false;

    const before = { current: { ...current }, desired: { ...desired } };
    const desiredShift = desired.shift;
    current.shift = desiredShift;
    current.label = desiredShift;
    desired.shift = "Folga";
    desired.label = "Folga";
    if (row) {
      if (currentDay <= row.days.length) row.days[currentDay - 1] = desiredShift;
      if (desiredDay <= row.days.length) row.days[desiredDay - 1] = "Folga";
    }
    db.scheduleDaysByEmail[email] = days;
    request.payload.scheduleAppliedAt = timestamp();
    request.payload.scheduleApplicationStatus = "APPLIED";
    addAudit(actor, "ALTERAÇÃO_ESCALA", "Schedule", email, `Troca de folga ${currentDay} -> ${desiredDay}`, before, { current, desired });
    return true;
  }

  if (kind === "DAY_OFF_SELL") {
    const dayNumber = extractDay(request.payload.dayOffToSellDate);
    if (!dayNumber) return false;
    const target = days.find((day) => day.date === dayNumber && !day.outside);
    if (!target || target.shift !== "Folga") return false;
    const shift = String(actionInput?.finalApprovedShift ?? request.payload.finalApprovedShift ?? request.payload.availabilityShift ?? employee?.shift ?? "Manhã");
    const before = { ...target };
    target.shift = shift;
    target.label = "Venda aprovada";
    request.payload.finalApprovedShift = shift;
    request.payload.finalApprovedStartTime = actionInput?.finalApprovedStartTime ?? request.payload.preferredStartTime ?? null;
    request.payload.finalApprovedEndTime = actionInput?.finalApprovedEndTime ?? request.payload.preferredEndTime ?? null;
    if (row && dayNumber <= row.days.length) row.days[dayNumber - 1] = "Venda aprovada";
    db.scheduleDaysByEmail[email] = days;
    request.payload.scheduleAppliedAt = timestamp();
    request.payload.scheduleApplicationStatus = "APPLIED";
    addAudit(actor, "ALTERAÇÃO_ESCALA", "Schedule", email, `Venda de folga em ${dayNumber}`, before, target);
    return true;
  }

  const requestedDay = extractDay(request.payload.desiredDayOffRequestDate ?? request.payload.desiredDayOffDate ?? request.payload.requestedDate);
  if (!requestedDay) return false;
  const target = days.find((day) => day.date === requestedDay && !day.outside);
  if (!target || target.shift === "Folga") return false;
  const before = { ...target };
  target.shift = "Folga";
  target.label = "Folga";
  if (row && requestedDay <= row.days.length) row.days[requestedDay - 1] = "Folga";
  db.scheduleDaysByEmail[email] = days;
  request.payload.scheduleAppliedAt = timestamp();
  request.payload.scheduleApplicationStatus = "APPLIED";
  addAudit(actor, "ALTERAÇÃO_ESCALA", "Schedule", email, `Dia de folga aprovado em ${requestedDay}`, before, target);
  return true;
}

function mockNotificationBody(record: RequestRecord, status: RequestStatus, reason?: string) {
  if (isMockDayOff(record) && status === "Aprovado") {
    if (mockDayOffKind(record) === "DAY_OFF_SELL") return "Sua venda de folga foi aprovada e seu cronograma foi atualizado.";
    if (mockDayOffKind(record) === "DAY_OFF_REQUEST") return "Sua solicitação de folga foi aprovada e seu cronograma foi atualizado.";
    return "Sua troca de folga foi aprovada e seu cronograma foi atualizado.";
  }
  if (isMockDayOff(record) && status === "Recusado") return reason ? `Sua solicitação de folga foi recusada. Motivo: ${reason}` : "Sua solicitação de folga foi recusada.";
  return reason ?? `${record.type} atualizada para ${status}.`;
}

function areaForRequest(type: string) {
  if (/(equipamento|notebook|computador|acesso|suporte)/i.test(type)) return "TI";
  if (/(rh|benefício|beneficio|clima|cadastral)/i.test(type)) return "RH";
  if (/qualidade/i.test(type)) return "Qualidade";
  if (/(operação|operacao)/i.test(type)) return "Operações";
  return "WFM";
}

function classificationLabel(classification: "POSITIVO" | "ATENCAO" | "CRITICO") {
  if (classification === "CRITICO") return "Crítico";
  if (classification === "ATENCAO") return "Atenção";
  return "Positivo";
}

function extractDay(value: unknown) {
  if (!value) return null;
  const text = String(value);
  const match = text.match(/\d{4}-\d{2}-(\d{2})/) ?? text.match(/(\d{1,2})\/\d{1,2}\/\d{4}/) ?? text.match(/^(\d{1,2})$/);
  return match ? Number(match[1]) : null;
}

function cloneScheduleDays(preferredShift?: string) {
  return seedScheduleDays.map((day) => ({
    ...day,
    shift: day.shift !== "Folga" && preferredShift ? preferredShift : day.shift,
    label: day.shift !== "Folga" && preferredShift ? preferredShift : day.label
  }));
}

function findEmployeeEmailByName(name: string) {
  const demo = demoUsers.find((user) => user.name === name);
  if (demo) return demo.email;

  if (name === "Carla Supervisora") return "supervisor@central.com";
  if (name === "WFM Operações") return "wfm@central.com";
  return undefined;
}

function employeeEmailFromEmployee(employee: { email?: string; name: string; wb?: string }) {
  return employee.email ?? findEmployeeEmailByName(employee.name) ?? (employee.wb ? `${employee.wb.toLowerCase()}@central.local` : undefined);
}

function recipientsForArea(area: string) {
  if (/TI/i.test(area)) return ["ti@central.com"];
  if (/RH/i.test(area)) return ["rh@central.com"];
  if (/Qualidade/i.test(area)) return ["qualidade@central.com"];
  if (/WFM/i.test(area)) return ["wfm@central.com"];
  return ["gestor@central.com", "admin@central.com"];
}

function timestamp() {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date());
}
