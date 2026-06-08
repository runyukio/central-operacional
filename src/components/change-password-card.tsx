"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole, Mail } from "lucide-react";

type FieldErrors = Record<string, string>;

type Props = {
  initialEmail?: string | null;
  showEmail?: boolean;
  forceMode?: boolean;
  onCancel?: () => void;
  onSuccess?: (email: string) => void;
};

export function ChangePasswordCard({ initialEmail = "", showEmail = true, forceMode = false, onCancel, onSuccess }: Props) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [submitError, setSubmitError] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    setSubmitError(false);
    setFieldErrors({});
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: showEmail ? email : undefined,
          currentPassword,
          newPassword,
          confirmPassword
        })
      });
      const payload = await response.json() as {
        success?: boolean;
        message?: string;
        error?: string;
        fieldErrors?: FieldErrors;
        fields?: FieldErrors;
        email?: string;
        defaultPath?: string;
      };
      if (!response.ok) {
        setFieldErrors(payload.fieldErrors ?? payload.fields ?? {});
        setSubmitError(true);
        setMessage(payload.error ?? payload.message ?? "Não foi possível alterar a senha. Tente novamente.");
        return;
      }
      setSubmitError(false);
      setMessage(forceMode ? payload.message ?? "Senha alterada com sucesso." : "Senha alterada com sucesso. Faça login com sua nova senha.");
      if (forceMode) {
        const login = await signIn("credentials", {
          email: payload.email ?? email,
          password: newPassword,
          redirect: false,
          callbackUrl: payload.defaultPath ?? "/"
        });
        router.push(login?.url ?? payload.defaultPath ?? "/");
        router.refresh();
        return;
      }
      onSuccess?.(payload.email ?? email);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card p-7">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-navy-950">Alterar senha</h2>
          <p className="mt-1 text-sm font-medium text-muted">
            {forceMode ? "Você está usando uma senha temporária. Crie uma nova senha para continuar." : "Use seu e-mail e senha atual para definir uma nova senha."}
          </p>
        </div>
        <div className="grid h-11 w-11 place-items-center rounded-xl bg-blue-50 text-blue-600">
          <LockKeyhole className="h-5 w-5" />
        </div>
      </div>
      <form onSubmit={submit} className="space-y-4">
        {showEmail ? (
          <PasswordField
            label="E-mail"
            type="email"
            value={email}
            onChange={setEmail}
            error={fieldErrors.email}
            icon={<Mail className="h-4 w-4 text-muted" />}
            autoComplete="off"
          />
        ) : null}
        <PasswordField
          label="Senha atual"
          type="password"
          value={currentPassword}
          onChange={setCurrentPassword}
          error={fieldErrors.currentPassword}
          icon={<LockKeyhole className="h-4 w-4 text-muted" />}
          autoComplete="current-password"
        />
        <PasswordField
          label="Nova senha"
          type="password"
          value={newPassword}
          onChange={setNewPassword}
          error={fieldErrors.newPassword}
          icon={<LockKeyhole className="h-4 w-4 text-muted" />}
          autoComplete="new-password"
        />
        <PasswordField
          label="Confirmar nova senha"
          type="password"
          value={confirmPassword}
          onChange={setConfirmPassword}
          error={fieldErrors.confirmPassword}
          icon={<LockKeyhole className="h-4 w-4 text-muted" />}
          autoComplete="new-password"
        />
        {message ? <p className={`rounded-lg px-3 py-2 text-sm font-bold ${submitError || Object.keys(fieldErrors).length ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-700"}`}>{message}</p> : null}
        <div className="grid gap-2 sm:grid-cols-2">
          <button disabled={loading} className="premium-button flex h-12 items-center justify-center gap-2 text-sm font-extrabold disabled:opacity-70">
            {loading ? "Salvando..." : "Salvar senha"}
            <ArrowRight className="h-4 w-4" />
          </button>
          {onCancel ? (
            <button type="button" disabled={loading} onClick={onCancel} className="h-12 rounded-lg border border-blue-200 bg-blue-50 text-sm font-extrabold text-blue-700 disabled:opacity-70">
              Voltar
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}

function PasswordField({ label, value, onChange, type, error, icon, autoComplete }: { label: string; value: string; onChange: (value: string) => void; type: string; error?: string; icon: React.ReactNode; autoComplete: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-extrabold uppercase tracking-wide text-muted">{label}</span>
      <div className={`premium-control flex h-12 items-center gap-3 px-3 ${error ? "border-red-300 bg-red-50/40" : ""}`}>
        {icon}
        <input value={value} onChange={(event) => onChange(event.target.value)} className="w-full outline-none" type={type} autoComplete={autoComplete} />
      </div>
      {error ? <span className="mt-1 block text-xs font-bold text-red-600">{error}</span> : null}
    </label>
  );
}
