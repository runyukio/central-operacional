"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Wrench } from "lucide-react";
import { TopActions } from "@/components/layout/app-shell";
import { EmptyState, MetricPill, PageHeader, Panel, SimpleTable, StatusBadge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { cleanShiftName, isBlockedShiftName, isSelectableShiftName } from "@/lib/shift-display";
import { FormInput, SystemSettings, apiJson, currentOperationalMonthInput, displaySystemRole } from './shared';
export function SettingsPage() {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [settingsError, setSettingsError] = useState(false);
  const adminSections = ["Usuários", "Perfis", "LOBs", "Times", "Supervisores", "Turnos", "Cargos/Funções", "Skills", "Tipos de solicitação", "SLAs", "Regras de aprovação", "Regras de cobertura", "Regras de tokens", "Configurações gerais"];
  const [activeSection, setActiveSection] = useState(adminSections[0]);
  const [userDraft, setUserDraft] = useState({ id: "", name: "", email: "", roleName: "COLABORADOR", status: "ACTIVE", employeeId: "", password: "" });
  const [roleDraft, setRoleDraft] = useState({ id: "", name: "", label: "", description: "", status: "ACTIVE" as "ACTIVE" | "INACTIVE" });
  const [lobDraft, setLobDraft] = useState({ id: "", name: "", description: "" });
  const [teamDraft, setTeamDraft] = useState({ id: "", name: "", lobId: "", supervisorId: "", status: "ACTIVE" as "ACTIVE" | "INACTIVE" });
  const [supervisorDraft, setSupervisorDraft] = useState({ supervisorId: "", teamId: "", employeeId: "" });
  const [shiftDraft, setShiftDraft] = useState({ id: "", name: "", startsAt: "08:00", endsAt: "16:00", color: "#2563EB" });
  const [requestTypeDraft, setRequestTypeDraft] = useState({ id: "", name: "", area: "Operação", slaHours: "24", requiresApproval: true, status: "ACTIVE" as "ACTIVE" | "INACTIVE" });
  const [roleTitleDraft, setRoleTitleDraft] = useState({ previousName: "", name: "", status: "ACTIVE" as "ACTIVE" | "INACTIVE" });
  const [skillConfigDraft, setSkillConfigDraft] = useState({ id: "", name: "", description: "", color: "#2563EB", status: "ACTIVE" as "ACTIVE" | "INACTIVE" });
  const [ruleDraft, setRuleDraft] = useState({ id: "", name: "", requestType: "", priority: "Média", hours: "24", role: "WFM", lob: "ALL", shift: "", staffRequired: "1", points: "1", status: "ACTIVE" as "ACTIVE" | "INACTIVE" });
  const [generalDraft, setGeneralDraft] = useState<Record<string, unknown>>({});
  const [defaultMonthDraft, setDefaultMonthDraft] = useState(() => currentOperationalMonthInput());
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    void loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const payload = await apiJson<{ data: SystemSettings }>("/api/settings");
      setSettings(payload.data);
      setDefaultMonthDraft(payload.data.defaultMonth);
      setGeneralDraft(payload.data.generalSettings ?? {});
    } catch (error) {
      setSettingsError(true);
      setSettingsMessage(error instanceof Error ? error.message : "Não foi possível carregar configurações.");
    }
  }

  async function saveSetting(body: Record<string, unknown>, success: string) {
    setSavingSettings(true);
    setSettingsMessage("");
    try {
      await apiJson<{ success: boolean }>("/api/settings", { method: "POST", body: JSON.stringify(body) });
      setSettingsError(false);
      setSettingsMessage(success);
      setLobDraft({ id: "", name: "", description: "" });
      setTeamDraft({ id: "", name: "", lobId: "", supervisorId: "", status: "ACTIVE" });
      setSupervisorDraft({ supervisorId: "", teamId: "", employeeId: "" });
      setShiftDraft({ id: "", name: "", startsAt: "08:00", endsAt: "16:00", color: "#2563EB" });
      setRoleTitleDraft({ previousName: "", name: "", status: "ACTIVE" });
      setSkillConfigDraft({ id: "", name: "", description: "", color: "#2563EB", status: "ACTIVE" });
      setRequestTypeDraft({ id: "", name: "", area: "Operação", slaHours: "24", requiresApproval: true, status: "ACTIVE" });
      setUserDraft({ id: "", name: "", email: "", roleName: "COLABORADOR", status: "ACTIVE", employeeId: "", password: "" });
      setRuleDraft({ id: "", name: "", requestType: "", priority: "Média", hours: "24", role: "WFM", lob: "ALL", shift: "", staffRequired: "1", points: "1", status: "ACTIVE" });
      await loadSettings();
    } catch (error) {
      setSettingsError(true);
      setSettingsMessage(error instanceof Error ? error.message : "Não foi possível salvar configuração.");
    } finally {
      setSavingSettings(false);
    }
  }

  const activeLobs = settings?.lobs.filter((lob) => lob.status !== "INACTIVE").length ?? 0;
  const activeShifts = settings?.shifts.filter((shift) => shift.status !== "INACTIVE" && isSelectableShiftName(shift.name)).length ?? 0;
  const activeTitles = settings?.roleTitles.filter((title) => title.status !== "INACTIVE").length ?? 0;
  const activeTeams = settings?.teams?.filter((team) => team.status !== "INACTIVE").length ?? 0;
  const roleOptions = settings?.roles.filter((role) => role.status !== "INACTIVE").map((role) => role.name) ?? [
    "ADMIN",
    "GESTOR",
    "SUPERVISOR",
    "COLABORADOR",
    "WFM",
    "QUALIDADE",
    "RH",
    "FINANCEIRO",
    "TI",
    "RTA",
    "POC",
    "CLIENT"
  ];
  const lobOptions = settings?.lobs.filter((lob) => lob.status !== "INACTIVE") ?? [];
  const supervisorOptions = settings?.supervisors ?? [];
  const employeeOptionsForSettings = settings?.employees ?? [];
  const teamOptions = settings?.teams ?? [];

  function statusButtonLabel(status?: string) {
    return status === "INACTIVE" ? "Ativar" : "Inativar";
  }

  function editRule(kind: "slaRule" | "approvalRule" | "coverageRule" | "tokenRule", item: Record<string, unknown>) {
    setRuleDraft({
      id: String(item.id ?? ""),
      name: String(item.name ?? ""),
      requestType: String(item.requestType ?? item.typeName ?? ""),
      priority: String(item.priority ?? "Média"),
      hours: String(item.hours ?? item.slaHours ?? "24"),
      role: String(item.role ?? item.approverRole ?? "WFM"),
      lob: String(item.lob ?? "ALL"),
      shift: String(item.shift ?? ""),
      staffRequired: String(item.staffRequired ?? "1"),
      points: String(item.points ?? "1"),
      status: item.status === "INACTIVE" ? "INACTIVE" : "ACTIVE"
    });
    if (kind === "slaRule") setActiveSection("SLAs");
    if (kind === "approvalRule") setActiveSection("Regras de aprovação");
    if (kind === "coverageRule") setActiveSection("Regras de cobertura");
    if (kind === "tokenRule") setActiveSection("Regras de tokens");
  }

  function rulePanel(title: string, kind: "slaRule" | "approvalRule" | "coverageRule" | "tokenRule", items: Array<Record<string, unknown> & { id: string; name: string; status: "ACTIVE" | "INACTIVE" }>) {
    const isSla = kind === "slaRule";
    const isApproval = kind === "approvalRule";
    const isCoverage = kind === "coverageRule";
    return (
      <Panel title={title}>
        <div className="mb-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <input value={ruleDraft.name} onChange={(event) => setRuleDraft({ ...ruleDraft, name: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Nome da regra" />
          <input value={ruleDraft.requestType} onChange={(event) => setRuleDraft({ ...ruleDraft, requestType: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder={isCoverage ? "Dia/período" : "Tipo de solicitação/evento"} />
          <input value={isSla ? ruleDraft.hours : isCoverage ? ruleDraft.staffRequired : kind === "tokenRule" ? ruleDraft.points : ruleDraft.role} onChange={(event) => setRuleDraft({ ...ruleDraft, [isSla ? "hours" : isCoverage ? "staffRequired" : kind === "tokenRule" ? "points" : "role"]: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder={isSla ? "Prazo horas" : isCoverage ? "Staff necessário" : kind === "tokenRule" ? "Pontos" : "Role aprovadora"} />
          <select value={ruleDraft.lob} onChange={(event) => setRuleDraft({ ...ruleDraft, lob: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">
            {["ALL", ...lobOptions.map((lob) => lob.name).filter((name) => name !== "ALL")].map((name) => <option key={name}>{name}</option>)}
          </select>
          <select value={ruleDraft.status} onChange={(event) => setRuleDraft({ ...ruleDraft, status: event.target.value as "ACTIVE" | "INACTIVE" })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">
            <option value="ACTIVE">Ativo</option>
            <option value="INACTIVE">Inativo</option>
          </select>
          <button disabled={savingSettings} onClick={() => void saveSetting({ type: kind, ...ruleDraft, slaHours: Number(ruleDraft.hours), staffRequired: Number(ruleDraft.staffRequired), points: Number(ruleDraft.points), approverRole: ruleDraft.role, appliesScheduleChange: isApproval && ruleDraft.role === "WFM" }, ruleDraft.id ? "Regra atualizada." : "Regra criada.")} className="rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-60">
            {ruleDraft.id ? "Salvar regra" : "Criar regra"}
          </button>
        </div>
        {items.length ? (
          <SimpleTable
            columns={["Nome", isSla ? "Prazo" : isCoverage ? "Staff" : kind === "tokenRule" ? "Pontos" : "Role", "LOB", "Status", "Ações"]}
            rows={items.map((item) => [
              item.name,
              isSla ? `${String(item.slaHours ?? item.hours ?? "-")}h` : isCoverage ? String(item.staffRequired ?? "-") : kind === "tokenRule" ? String(item.points ?? "-") : String(item.approverRole ?? item.role ?? "-"),
              String(item.lob ?? "ALL"),
              <StatusBadge key={`${item.id}-status`} status={item.status === "INACTIVE" ? "Inativo" : "Ativo"} />,
              <div key={`${item.id}-actions`} className="flex flex-wrap gap-2">
                <button onClick={() => editRule(kind, item)} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">Editar</button>
                <button onClick={() => void saveSetting({ type: kind, ...item, status: item.status === "INACTIVE" ? "ACTIVE" : "INACTIVE" }, "Status da regra atualizado.")} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">{statusButtonLabel(item.status)}</button>
              </div>
            ])}
          />
        ) : <EmptyState title="Nenhuma regra cadastrada" description="Crie regras para parametrizar fluxos sem alterar código." />}
      </Panel>
    );
  }

  return (
    <div>
      <PageHeader title="Configurações" description="Administre usuários, roles, regras e parâmetros do sistema." icon={Wrench} actions={<TopActions />} />
      {settingsMessage ? (
        <div className={cn("mb-5 rounded-lg border px-4 py-3 text-sm font-bold", settingsError ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700")}>
          {settingsMessage}
        </div>
      ) : null}
      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Panel title="Módulos administrativos">
          {adminSections.map((section) => (
            <button key={section} onClick={() => setActiveSection(section)} className={cn("mb-2 flex w-full items-center justify-between rounded-lg px-4 py-3 text-left text-sm font-bold last:mb-0", activeSection === section ? "bg-blue-50 text-blue-700" : "hover:bg-slate-50")}>
              {section}
              <ChevronRight className="h-4 w-4" />
            </button>
          ))}
        </Panel>
        <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-4">
            <MetricPill value={activeLobs} label="LOBs ativas" />
            <MetricPill value={activeShifts} label="Turnos ativos" />
            <MetricPill value={activeTitles} label="Cargos ativos" />
            <MetricPill value={activeTeams} label="Times ativos" />
          </div>

          {activeSection === "Usuários" ? (
            <Panel title="Usuários">
              <div className="mb-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                <input value={userDraft.name} onChange={(event) => setUserDraft({ ...userDraft, name: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Nome" />
                <input value={userDraft.email} onChange={(event) => setUserDraft({ ...userDraft, email: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="E-mail" />
                <select value={userDraft.roleName} onChange={(event) => setUserDraft({ ...userDraft, roleName: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">{roleOptions.map((role) => <option key={role} value={role}>{displaySystemRole(role)}</option>)}</select>
                <select value={userDraft.employeeId} onChange={(event) => setUserDraft({ ...userDraft, employeeId: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none">
                  <option value="">Sem vínculo</option>
                  {employeeOptionsForSettings.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} - {employee.email || employee.wb || employee.id}</option>)}
                </select>
                <input value={userDraft.password} onChange={(event) => setUserDraft({ ...userDraft, password: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Senha temp/reset" type="password" />
                <button disabled={savingSettings} onClick={() => void saveSetting({ type: "user", ...userDraft }, userDraft.id ? "Usuário atualizado." : "Usuário criado.")} className="rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-60">{userDraft.id ? "Salvar" : "Criar"}</button>
              </div>
              {settings?.users?.length ? <SimpleTable columns={["Nome", "E-mail", "Role", "Status", "Vínculo", "Ações"]} rows={settings.users.map((user) => [
                user.name,
                user.email,
                displaySystemRole(user.roleName),
                <StatusBadge key={`${user.id}-status`} status={user.status === "ACTIVE" ? "Ativo" : "Inativo"} />,
                user.employeeName || "-",
                <div key={`${user.id}-actions`} className="flex flex-wrap gap-2">
                  <button onClick={() => setUserDraft({ id: user.id, name: user.name, email: user.email, roleName: user.roleName, status: user.status, employeeId: user.employeeId ?? "", password: "" })} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">Editar</button>
                  <button onClick={() => void saveSetting({ type: "user", id: user.id, name: user.name, email: user.email, roleName: user.roleName, employeeId: user.employeeId, status: user.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }, "Status do usuário atualizado.")} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">{user.status === "ACTIVE" ? "Inativar" : "Ativar"}</button>
                </div>
              ])} /> : <EmptyState title="Nenhum usuário" description="Crie usuários reais para acessar a plataforma." />}
            </Panel>
          ) : null}

          {activeSection === "Perfis" ? (
            <Panel title="Perfis/Roles">
              <div className="mb-4 grid gap-3 md:grid-cols-[1fr_1fr_1fr_120px_auto]">
                <input value={roleDraft.name} onChange={(event) => setRoleDraft({ ...roleDraft, name: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Role interna" />
                <input value={roleDraft.label} onChange={(event) => setRoleDraft({ ...roleDraft, label: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Label" />
                <input value={roleDraft.description} onChange={(event) => setRoleDraft({ ...roleDraft, description: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Descrição" />
                <select value={roleDraft.status} onChange={(event) => setRoleDraft({ ...roleDraft, status: event.target.value as "ACTIVE" | "INACTIVE" })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold"><option value="ACTIVE">Ativo</option><option value="INACTIVE">Inativo</option></select>
                <button disabled={savingSettings || !roleDraft.id} onClick={() => void saveSetting({ type: "role", ...roleDraft }, "Perfil atualizado.")} className="rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-60">Salvar</button>
              </div>
              <SimpleTable columns={["Role", "Label", "Essencial", "Status", "Ações"]} rows={(settings?.roles ?? []).map((role) => [
                displaySystemRole(role.name),
                role.label,
                role.essential ? "Sim" : "Não",
                <StatusBadge key={`${role.id}-status`} status={role.status === "INACTIVE" ? "Inativo" : "Ativo"} />,
                <button key={`${role.id}-edit`} onClick={() => setRoleDraft({ id: role.id, name: role.name, label: role.label, description: role.description ?? "", status: role.status ?? "ACTIVE" })} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">Editar</button>
              ])} />
            </Panel>
          ) : null}

          {activeSection === "LOBs" ? <Panel title="LOBs">
            <div className="mb-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <input value={lobDraft.name} onChange={(event) => setLobDraft({ ...lobDraft, name: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Nome da LOB" />
              <input value={lobDraft.description} onChange={(event) => setLobDraft({ ...lobDraft, description: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Descrição" />
              <button disabled={savingSettings} onClick={() => void saveSetting({ type: "lob", ...lobDraft, status: "ACTIVE" }, lobDraft.id ? "LOB atualizada." : "LOB criada.")} className="rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-60">
                {lobDraft.id ? "Salvar LOB" : "Criar LOB"}
              </button>
            </div>
            {settings?.lobs.length ? (
              <SimpleTable
                columns={["Nome", "Descrição", "Status", "Ações"]}
                rows={settings.lobs.map((lob) => [
                  lob.name,
                  lob.description || "-",
                  <StatusBadge key={`${lob.id}-status`} status={lob.status === "INACTIVE" ? "Inativo" : "Ativo"} />,
                  <div key={`${lob.id}-actions`} className="flex flex-wrap gap-2">
                    <button onClick={() => setLobDraft({ id: lob.id, name: lob.name, description: lob.description ?? "" })} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">Editar</button>
                    <button onClick={() => void saveSetting({ type: "lob", id: lob.id, name: lob.name, description: lob.description, status: lob.status === "INACTIVE" ? "ACTIVE" : "INACTIVE" }, "Status da LOB atualizado.")} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">
                      {lob.status === "INACTIVE" ? "Ativar" : "Inativar"}
                    </button>
                  </div>
                ])}
              />
            ) : <EmptyState title="Nenhuma LOB cadastrada" description="Crie uma LOB para alimentar filtros, cadastros e cronograma." />}
          </Panel> : null}

          {activeSection === "Times" ? (
            <Panel title="Times">
              <div className="mb-4 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
                <input value={teamDraft.name} onChange={(event) => setTeamDraft({ ...teamDraft, name: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Nome do time" />
                <select value={teamDraft.lobId} onChange={(event) => setTeamDraft({ ...teamDraft, lobId: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none"><option value="">LOB</option>{lobOptions.map((lob) => <option key={lob.id} value={lob.id}>{lob.name}</option>)}</select>
                <select value={teamDraft.supervisorId} onChange={(event) => setTeamDraft({ ...teamDraft, supervisorId: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none"><option value="">Sem supervisor</option>{supervisorOptions.map((supervisor) => <option key={supervisor.id} value={supervisor.id}>{supervisor.name} - {supervisor.email}</option>)}</select>
                <button disabled={savingSettings} onClick={() => void saveSetting({ type: "team", ...teamDraft }, teamDraft.id ? "Time atualizado." : "Time criado.")} className="rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-60">{teamDraft.id ? "Salvar" : "Criar"}</button>
              </div>
              {teamOptions.length ? <SimpleTable columns={["Time", "LOB", "Supervisor", "Status", "Ações"]} rows={teamOptions.map((team) => [
                team.name,
                team.lob,
                team.supervisorName || "-",
                <StatusBadge key={`${team.id}-status`} status={team.status === "INACTIVE" ? "Inativo" : "Ativo"} />,
                <div key={`${team.id}-actions`} className="flex flex-wrap gap-2">
                  <button onClick={() => setTeamDraft({ id: team.id, name: team.name, lobId: team.lobId, supervisorId: team.supervisorId ?? "", status: team.status })} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">Editar</button>
                  <button onClick={() => void saveSetting({ type: "team", id: team.id, name: team.name, lobId: team.lobId, supervisorId: team.supervisorId, status: team.status === "INACTIVE" ? "ACTIVE" : "INACTIVE" }, "Status do time atualizado.")} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">{statusButtonLabel(team.status)}</button>
                </div>
              ])} /> : <EmptyState title="Nenhum time" description="Crie times para supervisão, filtros e esteiras." />}
            </Panel>
          ) : null}

          {activeSection === "Supervisores" ? (
            <Panel title="Supervisores">
              <div className="mb-4 grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto]">
                <select value={supervisorDraft.supervisorId} onChange={(event) => setSupervisorDraft({ ...supervisorDraft, supervisorId: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none"><option value="">Supervisor</option>{supervisorOptions.map((supervisor) => <option key={supervisor.id} value={supervisor.id}>{supervisor.name} - {supervisor.email}</option>)}</select>
                <select value={supervisorDraft.teamId} onChange={(event) => setSupervisorDraft({ ...supervisorDraft, teamId: event.target.value, employeeId: "" })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none"><option value="">Vincular time</option>{teamOptions.map((team) => <option key={team.id} value={team.id}>{team.name} - {team.lob}</option>)}</select>
                <select value={supervisorDraft.employeeId} onChange={(event) => setSupervisorDraft({ ...supervisorDraft, employeeId: event.target.value, teamId: "" })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none"><option value="">Vincular parceiro</option>{employeeOptionsForSettings.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} - {employee.email || employee.wb}</option>)}</select>
                <button disabled={savingSettings} onClick={() => void saveSetting({ type: "supervisor", ...supervisorDraft }, "Vínculo de supervisão atualizado.")} className="rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-60">Salvar vínculo</button>
              </div>
              {supervisorOptions.length ? <SimpleTable columns={["Supervisor", "E-mail", "LOB", "Time", "Agentes", "Status"]} rows={supervisorOptions.map((supervisor) => [
                supervisor.name,
                supervisor.email || "-",
                supervisor.lob || "-",
                supervisor.team || "-",
                String(supervisor.supervisees ?? 0),
                supervisor.status || "Ativo"
              ])} /> : <EmptyState title="Nenhum supervisor" description="Atribua role SUPERVISOR a um usuário para aparecer aqui." />}
            </Panel>
          ) : null}

          {activeSection === "Turnos" ? <Panel title="Turnos">
            <div className="mb-4 grid gap-3 md:grid-cols-[1fr_120px_120px_110px_auto]">
              <input value={shiftDraft.name} onChange={(event) => setShiftDraft({ ...shiftDraft, name: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Nome do turno" />
              <input value={shiftDraft.startsAt} onChange={(event) => setShiftDraft({ ...shiftDraft, startsAt: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Entrada" />
              <input value={shiftDraft.endsAt} onChange={(event) => setShiftDraft({ ...shiftDraft, endsAt: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Saída" />
              <input type="color" value={shiftDraft.color} onChange={(event) => setShiftDraft({ ...shiftDraft, color: event.target.value })} className="h-10 rounded-lg border border-border px-2" />
              <button disabled={savingSettings} onClick={() => void saveSetting({ type: "shift", ...shiftDraft, name: cleanShiftName(shiftDraft.name), status: isBlockedShiftName(shiftDraft.name) ? "INACTIVE" : "ACTIVE" }, shiftDraft.id ? "Turno atualizado." : "Turno criado.")} className="rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-60">
                {shiftDraft.id ? "Salvar" : "Criar"}
              </button>
            </div>
            {settings?.shifts.length ? (
              <SimpleTable
                columns={["Turno", "Entrada", "Saída", "Status", "Ações"]}
                rows={settings.shifts.map((shift) => {
                  const blockedShift = isBlockedShiftName(shift.name);
                  const effectiveStatus = blockedShift ? "INACTIVE" : shift.status;
                  return [
                    cleanShiftName(shift.name),
                    shift.startsAt,
                    shift.endsAt,
                    <StatusBadge key={`${shift.id}-status`} status={effectiveStatus === "INACTIVE" ? "Inativo" : "Ativo"} />,
                    <div key={`${shift.id}-actions`} className="flex flex-wrap gap-2">
                      <button onClick={() => setShiftDraft({ id: shift.id, name: cleanShiftName(shift.name), startsAt: shift.startsAt, endsAt: shift.endsAt, color: shift.color ?? "#2563EB" })} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">Editar</button>
                      <button
                        disabled={blockedShift}
                        onClick={() => void saveSetting({ type: "shift", id: shift.id, name: cleanShiftName(shift.name), startsAt: shift.startsAt, endsAt: shift.endsAt, color: shift.color, status: effectiveStatus === "INACTIVE" ? "ACTIVE" : "INACTIVE" }, "Status do turno atualizado.")}
                        className="rounded-lg border border-border px-3 py-1 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {blockedShift ? "Inativo padrão" : effectiveStatus === "INACTIVE" ? "Ativar" : "Inativar"}
                      </button>
                    </div>
                  ];
                })}
              />
            ) : <EmptyState title="Nenhum turno cadastrado" description="Crie turnos para aparecerem em cronograma e filtros." />}
          </Panel> : null}

          {activeSection === "Cargos/Funções" ? <div className="grid gap-5 xl:grid-cols-2">
            <Panel title="Cargos/Funções">
              <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto]">
                <input value={roleTitleDraft.name} onChange={(event) => setRoleTitleDraft({ ...roleTitleDraft, name: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Cargo/Função operacional" />
                <button disabled={savingSettings} onClick={() => void saveSetting({ type: "roleTitle", ...roleTitleDraft }, roleTitleDraft.previousName ? "Cargo atualizado." : "Cargo criado.")} className="rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-60">
                  {roleTitleDraft.previousName ? "Salvar" : "Criar"}
                </button>
              </div>
              {settings?.roleTitles.length ? (
                <div className="space-y-2">
                  {settings.roleTitles.map((title) => (
                    <div key={title.name} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                      <span className="font-bold text-navy-950">{title.name}</span>
                      <div className="flex gap-2">
                        <StatusBadge status={title.status === "INACTIVE" ? "Inativo" : "Ativo"} />
                        <button onClick={() => setRoleTitleDraft({ previousName: title.name, name: title.name, status: title.status })} className="text-xs font-bold text-blue-600">Editar</button>
                        <button onClick={() => void saveSetting({ type: "roleTitle", previousName: title.name, name: title.name, status: title.status === "INACTIVE" ? "ACTIVE" : "INACTIVE" }, "Status do cargo atualizado.")} className="text-xs font-bold text-navy-700">
                          {title.status === "INACTIVE" ? "Ativar" : "Inativar"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <EmptyState title="Nenhum cargo configurado" description="Cadastre cargos operacionais para uso no Mapa e cadastros." />}
            </Panel>
          </div> : null}

          {activeSection === "Skills" ? (
            <Panel title="Catálogo de skills">
              <div className="mb-4 grid gap-3 md:grid-cols-[minmax(180px,1fr)_minmax(220px,2fr)_90px_120px_auto]">
                <input value={skillConfigDraft.name} onChange={(event) => setSkillConfigDraft({ ...skillConfigDraft, name: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Nome da skill" />
                <input value={skillConfigDraft.description} onChange={(event) => setSkillConfigDraft({ ...skillConfigDraft, description: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Descrição opcional" />
                <input type="color" value={skillConfigDraft.color} onChange={(event) => setSkillConfigDraft({ ...skillConfigDraft, color: event.target.value })} className="h-10 w-full rounded-lg border border-border px-2" title="Cor da badge" />
                <select value={skillConfigDraft.status} onChange={(event) => setSkillConfigDraft({ ...skillConfigDraft, status: event.target.value as "ACTIVE" | "INACTIVE" })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none"><option value="ACTIVE">Ativa</option><option value="INACTIVE">Inativa</option></select>
                <button disabled={savingSettings || !skillConfigDraft.name.trim()} onClick={() => void saveSetting({ type: "skill", ...skillConfigDraft }, skillConfigDraft.id ? "Skill atualizada." : "Skill criada.")} className="rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-60">{skillConfigDraft.id ? "Salvar" : "Criar"}</button>
              </div>
              <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">
                Cada parceiro pode ter várias skills, mas somente uma principal. A principal continua sendo usada por Billing, permissões e relatórios legados.
              </div>
              {settings?.skills?.length ? (
                <SimpleTable
                  columns={["Badge", "Skill", "Descrição", "Status", "Ações"]}
                  rows={settings.skills.map((skill) => [
                    <span key={`${skill.id}-badge`} className="inline-flex rounded-full border px-3 py-1 text-xs font-black" style={{ color: skill.color, borderColor: `${skill.color}55`, backgroundColor: `${skill.color}12` }}>{skill.name}</span>,
                    skill.name,
                    skill.description || "-",
                    <StatusBadge key={`${skill.id}-status`} status={skill.status === "INACTIVE" ? "Inativa" : "Ativa"} />,
                    <div key={`${skill.id}-actions`} className="flex flex-wrap gap-2">
                      <button onClick={() => setSkillConfigDraft({ id: skill.id, name: skill.name, description: skill.description ?? "", color: skill.color, status: skill.status })} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">Editar</button>
                      <button onClick={() => void saveSetting({ type: "skill", ...skill, status: skill.status === "INACTIVE" ? "ACTIVE" : "INACTIVE" }, "Status da skill atualizado.")} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">{skill.status === "INACTIVE" ? "Ativar" : "Inativar"}</button>
                    </div>
                  ])}
                />
              ) : <EmptyState title="Nenhuma skill cadastrada" description="Crie as skills operacionais e defina uma cor para cada badge." />}
            </Panel>
          ) : null}

          {activeSection === "Configurações gerais" ? (
            <Panel title="Parâmetros e permissões">
              <div className="mb-5 grid gap-3 md:grid-cols-[1fr_auto]">
                <FormInput label="Mês padrão local" value={defaultMonthDraft} onChange={setDefaultMonthDraft} />
                <button disabled={savingSettings} onClick={() => void saveSetting({ type: "defaultMonth", value: defaultMonthDraft }, "Mês padrão atualizado.")} className="self-end rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">Salvar</button>
              </div>
              <SimpleTable
                columns={["Role", "Descrição"]}
                rows={(settings?.roles ?? []).map((role) => [displaySystemRole(role.name), role.label])}
              />
              <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                Apenas ADMIN acessa esta página. Modo local/produção é informativo; secrets continuam fora da interface.
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <FormInput label="Nome da operação" value={String(generalDraft.operationName ?? "Central Operacional")} onChange={(value) => setGeneralDraft({ ...generalDraft, operationName: value })} />
                <FormInput label="Fuso horário" value={String(generalDraft.timezone ?? "America/Sao_Paulo")} onChange={(value) => setGeneralDraft({ ...generalDraft, timezone: value })} />
                {["enableScheduleUpload", "enableDayOffRequests", "enableDayOffSell", "enablePublicRegistration", "enableEmployeeImport", "enableInternalNotifications"].map((key) => (
                  <label key={key} className="flex items-center justify-between rounded-lg border border-border bg-slate-50 p-3 text-sm font-bold text-navy-950">
                    {key}
                    <input type="checkbox" checked={Boolean(generalDraft[key] ?? true)} onChange={(event) => setGeneralDraft({ ...generalDraft, [key]: event.target.checked })} />
                  </label>
                ))}
                <button disabled={savingSettings} onClick={() => void saveSetting({ type: "generalSettings", values: { ...generalDraft, defaultMonth: defaultMonthDraft } }, "Configurações gerais salvas.")} className="rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-60">Salvar configurações gerais</button>
              </div>
            </Panel>
          ) : null}

          {activeSection === "Tipos de solicitação" ? (
            <Panel title="Tipos de solicitação">
              <div className="mb-4 grid gap-3 md:grid-cols-[1fr_1fr_100px_120px_auto]">
                <input value={requestTypeDraft.name} onChange={(event) => setRequestTypeDraft({ ...requestTypeDraft, name: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Tipo" />
                <input value={requestTypeDraft.area} onChange={(event) => setRequestTypeDraft({ ...requestTypeDraft, area: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="Área" />
                <input value={requestTypeDraft.slaHours} onChange={(event) => setRequestTypeDraft({ ...requestTypeDraft, slaHours: event.target.value })} className="h-10 rounded-lg border border-border px-3 text-sm outline-none" placeholder="SLA" />
                <select value={requestTypeDraft.status} onChange={(event) => setRequestTypeDraft({ ...requestTypeDraft, status: event.target.value as "ACTIVE" | "INACTIVE" })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold outline-none"><option value="ACTIVE">Ativo</option><option value="INACTIVE">Inativo</option></select>
                <button disabled={savingSettings} onClick={() => void saveSetting({ type: "requestType", ...requestTypeDraft, slaHours: Number(requestTypeDraft.slaHours) }, requestTypeDraft.id ? "Tipo atualizado." : "Tipo criado.")} className="rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-60">{requestTypeDraft.id ? "Salvar" : "Criar"}</button>
              </div>
              {settings?.requestTypes.length ? (
                <SimpleTable
                  columns={["Tipo", "Área", "SLA", "Aprovação", "Status", "Ações"]}
                  rows={settings.requestTypes.map((type) => [
                    type.name,
                    type.area,
                    `${type.slaHours}h`,
                    type.requiresApproval ? "Sim" : "Não",
                    <StatusBadge key={`${type.id}-status`} status={type.status === "INACTIVE" ? "Inativo" : "Ativo"} />,
                    <div key={`${type.id}-actions`} className="flex flex-wrap gap-2">
                      <button onClick={() => setRequestTypeDraft({ id: type.id, name: type.name, area: type.area, slaHours: String(type.slaHours), requiresApproval: type.requiresApproval, status: type.status ?? "ACTIVE" })} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">Editar</button>
                      <button onClick={() => void saveSetting({ type: "requestType", id: type.id, name: type.name, area: type.area, slaHours: type.slaHours, requiresApproval: type.requiresApproval, status: type.status === "INACTIVE" ? "ACTIVE" : "INACTIVE" }, "Status do tipo atualizado.")} className="rounded-lg border border-border px-3 py-1 text-xs font-bold">{statusButtonLabel(type.status)}</button>
                    </div>
                  ])}
                />
              ) : <EmptyState title="Nenhum tipo configurado" description="Tipos essenciais serão criados pelo seed local." />}
            </Panel>
          ) : null}

          {activeSection === "SLAs" ? rulePanel("SLAs", "slaRule", settings?.slaRules ?? []) : null}
          {activeSection === "Regras de aprovação" ? rulePanel("Regras de aprovação", "approvalRule", settings?.approvalRules ?? []) : null}
          {activeSection === "Regras de cobertura" ? rulePanel("Regras de cobertura", "coverageRule", settings?.coverageRules ?? []) : null}
          {activeSection === "Regras de tokens" ? rulePanel("Regras de tokens", "tokenRule", settings?.tokenRules ?? []) : null}
        </div>
      </div>
    </div>
  );
}
