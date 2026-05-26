"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import {
  Bell,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Coins,
  FileBarChart,
  HeartPulse,
  HelpCircle,
  KanbanSquare,
  LayoutDashboard,
  LogOut,
  Map,
  Megaphone,
  Menu,
  MessageCircleQuestion,
  MessagesSquare,
  MonitorCog,
  Moon,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Trophy,
  UserPlus,
  UserCircle,
  UsersRound
} from "lucide-react";

import { useTheme } from "@/components/theme-provider";
import { getNavItems } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const icons = {
  LayoutDashboard,
  CalendarDays,
  UserPlus,
  CalendarRange,
  Clock,
  ClipboardList,
  ClipboardCheck,
  KanbanSquare,
  Trophy,
  Megaphone,
  ShieldCheck,
  Map,
  UsersRound,
  MonitorCog,
  HeartPulse,
  MessageCircleQuestion,
  Coins,
  MessagesSquare,
  FileBarChart,
  ScrollText,
  Settings
};

type ShellUser = {
  name?: string | null;
  email?: string | null;
  role?: string;
};

type HeaderNotification = {
  id: string;
  title: string;
  body: string;
  type: string;
  href?: string;
  isRead: boolean;
  createdAt: string;
};

export function AppShell({ children, user }: { children: React.ReactNode; user: ShellUser }) {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const role = user.role ?? "COLABORADOR";
  const navItems = getNavItems(role);
  const isCollaborator = role === "COLABORADOR";
  const [notifications, setNotifications] = useState<HeaderNotification[]>([]);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const unreadNotifications = notifications.filter((notification) => !notification.isRead).length;

  useEffect(() => {
    fetch("/api/notifications", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { data?: HeaderNotification[] }) => setNotifications(payload.data ?? []))
      .catch(() => undefined);
  }, []);

  async function markAllNotificationsRead() {
    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "ALL" })
    });
    const payload = (await response.json()) as { data?: HeaderNotification[] };
    setNotifications(payload.data ?? []);
  }

  async function markNotificationRead(id: string) {
    const response = await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id })
    });
    const payload = (await response.json()) as { data?: HeaderNotification[] };
    setNotifications(payload.data ?? []);
  }

  return (
    <div className="min-h-screen bg-surface text-ink">
      <aside className="navy-gradient fixed inset-y-0 left-0 z-40 hidden w-[224px] border-r border-white/10 text-white shadow-2xl lg:flex lg:flex-col">
        <div className="flex h-16 items-center gap-2.5 border-b border-white/10 px-3.5">
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 shadow-lg shadow-blue-950/40 ring-1 ring-white/20">
            <Sparkles className="h-[18px] w-[18px]" />
          </div>
          <div>
            <p className="text-[15px] font-black leading-tight tracking-tight">Central</p>
            <p className="text-[15px] font-black leading-tight tracking-tight">Operacional</p>
          </div>
        </div>

        <div className="flex items-center justify-between px-3.5 py-2.5">
          <span className="text-[10.5px] font-extrabold uppercase tracking-[0.2em] text-blue-100/65">Menu</span>
          <Menu className="h-4 w-4 text-blue-100/70" />
        </div>

        <nav className="sidebar-scroll flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {navItems.map((item) => {
            const Icon = icons[item.icon as keyof typeof icons] ?? LayoutDashboard;
            const active = pathname === item.href || (item.href !== "/central-operacional" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group relative flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11.5px] font-bold text-blue-50/86 transition",
                  active
                    ? "bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg shadow-blue-950/35 ring-1 ring-white/10"
                    : "hover:bg-white/9 hover:text-white"
                )}
              >
                {active ? <span className="absolute -left-2.5 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-blue-300" /> : null}
                <Icon className={cn("h-3.5 w-3.5 shrink-0", active ? "text-white" : "text-blue-100/88")} />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-2.5">
          <div className="rounded-xl border border-white/10 bg-white/8 p-2.5 shadow-lg shadow-navy-950/20">
            <p className="text-[12.5px] font-semibold">{isCollaborator ? "Precisa de ajuda?" : "Filtros por página"}</p>
            <p className="mt-1 text-[11.5px] leading-4 text-blue-100/75">
              {isCollaborator ? "Fale com o RH ou supervisor." : "Use os filtros funcionais dentro de cada módulo."}
            </p>
          </div>
        </div>
      </aside>

      <main className="min-h-screen lg:pl-[224px]">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border/80 bg-white/94 px-4 shadow-[0_8px_24px_rgba(7,27,58,0.035)] backdrop-blur-xl md:px-5">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <button className="premium-control grid h-9 w-9 place-items-center text-navy-900 lg:hidden">
              <Menu className="h-5 w-5" />
            </button>
            <div className="premium-control hidden h-9 w-full max-w-[420px] items-center gap-2.5 px-3 text-muted md:flex">
              <Search className="h-4 w-4" />
              <input
                className="w-full border-0 bg-transparent text-sm outline-none"
                placeholder="Pesquisar pessoas, cronogramas, solicitações..."
              />
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-navy-900">
            <div className="relative">
              <button
                onClick={() => setNotificationOpen((current) => !current)}
                className="relative grid h-9 w-9 place-items-center rounded-lg border border-transparent hover:border-border hover:bg-surface"
                aria-label="Notificações"
              >
                <Bell className="h-[18px] w-[18px]" />
                {unreadNotifications ? (
                  <span className="absolute right-1.5 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-blue-600 px-1 text-[10px] font-bold text-white">
                    {unreadNotifications}
                  </span>
                ) : null}
              </button>
              {notificationOpen ? (
                <div className="absolute right-0 top-11 z-50 w-[340px] overflow-hidden rounded-2xl border border-border bg-white shadow-2xl shadow-navy-950/15">
                  <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <div>
                      <p className="text-sm font-black text-navy-950">Notificações</p>
                      <p className="text-xs text-muted">{unreadNotifications} não lida(s)</p>
                    </div>
                    <button onClick={markAllNotificationsRead} className="rounded-lg px-3 py-1.5 text-xs font-extrabold text-blue-700 hover:bg-blue-50">
                      Marcar lidas
                    </button>
                  </div>
                  <div className="max-h-[420px] overflow-y-auto p-2">
                    {notifications.length ? (
                      notifications.map((notification) => (
                        <Link
                          key={notification.id}
                          href={notification.href ?? "/mural"}
                          onClick={() => {
                            void markNotificationRead(notification.id);
                            setNotificationOpen(false);
                          }}
                          className="mb-2 block rounded-xl border border-transparent p-3 text-left transition hover:border-border hover:bg-surface"
                        >
                          <div className="flex items-start gap-3">
                            <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", notification.isRead ? "bg-slate-300" : "bg-blue-600")} />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-extrabold text-navy-950">{notification.title}</p>
                              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{notification.body}</p>
                              <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{notification.type} • {notification.createdAt}</p>
                            </div>
                          </div>
                        </Link>
                      ))
                    ) : (
                      <div className="p-6 text-center text-sm text-muted">Sem notificações no momento.</div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            <button className="hidden h-9 w-9 place-items-center rounded-lg border border-transparent hover:border-border hover:bg-surface md:grid">
              <HelpCircle className="h-[18px] w-[18px]" />
            </button>
            <button
              onClick={toggleTheme}
              className="hidden h-9 w-9 place-items-center rounded-lg border border-transparent hover:border-border hover:bg-surface md:grid"
              aria-label={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
              title={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
            >
              {theme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
            </button>
            <div className="hidden h-9 w-px bg-border md:block" />
            <div className="flex items-center gap-2.5">
              <div className="hidden text-right md:block">
                <p className="text-sm font-bold">{user.name ?? "Usuário"}</p>
                <p className="text-xs text-muted">{roleLabel(role)}</p>
              </div>
              <div className="relative grid h-9 w-9 place-items-center rounded-full border border-border bg-gradient-to-b from-slate-50 to-slate-100 text-navy-900 shadow-soft">
                <UserCircle className="h-6 w-6 text-slate-400" />
                <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-success" />
              </div>
              <button onClick={() => signOut({ callbackUrl: "/login" })} className="grid h-9 w-9 place-items-center rounded-lg border border-transparent hover:border-border hover:bg-surface" title="Sair">
                <LogOut className="h-4 w-4" />
              </button>
              <ChevronDown className="hidden h-4 w-4 md:block" />
            </div>
          </div>
        </header>

        <div className="px-4 py-4 md:px-5 xl:px-6">{children}</div>
      </main>
    </div>
  );
}

export function TopActions() {
  return null;
}

function roleLabel(role: string) {
  const labels: Record<string, string> = {
    ADMIN: "Administrador",
    GESTOR: "Gestão",
    SUPERVISOR: "Supervisor",
    COLABORADOR: "Atendimento",
    WFM: "WFM",
    QUALIDADE: "Qualidade",
    RH: "RH",
    TI: "Logística / TI"
  };
  return labels[role] ?? role;
}
