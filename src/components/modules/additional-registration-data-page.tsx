"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Coins, ShieldCheck, UserCircle } from "lucide-react";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";
import { SECURITY_QUESTIONS } from "@/lib/security-question";
import { cn } from "@/lib/utils";
import { getPixKeyFormatHint, PIX_KEY_TYPES, validatePixKey } from "@/lib/pix-key";
import { AdditionalRegistrationDataForm, AdditionalRegistrationDataResponse, ApiRequestError, FormInput, FormSelect, apiJson, formatPixKeyInputValue, getPixInputProps, pcdDisabilityTypeOptions } from './shared';
type SecurityQuestionResponse = {
  data: { configured: boolean; question: string; questionLabel: string };
  message?: string;
};


const additionalDataEmptyForm: AdditionalRegistrationDataForm = {
  ethnicity: "",
  sexualOrientation: "",
  isPcd: "",
  pcdDisabilityType: "",
  pcdDisabilityOther: "",
  firstJob: "",
  hasTelemarketingExperience: "",
  telemarketingWhere: "",
  pixKeyType: "",
  pixKey: ""
};


const pixKeyTypeOptions = ["", ...PIX_KEY_TYPES];


export function AdditionalRegistrationDataPage() {
  const [form, setForm] = useState<AdditionalRegistrationDataForm>(additionalDataEmptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [completedAt, setCompletedAt] = useState("");
  const [profileName, setProfileName] = useState("");
  const [pixConfirmationOpen, setPixConfirmationOpen] = useState(false);
  const [pixAcknowledged, setPixAcknowledged] = useState(false);
  const [securityForm, setSecurityForm] = useState({ question: "", answer: "", currentPassword: "" });
  const [securityConfigured, setSecurityConfigured] = useState(false);
  const [securityLoading, setSecurityLoading] = useState(true);
  const [securitySaving, setSecuritySaving] = useState(false);
  const [securityMessage, setSecurityMessage] = useState("");
  const [securityMessageTone, setSecurityMessageTone] = useState<"success" | "error">("success");
  const [securityErrors, setSecurityErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    void loadAdditionalData();
    void loadSecurityQuestion();
  }, []);

  async function loadSecurityQuestion() {
    setSecurityLoading(true);
    setSecurityMessage("");
    try {
      const payload = await apiJson<SecurityQuestionResponse>("/api/auth/security-question");
      setSecurityConfigured(payload.data.configured);
      setSecurityForm({ question: payload.data.question ?? "", answer: "", currentPassword: "" });
    } catch (error) {
      setSecurityMessageTone("error");
      setSecurityMessage(error instanceof Error ? error.message : "Não foi possível carregar a pergunta de segurança.");
    } finally {
      setSecurityLoading(false);
    }
  }

  function updateSecurityField(field: keyof typeof securityForm, value: string) {
    setSecurityForm((current) => ({ ...current, [field]: value }));
    setSecurityErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function saveSecurityQuestion() {
    if (securitySaving) return;
    const errors: Record<string, string> = {};
    if (!securityForm.question) errors.question = "Selecione uma pergunta.";
    if (!securityForm.answer.trim()) errors.answer = "Informe a resposta de segurança.";
    if (!securityForm.currentPassword) errors.currentPassword = "Informe sua senha atual.";
    if (Object.keys(errors).length) {
      setSecurityErrors(errors);
      setSecurityMessageTone("error");
      setSecurityMessage("Revise os dados de recuperação de senha.");
      return;
    }
    setSecuritySaving(true);
    setSecurityMessage("");
    setSecurityErrors({});
    try {
      const payload = await apiJson<SecurityQuestionResponse>("/api/auth/security-question", {
        method: "PUT", body: JSON.stringify(securityForm)
      });
      setSecurityConfigured(true);
      setSecurityForm({ question: payload.data.question, answer: "", currentPassword: "" });
      setSecurityMessageTone("success");
      setSecurityMessage(payload.message ?? "Pergunta de segurança atualizada com sucesso.");
    } catch (error) {
      setSecurityMessageTone("error");
      if (error instanceof ApiRequestError) {
        setSecurityErrors(error.fields ?? {});
        setSecurityMessage(error.message);
      } else {
        setSecurityMessage(error instanceof Error ? error.message : "Não foi possível salvar a pergunta de segurança.");
      }
    } finally {
      setSecuritySaving(false);
    }
  }

  async function loadAdditionalData() {
    setLoading(true);
    setMessage("");
    try {
      const payload = await apiJson<AdditionalRegistrationDataResponse>("/api/employee-additional-data");
      setForm({
        ethnicity: payload.data.profile.ethnicity ?? "",
        sexualOrientation: payload.data.profile.sexualOrientation ?? "",
        isPcd: payload.data.profile.isPcd ?? "",
        pcdDisabilityType: payload.data.profile.pcdDisabilityType ?? "",
        pcdDisabilityOther: payload.data.profile.pcdDisabilityOther ?? "",
        firstJob: payload.data.profile.firstJob ?? "",
        hasTelemarketingExperience: payload.data.profile.hasTelemarketingExperience ?? "",
        telemarketingWhere: payload.data.profile.telemarketingWhere ?? "",
        pixKeyType: payload.data.profile.pixKeyType ?? "",
        pixKey: payload.data.profile.pixKey ?? ""
      });
      setCompletedAt(payload.data.profile.additionalDataCompletedAt ?? "");
      setProfileName(payload.data.profile.name ?? "");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível carregar seus dados cadastrais adicionais.");
    } finally {
      setLoading(false);
    }
  }

  function updateAdditionalDataField<K extends keyof AdditionalRegistrationDataForm>(field: K, value: AdditionalRegistrationDataForm[K]) {
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[field];
      if (field === "pixKeyType") delete next.pixKey;
      return next;
    });
    setForm((current) => {
      if (field === "pixKey") {
        return { ...current, pixKey: formatPixKeyInputValue(current.pixKeyType, String(value)) };
      }
      if (field === "pixKeyType") {
        const pixKeyType = String(value);
        return { ...current, pixKeyType, pixKey: formatPixKeyInputValue(pixKeyType, current.pixKey) };
      }
      return { ...current, [field]: value };
    });
  }

  function validatePixBeforeConfirmation() {
    const errors: Record<string, string> = {};
    const pixValidation = validatePixKey(form.pixKeyType, form.pixKey);
    if (!pixValidation.valid) {
      errors[pixValidation.field ?? "pixKey"] = pixValidation.message ?? "Chave PIX inválida.";
    }
    if (Object.keys(errors).length) {
      setFieldErrors((current) => ({ ...current, ...errors }));
      setMessage("Revise os campos obrigatórios de pagamento.");
      return false;
    }
    setForm((current) => ({
      ...current,
      pixKeyType: pixValidation.pixKeyType,
      pixKey: pixValidation.normalizedValue
    }));
    return true;
  }

  function openPixConfirmation() {
    if (saving) return;
    setMessage("");
    if (!validatePixBeforeConfirmation()) return;
    setPixAcknowledged(false);
    setPixConfirmationOpen(true);
  }

  async function submitAdditionalData() {
    if (saving) return;
    if (!pixAcknowledged) {
      setFieldErrors((current) => ({ ...current, pixAcknowledgement: "Confirme que está ciente antes de salvar." }));
      return;
    }
    setSaving(true);
    setMessage("");
    setFieldErrors({});
    try {
      const payload = await apiJson<AdditionalRegistrationDataResponse>("/api/employee-additional-data", {
        method: "POST",
        body: JSON.stringify(form)
      });
      setMessage(payload.message ?? "Dados cadastrais adicionais atualizados com sucesso.");
      setCompletedAt(payload.data.profile.additionalDataCompletedAt ?? "");
      setForm({
        ethnicity: payload.data.profile.ethnicity ?? "",
        sexualOrientation: payload.data.profile.sexualOrientation ?? "",
        isPcd: payload.data.profile.isPcd ?? "",
        pcdDisabilityType: payload.data.profile.pcdDisabilityType ?? "",
        pcdDisabilityOther: payload.data.profile.pcdDisabilityOther ?? "",
        firstJob: payload.data.profile.firstJob ?? "",
        hasTelemarketingExperience: payload.data.profile.hasTelemarketingExperience ?? "",
        telemarketingWhere: payload.data.profile.telemarketingWhere ?? "",
        pixKeyType: payload.data.profile.pixKeyType ?? "",
        pixKey: payload.data.profile.pixKey ?? ""
      });
      setPixConfirmationOpen(false);
      setPixAcknowledged(false);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setFieldErrors(error.fields ?? {});
        setMessage(error.message);
        setPixConfirmationOpen(false);
      } else {
        setMessage(error instanceof Error ? error.message : "Não foi possível salvar seus dados cadastrais adicionais.");
        setPixConfirmationOpen(false);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Dados Cadastrais Adicionais"
        description="Atualize sua Chave PIX, dados complementares e recuperação de senha."
        icon={UserCircle}
      />
      {message ? <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">{message}</div> : null}
      {loading ? (
        <Panel title="Carregando">
          <EmptyState title="Carregando seus dados" description="Buscando seu cadastro vinculado ao usuário logado." />
        </Panel>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Panel title="Questionário">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <div className="rounded-xl border border-blue-100 bg-blue-50/55 p-4">
                  <div className="mb-3 flex items-start gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-blue-600 shadow-soft">
                      <Coins className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-black text-navy-950">Dados de pagamento</h3>
                      <p className="mt-1 text-xs font-semibold leading-5 text-muted">Mantenha sua Chave PIX atualizada para evitar impactos no processamento do pagamento.</p>
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <FormSelect label="Tipo da Chave PIX" value={form.pixKeyType} options={pixKeyTypeOptions} onChange={(value) => updateAdditionalDataField("pixKeyType", value)} error={fieldErrors.pixKeyType} emptyLabel="Selecione" />
                    <div>
                      <FormInput label="Chave PIX" value={form.pixKey} onChange={(value) => updateAdditionalDataField("pixKey", value)} error={fieldErrors.pixKey} {...getPixInputProps(form.pixKeyType)} />
                      <p className="mt-1 text-xs font-semibold text-muted">{getPixKeyFormatHint(form.pixKeyType)}</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="md:col-span-2">
                <div className="rounded-xl border border-violet-100 bg-violet-50/55 p-4">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-violet-600 shadow-soft">
                        <ShieldCheck className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-black text-navy-950">Recuperação de senha</h3>
                        <p className="mt-1 text-xs font-semibold leading-5 text-muted">
                          Escolha uma pergunta e uma resposta que somente você saiba. Elas serão usadas caso você esqueça sua senha.
                        </p>
                      </div>
                    </div>
                    <span className={cn(
                      "rounded-full px-3 py-1 text-xs font-extrabold",
                      securityConfigured ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                    )}>
                      {securityLoading ? "Carregando..." : securityConfigured ? "Configurada" : "Não configurada"}
                    </span>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="md:col-span-2">
                      <FormSelect
                        label="Pergunta de segurança"
                        value={securityForm.question}
                        options={["", ...SECURITY_QUESTIONS.map((question) => question.value)]}
                        optionLabel={(value) => SECURITY_QUESTIONS.find((question) => question.value === value)?.label ?? value}
                        onChange={(value) => updateSecurityField("question", value)}
                        error={securityErrors.question}
                        emptyLabel="Selecione uma pergunta"
                        disabled={securityLoading || securitySaving}
                      />
                    </div>
                    <FormInput
                      label={securityConfigured ? "Nova resposta" : "Resposta"}
                      type="password"
                      value={securityForm.answer}
                      onChange={(value) => updateSecurityField("answer", value)}
                      error={securityErrors.answer}
                      helper="Maiúsculas e espaços extras não alteram a validação."
                      maxLength={128}
                      autoComplete="new-password"
                      disabled={securityLoading || securitySaving}
                    />
                    <FormInput
                      label="Senha atual para confirmar"
                      type="password"
                      value={securityForm.currentPassword}
                      onChange={(value) => updateSecurityField("currentPassword", value)}
                      error={securityErrors.currentPassword}
                      maxLength={128}
                      autoComplete="current-password"
                      disabled={securityLoading || securitySaving}
                    />
                  </div>
                  {securityMessage ? (
                    <p role="status" className={cn(
                      "mt-3 rounded-lg px-3 py-2 text-xs font-bold",
                      securityMessageTone === "success"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-red-50 text-red-600"
                    )}>
                      {securityMessage}
                    </p>
                  ) : null}
                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      disabled={securityLoading || securitySaving}
                      onClick={() => void saveSecurityQuestion()}
                      className="rounded-lg bg-violet-600 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {securitySaving ? "Salvando..." : securityConfigured ? "Atualizar recuperação" : "Configurar recuperação"}
                    </button>
                  </div>
                </div>
              </div>
              <FormSelect label="Etnia" value={form.ethnicity} options={["", "Branca", "Preta", "Parda", "Amarela", "Indígena", "Prefiro não informar"]} onChange={(value) => updateAdditionalDataField("ethnicity", value)} error={fieldErrors.ethnicity} />
              <FormSelect label="Orientação sexual" value={form.sexualOrientation} options={["", "Heterossexual", "Homossexual", "Bissexual", "Assexual", "Outra", "Prefiro não informar"]} onChange={(value) => updateAdditionalDataField("sexualOrientation", value)} error={fieldErrors.sexualOrientation} />
              <FormSelect label="É PCD?" value={form.isPcd} options={["", "Sim", "Não", "Prefiro não informar"]} onChange={(value) => {
                updateAdditionalDataField("isPcd", value);
                if (value !== "Sim") {
                  updateAdditionalDataField("pcdDisabilityType", "");
                  updateAdditionalDataField("pcdDisabilityOther", "");
                }
              }} error={fieldErrors.isPcd} />
              {form.isPcd === "Sim" ? (
                <FormSelect label="Tipo de deficiência" value={form.pcdDisabilityType} options={pcdDisabilityTypeOptions} onChange={(value) => {
                  updateAdditionalDataField("pcdDisabilityType", value);
                  if (value !== "Outra") updateAdditionalDataField("pcdDisabilityOther", "");
                }} error={fieldErrors.pcdDisabilityType} />
              ) : null}
              {form.isPcd === "Sim" && form.pcdDisabilityType === "Outra" ? (
                <FormInput label="Especifique o tipo de deficiência" value={form.pcdDisabilityOther} onChange={(value) => updateAdditionalDataField("pcdDisabilityOther", value)} error={fieldErrors.pcdDisabilityOther} />
              ) : null}
              <FormSelect label="Primeiro emprego?" value={form.firstJob} options={["", "Sim", "Não"]} onChange={(value) => updateAdditionalDataField("firstJob", value)} error={fieldErrors.firstJob} />
              <FormSelect label="Já trabalhou em telemarketing?" value={form.hasTelemarketingExperience} options={["", "Sim", "Não"]} onChange={(value) => {
                updateAdditionalDataField("hasTelemarketingExperience", value);
                if (value === "Não") updateAdditionalDataField("telemarketingWhere", "Não se aplica");
                if (value === "Sim" && form.telemarketingWhere === "Não se aplica") updateAdditionalDataField("telemarketingWhere", "");
              }} error={fieldErrors.hasTelemarketingExperience} />
              {form.hasTelemarketingExperience === "Sim" ? (
                <FormInput label="Onde trabalhou em telemarketing?" value={form.telemarketingWhere} onChange={(value) => updateAdditionalDataField("telemarketingWhere", value)} error={fieldErrors.telemarketingWhere} />
              ) : null}
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <a href="/minha-escala" className="rounded-lg border border-border px-4 py-3 text-sm font-bold text-navy-950">Voltar</a>
              <button type="button" disabled={saving} onClick={openPixConfirmation} className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-60">
                {saving ? "Salvando..." : "Salvar dados"}
              </button>
            </div>
          </Panel>
          <Panel title="Status">
            <div className="space-y-3 text-sm text-muted">
              <div className="rounded-xl border border-border bg-slate-50 p-3">
                <p className="text-xs font-extrabold uppercase tracking-wide text-muted">Parceiro</p>
                <p className="mt-1 font-black text-navy-950">{profileName || "Cadastro vinculado"}</p>
              </div>
              <div className="rounded-xl border border-border bg-slate-50 p-3">
                <p className="text-xs font-extrabold uppercase tracking-wide text-muted">Atualização</p>
                <p className="mt-1 font-black text-navy-950">{completedAt ? "Concluída" : "Pendente"}</p>
                {completedAt ? <p className="mt-1 text-xs font-semibold text-muted">{completedAt}</p> : null}
              </div>
              <p className="leading-6">
                Esses dados são tratados como sensíveis. Supervisores não visualizam etnia, orientação sexual ou informações de PCD.
              </p>
            </div>
          </Panel>
        </div>
      )}
      {pixConfirmationOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/45 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-border bg-gradient-to-b from-white to-blue-50/70 px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-orange-50 text-orange-600">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-navy-950">Confirmar atualização da Chave PIX</h2>
                  <p className="mt-1 text-sm font-semibold leading-5 text-muted">Confirme os dados antes de salvar.</p>
                </div>
              </div>
              <button type="button" onClick={() => setPixConfirmationOpen(false)} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-slate-100">×</button>
            </div>
            <div className="space-y-4 px-5 py-5">
              <div className="rounded-xl border border-border bg-slate-50 p-4">
                <p className="text-xs font-extrabold uppercase tracking-wide text-muted">Tipo da Chave PIX</p>
                <p className="mt-1 break-words text-sm font-black text-navy-950">{form.pixKeyType || "Não informado"}</p>
                <p className="mt-3 text-xs font-extrabold uppercase tracking-wide text-muted">Chave PIX</p>
                <p className="mt-1 break-words text-sm font-black text-navy-950">{form.pixKey || "Não informada"}</p>
              </div>
              <p className="text-sm font-semibold leading-6 text-navy-950">
                Confirme se a Chave PIX informada está correta. Caso a chave esteja incorreta, inválida ou pertença a outra pessoa, isso pode impactar o processamento do seu pagamento.
              </p>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 p-4">
                <input
                  type="checkbox"
                  checked={pixAcknowledged}
                  onChange={(event) => {
                    setPixAcknowledged(event.target.checked);
                    setFieldErrors((current) => {
                      const next = { ...current };
                      delete next.pixAcknowledgement;
                      return next;
                    });
                  }}
                  className="mt-1 h-4 w-4 rounded border-orange-300 text-blue-600"
                />
                <span className="text-sm font-bold leading-6 text-orange-800">Estou ciente de que a Chave PIX informada é minha responsabilidade e que dados incorretos podem impactar meu pagamento.</span>
              </label>
              {fieldErrors.pixAcknowledgement ? <p className="text-xs font-bold text-red-600">{fieldErrors.pixAcknowledgement}</p> : null}
            </div>
            <div className="flex flex-wrap justify-end gap-3 border-t border-border bg-slate-50 px-5 py-4">
              <button type="button" disabled={saving} onClick={() => setPixConfirmationOpen(false)} className="rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-bold text-navy-950 disabled:opacity-60">Voltar</button>
              <button type="button" disabled={saving || !pixAcknowledged} onClick={() => void submitAdditionalData()} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
                {saving ? "Salvando..." : "Confirmar e salvar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
