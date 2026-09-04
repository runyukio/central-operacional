"use client";

import { ArrowRight, HelpCircle, LockKeyhole, Mail, UserRound } from "lucide-react";
import { useState } from "react";

import { SECURITY_QUESTIONS } from "@/lib/security-question";

type Props = { initialEmail?: string; onCancel: () => void; onSuccess: (email: string) => void };
type FieldErrors = Record<string, string>;

export function PasswordRecoveryCard({ initialEmail = "", onCancel, onSuccess }: Props) {
  const [form, setForm] = useState({ email: initialEmail, wbLogin: "", question: "", answer: "", newPassword: "", confirmPassword: "" });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  function update(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setMessage("");
    setFieldErrors({});
    try {
      const response = await fetch("/api/auth/recover-password", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form)
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; message?: string; fields?: FieldErrors; fieldErrors?: FieldErrors; email?: string };
      if (!response.ok) {
        setFieldErrors(payload.fields ?? payload.fieldErrors ?? {});
        setMessage(payload.error ?? payload.message ?? "Não foi possível redefinir a senha.");
        return;
      }
      onSuccess(payload.email ?? form.email);
    } catch {
      setMessage("Não foi possível redefinir a senha agora. Verifique sua conexão e tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return <div className="card max-h-[calc(100vh-2rem)] overflow-y-auto p-7">
    <div className="mb-5 flex items-start gap-3 pr-8">
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600"><HelpCircle className="h-5 w-5" /></div>
      <div>
        <h2 id="password-recovery-title" className="text-2xl font-black tracking-tight text-navy-950">Redefinir senha</h2>
        <p className="mt-1 text-sm font-medium text-muted">Informe seu WB, e-mail e a pergunta cadastrada em Meus Dados.</p>
      </div>
    </div>
    <form onSubmit={submit} className="space-y-3">
      <RecoveryField name="wbLogin" label="WB/Login" value={form.wbLogin} onChange={(value) => update("wbLogin", value)} error={fieldErrors.wbLogin} autoComplete="username" icon={<UserRound className="h-4 w-4" />} />
      <RecoveryField name="email" label="E-mail" type="email" value={form.email} onChange={(value) => update("email", value)} error={fieldErrors.email} autoComplete="email" icon={<Mail className="h-4 w-4" />} />
      <label className="block">
        <span className="mb-1.5 block text-[12px] font-extrabold uppercase tracking-wide text-muted">Pergunta de segurança</span>
        <select name="question" required aria-invalid={Boolean(fieldErrors.question)} value={form.question} onChange={(event) => update("question", event.target.value)} className={`premium-control h-12 w-full px-3 text-sm outline-none ${fieldErrors.question ? "border-red-300 bg-red-50/40" : ""}`}>
          <option value="">Selecione a pergunta que você cadastrou</option>
          {SECURITY_QUESTIONS.map((question) => <option key={question.value} value={question.value}>{question.label}</option>)}
        </select>
        {fieldErrors.question ? <span className="mt-1 block text-xs font-bold text-red-600">{fieldErrors.question}</span> : null}
      </label>
      <RecoveryField name="answer" label="Resposta" type="password" value={form.answer} onChange={(value) => update("answer", value)} error={fieldErrors.answer} autoComplete="off" icon={<HelpCircle className="h-4 w-4" />} />
      <RecoveryField name="newPassword" label="Nova senha" type="password" value={form.newPassword} onChange={(value) => update("newPassword", value)} error={fieldErrors.newPassword} autoComplete="new-password" icon={<LockKeyhole className="h-4 w-4" />} />
      <RecoveryField name="confirmPassword" label="Confirmar nova senha" type="password" value={form.confirmPassword} onChange={(value) => update("confirmPassword", value)} error={fieldErrors.confirmPassword} autoComplete="new-password" icon={<LockKeyhole className="h-4 w-4" />} />
      {message ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{message}</p> : null}
      <p className="text-xs font-semibold leading-5 text-muted">Por segurança, os dados incorretos recebem a mesma mensagem e tentativas excessivas são temporariamente bloqueadas.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <button disabled={loading} className="premium-button flex h-12 items-center justify-center gap-2 text-sm font-extrabold disabled:opacity-60">{loading ? "Validando..." : "Redefinir senha"}<ArrowRight className="h-4 w-4" /></button>
        <button type="button" disabled={loading} onClick={onCancel} className="h-12 rounded-lg border border-border text-sm font-extrabold text-navy-950 disabled:opacity-60">Voltar</button>
      </div>
    </form>
  </div>;
}

function RecoveryField({ name, label, value, onChange, error, type = "text", autoComplete, icon }: {
  name: string; label: string; value: string; onChange: (value: string) => void; error?: string; type?: string; autoComplete: string; icon: React.ReactNode;
}) {
  return <label className="block">
    <span className="mb-1.5 block text-[12px] font-extrabold uppercase tracking-wide text-muted">{label}</span>
    <div className={`premium-control flex h-12 items-center gap-3 px-3 ${error ? "border-red-300 bg-red-50/40" : ""}`}>
      <span className="text-muted">{icon}</span>
      <input name={name} required aria-invalid={Boolean(error)} type={type} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} className="w-full outline-none" />
    </div>
    {error ? <span className="mt-1 block text-xs font-bold text-red-600">{error}</span> : null}
  </label>;
}
