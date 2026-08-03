"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ClipboardList,
  Clock,
  HeartPulse,
  Laptop,
  Mail,
  MapPin,
  MessageCircle,
  ShieldCheck,
  UserCircle
} from "lucide-react";

import { EmptyState, PageHeader, Panel, StatCard, StatusBadge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type ProfilePayload = {
  data: {
    viewer: {
      role: string;
      isOwnProfile: boolean;
      canViewDiversityData: boolean;
      canViewSensitiveData: boolean;
    };
    employee: {
      id: string;
      name: string;
      socialName: string;
      initials: string;
      wbLogin: string;
      email: string;
      roleTitle: string;
      lob: string;
      team: string;
      supervisor: string;
      shift: string;
      skill: string;
      wave: string;
      status: string;
      userStatus: string;
      systemRole: string;
      admissionDate: string;
      terminationDate: string;
      terminationType: string;
      terminationReason: string;
      contractType: string;
      primaryPhone: string;
      city: string;
      stateUf: string;
      workStartTime: string;
      workEndTime: string;
      nestingStartDate: string;
      goLiveDate: string;
      additionalDataCompletedAt: string;
      additionalData: null | {
        ethnicity: string;
        sexualOrientation: string;
        isPcd: string;
        pcdDisabilityType: string;
        pcdDisabilityOther: string;
        firstJob: string;
        hasTelemarketingExperience: string;
        telemarketingWhere: string;
        pixKeyType?: string;
        pixKey?: string;
      };
    };
    schedule: {
      periodLabel: string;
      referenceMonth: string;
      scheduledDays: number;
      presentDays: number;
      absenceDays: number;
      nextShift: null | { date: string; status: string; shift: string; startsAt: string; endsAt: string };
      days: Array<{ id: string; date: string; day: string; weekday: string; status: string; shift: string }>;
    };
    workHours: {
      periodLabel: string;
      plannedHours: string;
      actualHours: string;
      difference: string;
      pendingAdjustments: number;
      lastRecordAt: string;
    };
    performance: null | {
      quality: number;
      submit: number;
      outputTotal: number | null;
      outputLabel: string;
      ahtSeconds: number;
      ahtAvailable: boolean;
      abs: number;
      wfhStatus: string;
      wfhStatusLabel: string;
      qualityRule: string;
    };
    requests: {
      open: number;
      inAnalysis: number;
      recent: Array<{ id: string; code: string; title: string; type: string; status: string; createdAt: string }>;
    };
    equipments: {
      total: number;
      items: Array<{ id: string; type: string; model: string; serial: string; status: string; deliveredAt: string }>;
    };
    mood: {
      average: number;
      responses: number;
      label: string;
      lastResponseAt: string;
      lastLabel: string;
    };
    billing: null | {
      referenceMonth: string;
      monthLabel: string;
      status: string;
      cycleStatus: string;
      approvedHours: string;
      projectedHours: string;
      projectedDays: number;
      totalHours: string;
      hourlyRate: number;
      grossAmount: number;
      advanceAmount: number;
      automaticAdvanceAmount: number;
      manualAdvanceAmount: number;
      campaignAmount: number;
      bonusAmount: number;
      discountAmount: number;
      correctionAmount: number;
      otherAdjustmentAmount: number;
      adjustmentAmount: number;
      finalAmount: number;
      message: string;
    };
    anonymousFeedbacks: null | {
      total: number;
      answered: number;
      waiting: number;
      items: Array<{
        id: string;
        category: string;
        urgency: string;
        comment: string;
        status: string;
        identified: boolean;
        response: string;
        respondedAt: string;
        respondedBy: string;
        createdAt: string;
      }>;
    };
    updatedAt: string;
  };
};

export function EmployeeProfilePage({ employeeId }: { employeeId?: string }) {
  const [payload, setPayload] = useState<ProfilePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    const url = employeeId ? `/api/employees/${encodeURIComponent(employeeId)}/profile` : "/api/employees/me/profile";
    fetch(url, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error ?? data.message ?? "Não foi possível carregar o perfil.");
        return data as ProfilePayload;
      })
      .then((data) => {
        if (active) setPayload(data);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Não foi possível carregar o perfil.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [employeeId]);

  const data = payload?.data;
  const title = data?.viewer.isOwnProfile ? "Meu Perfil" : "Perfil do Colaborador";
  const statusTone = data?.employee.status.toLowerCase().includes("deslig") || data?.employee.status.toLowerCase().includes("inativo") ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700";

  if (loading) {
    return (
      <>
        <PageHeader title="Meu Perfil" description="Carregando informações consolidadas." icon={UserCircle} />
        <EmptyState title="Carregando perfil" description="Buscando dados reais do colaborador, cronograma e indicadores." />
      </>
    );
  }

  if (error || !data) {
    return (
      <>
        <PageHeader title="Meu Perfil" description="Não foi possível abrir o perfil solicitado." icon={UserCircle} />
        <EmptyState title="Acesso indisponível" description={error || "Você não tem permissão para visualizar este perfil."} />
      </>
    );
  }

  const profileLinks = buildProfileActionLinks(data);

  return (
    <div className="space-y-4">
      <PageHeader
        title={title}
        description={data.viewer.isOwnProfile ? "Seus dados e informações consolidadas." : "Resumo operacional do colaborador selecionado."}
        icon={UserCircle}
        actions={data.viewer.isOwnProfile ? <Link href="/meus-dados/adicionais" className="premium-control inline-flex h-9 items-center px-3 text-xs font-extrabold text-blue-700">Atualizar dados adicionais/PIX</Link> : null}
      />

      <section className="card overflow-hidden">
        <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <div className="relative grid h-20 w-20 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-blue-600 to-blue-700 text-2xl font-black text-white shadow-lg shadow-blue-950/20">
              {data.employee.initials}
              <span className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-white bg-emerald-500" />
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="min-w-0 break-words text-2xl font-black leading-tight text-navy-950">{data.employee.name}</h2>
                <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-extrabold text-blue-700">{data.employee.roleTitle}</span>
              </div>
              {data.employee.socialName ? <p className="mt-1 text-sm font-semibold text-muted">Nome social: {data.employee.socialName}</p> : null}
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs font-bold text-muted">
                <span>{data.employee.wbLogin}</span>
                <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" /> {data.employee.email || "Sem e-mail"}</span>
                <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {data.employee.lob}</span>
                <span>Supervisor: {data.employee.supervisor}</span>
              </div>
            </div>
          </div>
          <div className="grid gap-2 text-sm sm:grid-cols-2 lg:min-w-[260px]">
            <CompactInfo label="Status" value={<span className={cn("inline-flex rounded-md px-2 py-1 text-xs font-black", statusTone)}>{data.employee.status}</span>} />
            <CompactInfo label="Usuário" value={data.employee.userStatus} />
            <CompactInfo label="Admissão" value={data.employee.admissionDate || "Não informado"} />
            <CompactInfo label="Turno" value={data.employee.shift} />
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard title="Qualidade" value={data.performance ? formatPercent(data.performance.quality) : "-"} helper={qualityRuleLabel(data.performance?.qualityRule)} icon={ShieldCheck} tone="green" />
        <StatCard
          title={data.performance?.outputLabel ?? "Submit/dia"}
          value={data.performance ? formatNumber(data.performance.submit) : "-"}
          helper={data.performance?.outputTotal != null ? `${formatNumber(data.performance.outputTotal)} tickets no período` : "média diária"}
          icon={ClipboardList}
          tone="purple"
        />
        <StatCard
          title="AHT"
          value={data.performance?.ahtAvailable ? formatAht(data.performance.ahtSeconds) : "-"}
          helper={data.performance && !data.performance.ahtAvailable ? "não disponível na base CPD" : "médio"}
          icon={Clock}
          tone="orange"
        />
        <StatCard title="ABS" value={data.performance ? formatPercent(data.performance.abs) : "-"} helper={`${data.schedule.absenceDays}/${data.schedule.scheduledDays} dias`} icon={AlertTriangle} tone={(data.performance?.abs ?? 0) > 0 ? "red" : "green"} />
        <StatCard title="Feedback / Humor" value={data.mood.responses ? data.mood.label : "Sem registros"} helper={`${data.mood.responses} resposta(s) no mês`} icon={HeartPulse} tone="orange" />
      </div>

      {data.anonymousFeedbacks ? (
        <section id="meus-feedbacks" className="scroll-mt-24">
          <Panel title="Meus feedbacks enviados">
            <div className="mb-4 flex flex-col gap-3 rounded-lg border border-blue-100 bg-blue-50/70 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white text-blue-700 shadow-sm">
                  <MessageCircle className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-black text-navy-950">Acompanhe seus relatos e os retornos da empresa</p>
                  <p className="mt-1 text-xs font-semibold leading-5 text-blue-800">Feedbacks anônimos continuam ocultando sua identidade da equipe responsável. Este histórico só aparece no seu próprio perfil.</p>
                </div>
              </div>
              <div className="grid shrink-0 grid-cols-3 gap-2 text-center">
                <FeedbackCount label="Enviados" value={data.anonymousFeedbacks.total} />
                <FeedbackCount label="Respondidos" value={data.anonymousFeedbacks.answered} tone="green" />
                <FeedbackCount label="Aguardando" value={data.anonymousFeedbacks.waiting} tone="orange" />
              </div>
            </div>

            {data.anonymousFeedbacks.items.length ? (
              <div className="space-y-2">
                {data.anonymousFeedbacks.items.map((feedback) => (
                  <details key={feedback.id} className="group rounded-lg border border-border bg-white open:border-blue-200 open:shadow-sm">
                    <summary className="flex cursor-pointer list-none flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between [&::-webkit-details-marker]:hidden">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-black text-navy-950">{feedback.category}</p>
                          <StatusBadge status={feedback.status} />
                          <span className={cn("inline-flex rounded-md px-2 py-1 text-[11px] font-black", feedback.identified ? "bg-violet-50 text-violet-700" : "bg-slate-100 text-slate-600")}>
                            {feedback.identified ? "Identificado" : "Anônimo"}
                          </span>
                          {feedback.response ? <span className="inline-flex rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-700">Respondido</span> : null}
                        </div>
                        <p className="mt-1 truncate text-sm font-semibold text-muted">{feedback.comment}</p>
                      </div>
                      <div className="flex shrink-0 items-center justify-between gap-3 text-xs font-bold text-muted sm:justify-end">
                        <span>{feedback.createdAt}</span>
                        <span className="text-blue-700 group-open:hidden">Ver detalhes</span>
                        <span className="hidden text-blue-700 group-open:inline">Ocultar</span>
                      </div>
                    </summary>
                    <div className="border-t border-border px-3 pb-3 pt-3">
                      <div className="rounded-lg bg-slate-50 p-3">
                        <p className="text-[11px] font-black uppercase tracking-wide text-muted">Seu feedback · Urgência {feedback.urgency.toLowerCase()}</p>
                        <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-navy-950">{feedback.comment}</p>
                      </div>
                      {feedback.response ? (
                        <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50/70 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-black text-emerald-800">Resposta de {feedback.respondedBy}</p>
                            <p className="text-xs font-bold text-emerald-700">{feedback.respondedAt}</p>
                          </div>
                          <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-navy-950">{feedback.response}</p>
                        </div>
                      ) : (
                        <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm font-bold text-amber-800">
                          Aguardando retorno da East River.
                        </div>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            ) : (
              <EmptyState title="Nenhum feedback enviado" description="Quando você enviar um feedback, o acompanhamento e a resposta aparecerão aqui." />
            )}
          </Panel>
        </section>
      ) : null}

      <div className="grid w-full gap-4 xl:grid-cols-12 xl:items-start">
        <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:col-span-4 xl:block xl:space-y-4">
          <Panel title="Dados Operacionais">
            <div className="grid gap-x-3 gap-y-2 text-[13px] sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <InfoLine label="Cargo/Função" value={data.employee.roleTitle} />
              <InfoLine label="LOB" value={data.employee.lob} />
              <InfoLine label="Time" value={data.employee.team} />
              <InfoLine label="Skill" value={data.employee.skill} />
              <InfoLine label="Wave" value={data.employee.wave} />
              <InfoLine label="Entrada" value={data.employee.workStartTime || "Não informado"} />
              <InfoLine label="Saída" value={data.employee.workEndTime || "Não informado"} />
              <InfoLine label="Go Live" value={data.employee.goLiveDate || "Não informado"} />
            </div>
          </Panel>

          {data.billing ? (
            <Panel title="Prévia de Invoice" action="Ver detalhes" actionOnClick={() => window.location.assign(profileLinks.invoice)}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-black text-navy-950">{data.billing.monthLabel}</p>
                  <p className="text-xs font-semibold text-muted">{data.billing.message}</p>
                </div>
                <StatusBadge status={invoiceStatusLabel(data.billing.status)} />
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <MetricBox label="Horas aprovadas" value={data.billing.approvedHours} tone="green" />
                <MetricBox label="Horas projetadas" value={data.billing.projectedHours} />
                <MetricBox label="Valor bruto" value={formatCurrency(data.billing.grossAmount)} />
                <MetricBox label="Previsão final" value={formatCurrency(data.billing.finalAmount)} tone="green" />
              </div>
              <div className="mt-3 rounded-lg border border-border bg-slate-50 p-3 text-sm">
                <InfoLine label="Adiantamento" value={data.billing.advanceAmount ? `-${formatCurrency(data.billing.advanceAmount)}` : "Sem desconto"} />
                <InfoLine label="Campanha" value={formatCurrency(data.billing.campaignAmount)} />
                <InfoLine label="Bônus" value={formatCurrency(data.billing.bonusAmount)} />
                <InfoLine label="Correção" value={formatCurrency(data.billing.correctionAmount)} />
                <InfoLine label="Desconto" value={data.billing.discountAmount ? `-${formatCurrency(data.billing.discountAmount)}` : formatCurrency(0)} />
                <InfoLine label="Outros ajustes" value={formatCurrency(data.billing.otherAdjustmentAmount)} />
                <InfoLine label="Valor/hora" value={formatCurrency(data.billing.hourlyRate)} />
                <InfoLine label="Total de horas" value={data.billing.totalHours} />
              </div>
            </Panel>
          ) : null}
        </div>

        <div className="grid min-w-0 gap-4 xl:col-span-5">
          <Panel title={`Cronograma (${data.schedule.periodLabel})`} action="Ver completo" actionOnClick={() => window.location.assign(profileLinks.schedule)}>
            <div className="grid gap-2 sm:grid-cols-3">
              <MetricBox label="Escalados" value={data.schedule.scheduledDays} />
              <MetricBox label="Presentes" value={data.schedule.presentDays} />
              <MetricBox label="Faltas" value={data.schedule.absenceDays} />
            </div>
            <div className="mt-3 rounded-lg border border-border bg-slate-50 p-3 text-sm">
              <p className="text-xs font-black uppercase tracking-wide text-muted">Próximo turno</p>
              {data.schedule.nextShift ? (
                <p className="mt-1 font-bold text-navy-950">
                  {data.schedule.nextShift.date} • {data.schedule.nextShift.status} • {data.schedule.nextShift.shift}
                </p>
              ) : (
                <p className="mt-1 font-bold text-muted">Sem próximo cronograma.</p>
              )}
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-7">
              {data.schedule.days.length ? data.schedule.days.map((day) => <ScheduleChip key={day.id} day={day} />) : <div className="col-span-full text-sm font-semibold text-muted">Sem cronograma no mês.</div>}
            </div>
          </Panel>

          <Panel title="Solicitações" action="Ver todas" actionOnClick={() => window.location.assign(profileLinks.requests)}>
            <div className="mb-3 grid grid-cols-2 gap-2">
              <MetricBox label="Abertas" value={data.requests.open} />
              <MetricBox label="Em análise" value={data.requests.inAnalysis} />
            </div>
            {data.requests.recent.length ? (
              <div className="space-y-2">
                {data.requests.recent.map((request) => (
                  <div key={request.id} className="rounded-lg border border-border bg-white p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold text-navy-950">{request.title}</p>
                        <p className="mt-1 text-xs font-semibold text-muted">{request.code} • {request.type} • {request.createdAt}</p>
                      </div>
                      <StatusBadge status={request.status} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm font-semibold text-muted">Sem solicitações recentes.</p>
            )}
          </Panel>
        </div>

        <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:col-span-3 xl:grid-cols-1">
          <Panel title={`Horas (${data.workHours.periodLabel})`} action="Ver detalhes" actionOnClick={() => window.location.assign(profileLinks.workHours)}>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <MetricBox label="Planejadas" value={data.workHours.plannedHours} />
              <MetricBox label="Realizadas" value={data.workHours.actualHours} />
              <MetricBox label="Divergência" value={data.workHours.difference} tone={data.workHours.difference.startsWith("-") ? "red" : "green"} />
              <MetricBox label="Ajustes pendentes" value={data.workHours.pendingAdjustments} />
            </div>
            <p className="mt-3 text-xs font-semibold text-muted">Último lançamento: {data.workHours.lastRecordAt || "Sem registro"}</p>
          </Panel>

          <Panel title="Performance" action="Ver histórico" actionOnClick={() => window.location.assign(profileLinks.performance)}>
            {data.performance ? (
              <div className="grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <InfoLine label="Qualidade" value={formatPercent(data.performance.quality)} />
                <InfoLine label={data.performance.outputLabel} value={formatNumber(data.performance.submit)} />
                {data.performance.outputTotal != null ? <InfoLine label="Output total" value={formatNumber(data.performance.outputTotal)} /> : null}
                <InfoLine label="AHT" value={data.performance.ahtAvailable ? formatAht(data.performance.ahtSeconds) : "Não disponível"} />
                <InfoLine label="ABS" value={formatPercent(data.performance.abs)} />
                <InfoLine label="WFH" value={<WfhBadge status={data.performance.wfhStatus} label={data.performance.wfhStatusLabel} />} />
                <InfoLine label="Regra" value={qualityRuleLabel(data.performance.qualityRule)} />
              </div>
            ) : (
              <EmptyState title="Sem performance no período" description="Importe Qualidade/Produção ou ajuste o período no módulo Performance." />
            )}
          </Panel>

          <Panel title="Feedback / Humor">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-orange-50 text-orange-500">
                <HeartPulse className="h-6 w-6" />
              </div>
              <div>
                <p className="text-2xl font-black text-navy-950">{data.mood.average ? `${data.mood.average}/5` : "-"}</p>
                <p className="text-sm font-bold text-muted">{data.mood.label} • {data.mood.responses} resposta(s)</p>
              </div>
            </div>
            <p className="mt-3 text-sm font-semibold text-muted">
              Última resposta: {data.mood.lastResponseAt ? `${data.mood.lastResponseAt} • ${data.mood.lastLabel}` : "Sem registro no período"}
            </p>
          </Panel>
        </div>

        <div className="grid min-w-0 gap-4 xl:col-span-12 xl:grid-cols-2">
          <Panel title="Equipamentos" action="Ver todos" actionOnClick={() => window.location.assign(profileLinks.equipment)}>
            {data.equipments.items.length ? (
              <div className="grid gap-2">
                {data.equipments.items.map((item) => (
                  <div key={item.id} className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-white p-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600">
                      <Laptop className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-extrabold text-navy-950">{item.model || item.type}</p>
                      <p className="truncate text-xs font-semibold text-muted">Série: {item.serial || "Não informado"} • Entrega: {item.deliveredAt || "Não informada"}</p>
                    </div>
                    <StatusBadge status={item.status} />
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Sem equipamento vinculado" description="Equipamentos aparecerão aqui quando houver vínculo ativo." />
            )}
          </Panel>

          <Panel title="Dados Cadastrais">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <InfoLine label="Telefone" value={data.employee.primaryPhone || "Não informado"} />
              <InfoLine label="Cidade/UF" value={[data.employee.city, data.employee.stateUf].filter(Boolean).join(" / ") || "Não informado"} />
              <InfoLine label="Contrato" value={data.employee.contractType || "Não informado"} />
              <InfoLine label="Desligamento" value={data.employee.terminationDate || "Não informado"} />
              <InfoLine label="Tipo desligamento" value={data.employee.terminationType || "Não informado"} />
              <InfoLine label="Motivo desligamento" value={data.employee.terminationReason || "Não informado"} />
            </div>
            {data.employee.additionalData ? (
              <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/60 p-3">
                <p className="mb-2 text-xs font-black uppercase tracking-wide text-blue-700">Dados adicionais</p>
                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  <InfoLine label="Etnia" value={data.employee.additionalData.ethnicity || "Não informado"} />
                  <InfoLine label="Orientação sexual" value={data.employee.additionalData.sexualOrientation || "Não informado"} />
                  <InfoLine label="É PCD?" value={data.employee.additionalData.isPcd || "Não informado"} />
                  <InfoLine label="Tipo deficiência" value={data.employee.additionalData.pcdDisabilityType || "Não informado"} />
                  <InfoLine label="Primeiro emprego" value={data.employee.additionalData.firstJob || "Não informado"} />
                  <InfoLine label="Telemarketing" value={data.employee.additionalData.hasTelemarketingExperience || "Não informado"} />
                  <InfoLine label="Onde trabalhou" value={data.employee.additionalData.telemarketingWhere || "Não informado"} />
                  <InfoLine label="Tipo da Chave PIX" value={data.employee.additionalData.pixKeyType || "Não informado"} />
                  <InfoLine label="Chave PIX" value={data.employee.additionalData.pixKey || "Não informada"} />
                  <InfoLine label="Concluído em" value={data.employee.additionalDataCompletedAt || "Pendente"} />
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-muted">
                Dados sensíveis ocultos para este perfil de acesso.
              </div>
            )}
          </Panel>
        </div>
      </div>

      <p className="pb-2 text-right text-xs font-semibold text-muted">Dados atualizados em {data.updatedAt}. Informações exibidas conforme sua permissão de acesso.</p>
    </div>
  );
}

function buildProfileActionLinks(data: ProfilePayload["data"]) {
  const employeeId = encodeURIComponent(data.employee.id);
  const referenceMonth = data.schedule.referenceMonth;
  const { month, year, startDate, endDate } = monthParams(referenceMonth);
  const ownProfile = data.viewer.isOwnProfile;
  return {
    schedule: ownProfile
      ? `/minha-escala?month=${encodeURIComponent(referenceMonth)}`
      : `/escalas?employeeId=${employeeId}&month=${month}&year=${year}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
    workHours: ownProfile
      ? `/minha-escala?month=${encodeURIComponent(referenceMonth)}`
      : `/horas-operacionais?employeeId=${employeeId}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
    performance: ownProfile
      ? `/minha-performance?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`
      : `/performance?view=wfh&employeeId=${employeeId}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
    requests: `/esteiras?employeeId=${employeeId}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
    equipment: `/equipamentos?responsibleId=${employeeId}`,
    invoice: ownProfile
      ? `/meu-perfil/invoice?referenceMonth=${encodeURIComponent(data.billing?.referenceMonth ?? referenceMonth)}`
      : `/billing?employeeId=${employeeId}&referenceMonth=${encodeURIComponent(data.billing?.referenceMonth ?? referenceMonth)}&tab=employees`
  };
}

function monthParams(referenceMonth: string) {
  const [yearRaw, monthRaw] = referenceMonth.split("-").map(Number);
  const year = Number.isFinite(yearRaw) ? yearRaw : new Date().getUTCFullYear();
  const month = Number.isFinite(monthRaw) ? monthRaw : new Date().getUTCMonth() + 1;
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return {
    year,
    month,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10)
  };
}

function CompactInfo({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-black uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-1 min-w-0 break-words text-sm font-extrabold text-navy-950">{value || "-"}</div>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-black uppercase tracking-wide text-muted">{label}</p>
      <div className="mt-1 min-w-0 break-words font-bold text-navy-950">{value || "-"}</div>
    </div>
  );
}

function FeedbackCount({ label, value, tone = "blue" }: { label: string; value: number; tone?: "blue" | "green" | "orange" }) {
  const toneClass = tone === "green" ? "text-emerald-700" : tone === "orange" ? "text-amber-700" : "text-blue-700";
  return (
    <div className="min-w-[72px] rounded-lg border border-white/80 bg-white px-2 py-2 shadow-sm">
      <p className={cn("text-lg font-black leading-none", toneClass)}>{value}</p>
      <p className="mt-1 text-[9px] font-black uppercase tracking-wide text-muted">{label}</p>
    </div>
  );
}

function MetricBox({ label, value, tone = "blue" }: { label: string; value: React.ReactNode; tone?: "blue" | "green" | "red" }) {
  const toneClass = tone === "red" ? "text-red-600" : tone === "green" ? "text-emerald-600" : "text-blue-700";
  return (
    <div className="rounded-lg border border-border bg-white p-3 text-center">
      <p className={cn("text-lg font-black leading-none", toneClass)}>{value}</p>
      <p className="mt-1 text-[11px] font-extrabold uppercase tracking-wide text-muted">{label}</p>
    </div>
  );
}

function ScheduleChip({ day }: { day: { day: string; weekday: string; status: string; date: string } }) {
  const tone = scheduleTone(day.status);
  const shortStatus = abbreviateScheduleStatus(day.status);
  return (
    <div title={`${day.date} • ${day.status}`} className={cn("grid h-[76px] min-w-0 place-items-center overflow-hidden rounded-lg border p-1.5 text-center", tone)}>
      <div className="min-w-0">
        <p className="truncate text-[9px] font-black uppercase leading-none tracking-wide opacity-70">{day.weekday}</p>
        <p className="mt-1 text-base font-black leading-none">{day.day}</p>
        <p className="mx-auto mt-1 line-clamp-2 max-w-full text-[10px] font-extrabold leading-[11px]">{shortStatus}</p>
      </div>
    </div>
  );
}

function WfhBadge({ status, label }: { status: string; label: string }) {
  const tone = status === "QUALIFIED"
    ? "bg-emerald-50 text-emerald-700"
    : status === "PENDING_VALIDATION" || status === "INSUFFICIENT_DATA"
      ? "bg-amber-50 text-amber-700"
      : status === "NOT_APPLICABLE"
        ? "bg-slate-50 text-slate-600"
        : "bg-red-50 text-red-700";
  return (
    <span className={cn("inline-flex rounded-md px-2 py-1 text-xs font-black", tone)}>
      {label || "Sem dados"}
    </span>
  );
}

function scheduleTone(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes("presente")) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (normalized.includes("falta")) return "border-red-200 bg-red-50 text-red-700";
  if (normalized.includes("folga")) return "border-slate-200 bg-slate-50 text-slate-700";
  if (normalized.includes("escalado")) return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function abbreviateScheduleStatus(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes("presente")) return "Pres.";
  if (normalized.includes("escalado")) return "Escal.";
  if (normalized.includes("falta justificada")) return "F. Just.";
  if (normalized.includes("falta injustificada")) return "F. Injust.";
  if (normalized.includes("falta")) return "Falta";
  if (normalized.includes("venda")) return "Venda";
  if (normalized.includes("troca")) return "Troca";
  if (normalized.includes("sem cronograma")) return "Sem cron.";
  if (normalized.includes("folga aprovada")) return "Folga aprov.";
  if (normalized.includes("folga")) return "Folga";
  if (normalized.includes("férias") || normalized.includes("ferias")) return "Férias";
  if (normalized.includes("afastado")) return "Afast.";
  if (normalized.includes("treinamento")) return "Trein.";
  if (normalized.includes("nesting")) return "Nesting";
  return status;
}

function formatPercent(value: number) {
  return `${formatNumber(value, 1)}%`;
}

function formatNumber(value: number, decimals = 0) {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(value);
}

function formatAht(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "-";
  return `${formatNumber(seconds, 0)}s`;
}

function qualityRuleLabel(value?: string) {
  if (value === "ADS_QUALITY") return "Regra ADS";
  if (value === "TNS_QUALITY") return "Regra TNS";
  if (value === "MIXED") return "Regra mista";
  return "Sem regra";
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number.isFinite(value) ? value : 0);
}

function invoiceStatusLabel(value: string) {
  const labels: Record<string, string> = {
    EM_PREVISAO: "Em previsão",
    DISPONIVEL_APROVACAO: "Disponível para aprovação",
    APROVADO_COLABORADOR: "Aprovado pelo colaborador",
    AGUARDANDO_SUPERVISOR: "Aguardando supervisor",
    AGUARDANDO_ADMIN: "Aguardando Admin",
    AJUSTE_CONCLUIDO: "Ajuste concluído",
    FECHADO: "Fechado"
  };
  return labels[value] ?? value;
}
