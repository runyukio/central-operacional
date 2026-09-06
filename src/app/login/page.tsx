"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole, Mail, Moon, Sparkles, Sun, X } from "lucide-react";

import { PasswordRecoveryCard } from "@/components/password-recovery-card";
import { useTheme } from "@/components/theme-provider";

export default function LoginPage() {
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("reason") === "session-expired") {
      setError("Sua sessão expirou ou foi revogada. Entre novamente para continuar.");
    }
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
        callbackUrl: "/"
      });
      if (!result || result.error) {
        setError(result?.error === "AUTH_RATE_LIMITED" ? "Muitas tentativas. Aguarde 30 minutos antes de tentar novamente." : "E-mail ou senha inválidos.");
        return;
      }
      router.push(result.url ?? "/");
      router.refresh();
    } catch {
      setError("Não foi possível entrar agora. Verifique sua conexão e tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-[radial-gradient(circle_at_78%_8%,rgba(37,99,235,.12),transparent_28rem),#F6F8FC] lg:grid-cols-[minmax(0,1fr)_560px]">
      <div className="fixed right-4 top-4 z-20 flex items-center gap-2">
        <button
          type="button"
          onClick={toggleTheme}
          className="premium-control flex h-10 items-center gap-2 px-3 text-sm font-extrabold text-navy-950 dark:text-slate-100"
          aria-label={theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro"}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          <span className="hidden sm:inline">{theme === "dark" ? "Claro" : "Escuro"}</span>
        </button>
      </div>
      <section className="relative hidden overflow-hidden bg-[radial-gradient(circle_at_18%_18%,rgba(37,99,235,.14),transparent_20rem),linear-gradient(135deg,#FFFFFF_0%,#F6F8FC_48%,#EAF1FF_100%)] text-navy-950 lg:block">
        <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,.9),rgba(255,255,255,.35)),radial-gradient(circle_at_84%_82%,rgba(37,99,235,.18),transparent_26rem)] dark:opacity-0" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-lg shadow-blue-950/25 ring-1 ring-white/40">
              <Sparkles className="h-7 w-7" />
            </div>
            <div>
              <p className="text-2xl font-extrabold leading-tight">Central</p>
              <p className="text-2xl font-extrabold leading-tight">Operacional</p>
            </div>
          </div>
          <div className="max-w-xl">
            <p className="text-xs font-black uppercase tracking-[0.24em] text-blue-700">Command Center</p>
            <h1 className="mt-4 text-5xl font-black leading-tight tracking-tight">Operação, pessoas e indicadores em um único lugar.</h1>
          </div>
          <div className="h-1 w-24 rounded-full bg-blue-500 shadow-lg shadow-blue-600/30" />
        </div>
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-blue-600 text-white">
                <Sparkles className="h-6 w-6" />
              </div>
              <p className="text-xl font-extrabold text-navy-950">Central Operacional</p>
            </div>
          </div>
          <div className="card p-7">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-black tracking-tight text-navy-950">Entrar</h2>
                <p className="mt-1 text-sm font-medium text-muted">Digite suas credenciais internas.</p>
              </div>
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-blue-50 text-blue-600">
                <LockKeyhole className="h-5 w-5" />
              </div>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-extrabold uppercase tracking-wide text-muted">E-mail</span>
                <div className="premium-control flex h-12 items-center gap-3 px-3">
                  <Mail className="h-4 w-4 text-muted" />
                  <input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="w-full outline-none"
                    type="email"
                    name="loginEmail"
                    autoComplete="email"
                  />
                </div>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-extrabold uppercase tracking-wide text-muted">Senha</span>
                <div className="premium-control flex h-12 items-center gap-3 px-3">
                  <LockKeyhole className="h-4 w-4 text-muted" />
                  <input
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="w-full outline-none"
                    type="password"
                    name="loginPassword"
                    autoComplete="current-password"
                  />
                </div>
              </label>
              {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p> : null}
              {success ? <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm font-bold text-blue-700">{success}</p> : null}
              <button disabled={loading} className="premium-button flex h-12 w-full items-center justify-center gap-2 text-sm font-extrabold disabled:opacity-70">
                {loading ? "Entrando..." : "Entrar"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
            <button type="button" onClick={() => setRecoveryOpen(true)}
              className="mt-3 flex h-10 w-full items-center justify-center text-sm font-extrabold text-blue-700 hover:text-blue-800">
              Esqueci minha senha
            </button>
            <Link href="/cadastro-colaborador" className="mt-4 flex h-11 w-full items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-sm font-extrabold text-blue-700">
              Criar cadastro
            </Link>
          </div>
        </div>
      </section>
      <Dialog.Root open={recoveryOpen} onOpenChange={setRecoveryOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-navy-950/40 backdrop-blur-sm" />
          <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 outline-none">
            <Dialog.Title className="sr-only">Redefinir senha</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-slate-100"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
            <PasswordRecoveryCard initialEmail={email} onCancel={() => setRecoveryOpen(false)} onSuccess={(changedEmail) => {
              setEmail(changedEmail);
              setPassword("");
              setError("");
              setSuccess("Senha redefinida com sucesso. Entre usando a nova senha.");
              setRecoveryOpen(false);
            }} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </main>
  );
}
