"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useRef, useState } from "react";
import {
  Bell,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ChevronRight,
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
import { getNavItems, getNavSections } from "@/lib/navigation";
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
  MessagesSquare,
  Coins,
  FileBarChart,
  ScrollText,
  Settings,
  UserCircle
};

const SIDEBAR_OPEN_SECTIONS_STORAGE_KEY = "sidebarOpenSectionsV2";

type ShellUser = {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  role?: string;
  roleTitle?: string | null;
  jobTitle?: string | null;
  skill?: string | null;
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

type GlobalSearchResult = {
  type: "employee";
  id: string;
  name: string;
  socialName?: string;
  wbLogin: string;
  email?: string;
  jobTitle?: string;
  lob?: string;
  status?: string;
  avatarInitials?: string;
};

type NavigationItem = ReturnType<typeof getNavItems>[number];
type NavigationSection = ReturnType<typeof getNavSections>[number];

export function AppShell({
  children,
  user,
  billingAccess = false,
  financeiroAccess = false
}: {
  children: React.ReactNode;
  user: ShellUser;
  billingAccess?: boolean;
  financeiroAccess?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const role = user.role ?? "COLABORADOR";
  const navSections = getNavSections(user)
    .map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        (item.href !== "/billing" || billingAccess) &&
        (item.href !== "/financeiro" || financeiroAccess)
      )
    }))
    .filter((section) => section.items.length > 0);
  const navItems = navSections.flatMap((section) => section.items);
  const isCollaborator = role === "COLABORADOR";
  const [notifications, setNotifications] = useState<HeaderNotification[]>([]);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [openNavSections, setOpenNavSections] = useState<Record<string, boolean>>({});
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [globalSearchResults, setGlobalSearchResults] = useState<GlobalSearchResult[]>([]);
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const unreadNotifications = notifications.filter((notification) => !notification.isRead).length;

  useEffect(() => {
    const stored = window.localStorage.getItem("sidebarCollapsed");
    if (stored === "true") setSidebarCollapsed(true);
    if (stored === "false") setSidebarCollapsed(false);

    const storedSections = window.localStorage.getItem(SIDEBAR_OPEN_SECTIONS_STORAGE_KEY);
    if (storedSections) {
      try {
        setOpenNavSections(JSON.parse(storedSections) as Record<string, boolean>);
      } catch {
        setOpenNavSections({});
      }
    }
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("sidebarCollapsed", String(next));
      return next;
    });
  }

  function closeMobileMenu() {
    setMobileMenuOpen(false);
  }

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileMenuOpen(false);
    }

    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [mobileMenuOpen]);

  useEffect(() => {
    fetch("/api/notifications", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { data?: HeaderNotification[] }) => setNotifications(payload.data ?? []))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const query = globalSearch.trim();
    if (query.length < 2) {
      setGlobalSearchResults([]);
      setGlobalSearchLoading(false);
      return undefined;
    }
    setGlobalSearchLoading(true);
    const timeout = window.setTimeout(() => {
      fetch(`/api/search/global?q=${encodeURIComponent(query)}&limit=12`, { cache: "no-store" })
        .then((response) => response.json())
        .then((payload: { results?: GlobalSearchResult[] }) => {
          setGlobalSearchResults(payload.results ?? []);
          setGlobalSearchOpen(true);
        })
        .catch(() => setGlobalSearchResults([]))
        .finally(() => setGlobalSearchLoading(false));
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [globalSearch]);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!searchRef.current?.contains(event.target as Node)) setGlobalSearchOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
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

  function openSearchResult(result: GlobalSearchResult) {
    setGlobalSearch("");
    setGlobalSearchResults([]);
    setGlobalSearchOpen(false);
    router.push(`/perfil/${result.id}`);
  }

  function navItemIsActive(item: NavigationItem) {
    if (item.href === "/meu-perfil" && pathname.startsWith("/perfil/")) return true;
    return pathname === item.href || (item.href !== "/central-operacional" && pathname.startsWith(item.href));
  }

  function navSectionIsOpen(section: NavigationSection) {
    return openNavSections[section.label] ?? false;
  }

  function toggleNavSection(label: string) {
    setOpenNavSections((current) => {
      const next = { ...current, [label]: !(current[label] ?? false) };
      window.localStorage.setItem(SIDEBAR_OPEN_SECTIONS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  function renderDesktopNavLink(item: NavigationItem) {
    const Icon = icons[item.icon as keyof typeof icons] ?? LayoutDashboard;
    const active = navItemIsActive(item);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-label={item.label}
        className={cn(
          "app-sidebar-link group relative flex items-center rounded-lg py-1.5 text-[11.5px] font-bold transition",
          "gap-2 px-2.5",
          active && "app-sidebar-link-active ring-1 ring-white/20"
        )}
      >
        {active ? <span className="app-sidebar-active-marker absolute -left-2.5 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full" /> : null}
        <Icon className="app-sidebar-icon h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{item.label}</span>
      </Link>
    );
  }

  function renderCollapsedNavLink(item: NavigationItem) {
    const Icon = icons[item.icon as keyof typeof icons] ?? LayoutDashboard;
    const active = navItemIsActive(item);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-label={item.label}
        title={item.label}
        className={cn(
          "app-sidebar-link group relative flex items-center justify-center rounded-lg px-0 py-1.5 text-[11.5px] font-bold transition",
          active && "app-sidebar-link-active ring-1 ring-white/20"
        )}
      >
        {active ? <span className="app-sidebar-active-marker absolute -left-2.5 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full" /> : null}
        <Icon className="app-sidebar-icon h-3.5 w-3.5 shrink-0" />
        <span className="sr-only">{item.label}</span>
        <span className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 z-50 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-navy-950 px-2 py-1 text-xs font-bold text-white shadow-xl group-hover:block group-focus-visible:block">
          {item.label}
        </span>
      </Link>
    );
  }

  function renderMobileNavLink(item: NavigationItem) {
    const Icon = icons[item.icon as keyof typeof icons] ?? LayoutDashboard;
    const active = navItemIsActive(item);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={closeMobileMenu}
        aria-label={item.label}
        className={cn(
          "app-sidebar-link relative flex min-w-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-bold transition",
          active && "app-sidebar-link-active ring-1 ring-white/20"
        )}
      >
        {active ? <span className="app-sidebar-active-marker absolute -left-2.5 top-1/2 h-7 w-1 -translate-y-1/2 rounded-r-full" /> : null}
        <Icon className="app-sidebar-icon h-4 w-4 shrink-0" />
        <span className="min-w-0 truncate">{item.label}</span>
      </Link>
    );
  }

  return (
    <div className="min-h-screen bg-surface text-ink lg:flex">
      <aside
        className={cn(
          "app-sidebar sticky top-0 z-40 hidden h-screen shrink-0 border-r transition-[width] duration-200 lg:flex lg:flex-col",
          sidebarCollapsed ? "w-[72px]" : "w-[224px]"
        )}
      >
        <div className={cn("app-sidebar-divider flex h-16 items-center border-b px-3.5", sidebarCollapsed ? "justify-center" : "gap-2.5")}>
          <div className="app-sidebar-brand-icon grid h-8 w-8 place-items-center rounded-xl ring-1 ring-white/45">
            <Sparkles className="h-[18px] w-[18px]" />
          </div>
          <div className={cn("min-w-0 transition-opacity duration-150", sidebarCollapsed && "sr-only")}>
            <p className="text-[15px] font-black leading-tight tracking-tight">Central</p>
            <p className="text-[15px] font-black leading-tight tracking-tight">Operacional</p>
          </div>
        </div>

        <div className={cn("flex items-center px-3.5 py-2.5", sidebarCollapsed ? "justify-center" : "justify-between")}>
          <span className={cn("app-sidebar-label text-[10.5px] font-extrabold uppercase tracking-[0.2em]", sidebarCollapsed && "sr-only")}>Menu</span>
          <button
            type="button"
            onClick={toggleSidebar}
            className="app-sidebar-action grid h-8 w-8 place-items-center rounded-lg transition"
            aria-label={sidebarCollapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
            aria-expanded={!sidebarCollapsed}
            title={sidebarCollapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
          >
            <Menu className="h-4 w-4" />
          </button>
        </div>

        <nav className={cn("sidebar-scroll flex-1 overflow-y-auto pb-3", sidebarCollapsed ? "space-y-0.5 px-2.5" : "space-y-2 px-2")}>
          {sidebarCollapsed ? (
            navItems.map(renderCollapsedNavLink)
          ) : (
            navSections.map((section) => {
              const isOpen = navSectionIsOpen(section);
              const hasActiveItem = section.items.some(navItemIsActive);
              return (
                <div key={section.label} className="space-y-1">
                  <button
                    type="button"
                    onClick={() => toggleNavSection(section.label)}
                    className={cn(
                      "app-sidebar-action flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-[10px] font-black uppercase tracking-[0.16em] transition",
                      hasActiveItem && "text-blue-700 dark:text-blue-200"
                    )}
                    aria-expanded={isOpen}
                  >
                    <span className="truncate">{section.label}</span>
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !isOpen && "-rotate-90")} />
                  </button>
                  {isOpen ? <div className="space-y-0.5">{section.items.map(renderDesktopNavLink)}</div> : null}
                </div>
              );
            })
          )}
        </nav>

        {isCollaborator ? <div className={cn("app-sidebar-divider border-t p-2.5", sidebarCollapsed && "hidden")}>
          <div className="app-sidebar-help rounded-xl border p-2.5">
            <p className="text-[12.5px] font-semibold">Precisa de ajuda?</p>
            <p className="app-sidebar-help-muted mt-1 text-[11.5px] leading-4">
              Fale com o RH ou supervisor.
            </p>
          </div>
        </div> : null}
      </aside>

      <div
        className={cn("fixed inset-0 z-[70] lg:hidden", mobileMenuOpen ? "pointer-events-auto" : "pointer-events-none")}
        aria-hidden={!mobileMenuOpen}
      >
        <button
          type="button"
          aria-label="Fechar menu lateral"
          onClick={closeMobileMenu}
          className={cn(
            "absolute inset-0 bg-navy-950/55 opacity-0 backdrop-blur-[2px] transition-opacity duration-200",
            mobileMenuOpen && "opacity-100"
          )}
        />
        <aside
          id="mobile-sidebar"
          role="dialog"
          aria-modal="true"
          aria-label="Menu lateral"
          className={cn(
            "app-sidebar fixed inset-y-0 left-0 z-[80] flex h-[100dvh] w-[284px] max-w-[86vw] flex-col border-r shadow-2xl transition-transform duration-200",
            mobileMenuOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <div className="app-sidebar-divider flex h-16 items-center justify-between gap-3 border-b px-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="app-sidebar-brand-icon grid h-8 w-8 place-items-center rounded-xl ring-1 ring-white/45">
                <Sparkles className="h-[18px] w-[18px]" />
              </div>
              <div className="min-w-0">
                <p className="text-[15px] font-black leading-tight tracking-tight">Central</p>
                <p className="text-[15px] font-black leading-tight tracking-tight">Operacional</p>
              </div>
            </div>
            <button
              type="button"
              onClick={closeMobileMenu}
              className="app-sidebar-action grid h-9 w-9 shrink-0 place-items-center rounded-lg transition"
              aria-label="Fechar menu lateral"
            >
              ×
            </button>
          </div>

          <nav className="sidebar-scroll flex-1 space-y-2 overflow-y-auto px-2.5 py-3">
            {navSections.map((section) => {
              const isOpen = navSectionIsOpen(section);
              const hasActiveItem = section.items.some(navItemIsActive);
              return (
                <div key={section.label} className="space-y-1">
                  <button
                    type="button"
                    onClick={() => toggleNavSection(section.label)}
                    className={cn(
                      "app-sidebar-action flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[11px] font-black uppercase tracking-[0.16em] transition",
                      hasActiveItem && "text-blue-700 dark:text-blue-200"
                    )}
                    aria-expanded={isOpen}
                  >
                    <span className="truncate">{section.label}</span>
                    <ChevronDown className={cn("h-4 w-4 transition-transform", !isOpen && "-rotate-90")} />
                  </button>
                  {isOpen ? <div className="space-y-1">{section.items.map(renderMobileNavLink)}</div> : null}
                </div>
              );
            })}
          </nav>

          {isCollaborator ? (
            <div className="app-sidebar-divider border-t p-3">
              <div className="app-sidebar-help rounded-xl border p-3">
                <p className="text-[12.5px] font-semibold">Precisa de ajuda?</p>
                <p className="app-sidebar-help-muted mt-1 text-[11.5px] leading-4">
                  Fale com o RH ou supervisor.
                </p>
              </div>
            </div>
          ) : null}
        </aside>
      </div>

      <main className="min-h-screen min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border/80 bg-white/94 px-4 text-navy-900 shadow-[0_8px_24px_rgba(7,27,58,0.035)] backdrop-blur-xl dark:bg-slate-950/86 dark:text-slate-100 dark:shadow-none md:px-5">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="premium-control grid h-9 w-9 place-items-center text-navy-900 lg:hidden"
              aria-label="Abrir menu lateral"
              aria-controls="mobile-sidebar"
              aria-expanded={mobileMenuOpen}
            >
              <Menu className="h-5 w-5" />
            </button>
            <div ref={searchRef} className="relative hidden w-full max-w-[440px] md:block">
              <div className="premium-control flex h-9 w-full items-center gap-2.5 px-3 text-muted">
                <Search className="h-4 w-4 shrink-0" />
              <input
                value={globalSearch}
                onChange={(event) => {
                  setGlobalSearch(event.target.value);
                  setGlobalSearchOpen(true);
                }}
                onFocus={() => setGlobalSearchOpen(true)}
                className="w-full border-0 bg-transparent text-sm outline-none"
                placeholder="Pesquisar pessoas, cronogramas, solicitações..."
              />
              </div>
              {globalSearchOpen && globalSearch.trim().length >= 2 ? (
                <div className="absolute left-0 top-11 z-50 w-full overflow-hidden rounded-2xl border border-border bg-white shadow-2xl shadow-navy-950/15 dark:bg-slate-950 dark:shadow-none">
                  {globalSearchLoading ? (
                    <div className="px-4 py-3 text-sm font-bold text-blue-700">Buscando colaboradores...</div>
                  ) : globalSearchResults.length ? (
                    <div className="max-h-[360px] overflow-y-auto p-1.5">
                      {globalSearchResults.map((result) => (
                        <button
                          key={`${result.type}-${result.id}`}
                          type="button"
                          onClick={() => openSearchResult(result)}
                          className="flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-blue-50 dark:hover:bg-blue-500/10"
                        >
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-600 text-xs font-black text-white">
                            {result.avatarInitials || result.name.slice(0, 2).toUpperCase()}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-black text-navy-950 dark:text-slate-100">{result.name}</span>
                            <span className="block truncate text-xs font-semibold text-muted">
                              {result.wbLogin} • {result.jobTitle || "Sem cargo"} • {result.lob || "Sem LOB"} • {result.status || "Sem status"}
                            </span>
                          </span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-blue-500" />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-4 text-sm font-semibold text-muted">Nenhum resultado encontrado.</div>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
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
                <div className="absolute right-0 top-11 z-50 w-[340px] overflow-hidden rounded-2xl border border-border bg-white shadow-2xl shadow-navy-950/15 dark:bg-slate-950 dark:shadow-none">
                  <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <div>
                      <p className="text-sm font-black text-navy-950 dark:text-slate-100">Notificações</p>
                      <p className="text-xs text-muted">{unreadNotifications} não lida(s)</p>
                    </div>
                    <button onClick={markAllNotificationsRead} className="rounded-lg px-3 py-1.5 text-xs font-extrabold text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-500/10">
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
                          className="mb-2 block rounded-xl border border-transparent p-3 text-left transition hover:border-border hover:bg-surface dark:hover:bg-blue-500/10"
                        >
                          <div className="flex items-start gap-3">
                            <span className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-full", notification.isRead ? "bg-slate-300" : "bg-blue-600")} />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-extrabold text-navy-950 dark:text-slate-100">{notification.title}</p>
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
              <div className="relative grid h-9 w-9 place-items-center rounded-full border border-border bg-gradient-to-b from-slate-50 to-slate-100 text-navy-900 shadow-soft dark:from-slate-900 dark:to-slate-800 dark:text-slate-100 dark:shadow-none">
                <UserCircle className="h-6 w-6 text-slate-400" />
                <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-success dark:border-slate-950" />
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
    TI: "Logística / TI",
    CLIENT: "Cliente"
  };
  return labels[role] ?? role;
}
