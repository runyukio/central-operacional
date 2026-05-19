"use client";

import type { ReactNode } from "react";

import { AppShell } from "@/components/layout/app-shell";
import {
  EmptyState,
  FilterBar,
  LoadingState,
  PageHeader,
  Panel,
  SimpleTable,
  StatCard,
  StatusBadge,
  PriorityBadge
} from "@/components/ui/primitives";

export { AppShell as AppSidebar };
export { AppShell as AppHeader };
export { StatCard, StatusBadge, PriorityBadge, FilterBar, PageHeader, EmptyState, LoadingState };
export { SimpleTable as DataTable };

export function CalendarView({ children }: { children: ReactNode }) {
  return <Panel title="Calendário">{children}</Panel>;
}

export function ScheduleGrid({ children }: { children: ReactNode }) {
  return <Panel title="Grade de Cronograma">{children}</Panel>;
}

export function RequestKanban({ children }: { children: ReactNode }) {
  return <Panel title="Kanban de Solicitações">{children}</Panel>;
}

export function RequestCard({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-border bg-white p-4 shadow-soft">{children}</div>;
}

export function RequestDetailDrawer({ children }: { children: ReactNode }) {
  return <Panel title="Detalhe da Solicitação">{children}</Panel>;
}

export function ApprovalTimeline({ children }: { children: ReactNode }) {
  return <Panel title="Linha do Tempo de Aprovação">{children}</Panel>;
}

export function EmployeeProfileDrawer({ children }: { children: ReactNode }) {
  return <Panel title="Perfil do Colaborador">{children}</Panel>;
}

export function UploadExcelModal({ children }: { children: ReactNode }) {
  return <Panel title="Upload Excel">{children}</Panel>;
}

export function ImportPreviewTable({ columns, rows }: { columns: string[]; rows: ReactNode[][] }) {
  return <SimpleTable columns={columns} rows={rows} />;
}

export function CoverageMatrix({ children }: { children: ReactNode }) {
  return <Panel title="Matriz de Cobertura">{children}</Panel>;
}

export function CoverageRiskCard({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-border bg-white p-4 shadow-soft">{children}</div>;
}

export function AnnouncementCard({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-border bg-white p-4 shadow-soft">{children}</div>;
}

export function NotificationPanel({ children }: { children: ReactNode }) {
  return <Panel title="Notificações">{children}</Panel>;
}

export function PerformanceChart({ children }: { children: ReactNode }) {
  return <Panel title="Performance">{children}</Panel>;
}

export function RankingCard({ children }: { children: ReactNode }) {
  return <Panel title="Ranking">{children}</Panel>;
}

export function EquipmentStatusCard({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-border bg-white p-4 shadow-soft">{children}</div>;
}

export function ClimateSurveyForm({ children }: { children: ReactNode }) {
  return <Panel title="Pesquisa de Clima">{children}</Panel>;
}

export function TokenBalanceCard({ children }: { children: ReactNode }) {
  return <Panel title="Saldo de Tokens">{children}</Panel>;
}

export function ChatWindow({ children }: { children: ReactNode }) {
  return <Panel title="Chat">{children}</Panel>;
}

export function AuditLogTable({ columns, rows }: { columns: string[]; rows: ReactNode[][] }) {
  return <SimpleTable columns={columns} rows={rows} />;
}

export function ConfirmDialog({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-border bg-white p-4 shadow-card">{children}</div>;
}
