"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole, Mail, Sparkles } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl: "/central-operacional"
    });
    setLoading(false);
    if (result?.error) {
      setError("E-mail ou senha inválidos.");
      return;
    }
    router.push(result?.url ?? "/central-operacional");
    router.refresh();
  }

  return (
    <main className="grid min-h-screen bg-[radial-gradient(circle_at_78%_8%,rgba(37,99,235,.12),transparent_28rem),#F6F8FC] lg:grid-cols-[minmax(0,1fr)_560px]">
      <section className="relative hidden overflow-hidden bg-[radial-gradient(circle_at_18%_18%,rgba(37,99,235,.14),transparent_20rem),linear-gradient(135deg,#FFFFFF_0%,#F6F8FC_48%,#EAF1FF_100%)] text-navy-950 lg:block">
        <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,.9),rgba(255,255,255,.35)),radial-gradient(circle_at_84%_82%,rgba(37,99,235,.18),transparent_26rem)]" />
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
                    autoComplete="off"
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
              {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{error}</p> : null}
              <button disabled={loading} className="premium-button flex h-12 w-full items-center justify-center gap-2 text-sm font-extrabold disabled:opacity-70">
                {loading ? "Entrando..." : "Entrar"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
            <Link href="/cadastro-colaborador" className="mt-4 flex h-11 w-full items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-sm font-extrabold text-blue-700">
              Criar cadastro
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
