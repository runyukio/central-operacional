"use client";

import { useState } from "react";
import { CheckCircle2, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { getPixKeyFormatHint, PIX_KEY_TYPES } from "@/lib/pix-key";
import { ApiRequestError, FormInput, FormSelect, InfoLine, RegistrationItem, apiJson, formatPixKeyInputValue, getPixInputProps, pcdDisabilityTypeOptions } from './shared';
const registrationSteps = ["Dados pessoais", "Endereço e contato", "Documentos", "Dados bancários", "Revisão"];


const registrationFieldLabels: Record<string, string> = {
  cnpj: "CNPJ",
  fullName: "Nome completo",
  addressType: "Tipo de endereço",
  addressName: "Endereço",
  addressNumber: "Número",
  complement: "Complemento",
  neighborhood: "Bairro",
  city: "Cidade",
  stateUf: "UF",
  zipCode: "CEP",
  primaryPhone: "Contato principal",
  emergencyPhone: "Contato de emergência",
  emergencyContactName: "Nome do contato de emergência",
  emergencyContactRelationship: "Parentesco",
  birthDate: "Data de nascimento",
  email: "E-mail",
  password: "Senha",
  confirmPassword: "Confirmar senha",
  rg: "RG",
  rgIssuer: "Órgão expedidor e UF",
  cpf: "CPF",
  sex: "Gênero",
  maritalStatus: "Estado civil",
  educationLevel: "Escolaridade",
  ethnicity: "Etnia",
  sexualOrientation: "Orientação sexual",
  isPcd: "É PCD?",
  pcdDisabilityType: "Tipo de deficiência",
  pcdDisabilityOther: "Especifique o tipo de deficiência",
  firstJob: "Primeiro emprego?",
  hasTelemarketingExperience: "Já trabalhou em telemarketing?",
  telemarketingWhere: "Onde trabalhou em telemarketing?",
  bankName: "Banco",
  bankAgency: "Agência",
  bankAccount: "Conta corrente",
  pixKey: "Chave PIX",
  pixKeyType: "Tipo de chave PIX",
  hasChildren: "Tem filhos?",
  childrenCount: "Quantidade de filhos",
  notes: "Observações"
};


export function EmployeeRegistrationPublicPage() {
  const [step, setStep] = useState(0);
  const [submitted, setSubmitted] = useState<RegistrationItem | null>(null);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [savingRegistration, setSavingRegistration] = useState(false);
  const [form, setForm] = useState({
    cnpj: "",
    fullName: "",
    addressType: "Rua",
    addressName: "",
    addressNumber: "",
    complement: "",
    neighborhood: "",
    city: "",
    stateUf: "",
    zipCode: "",
    primaryPhone: "",
    emergencyPhone: "",
    emergencyContactName: "",
    emergencyContactRelationship: "",
    birthDate: "",
    email: "",
    password: "",
    confirmPassword: "",
    rg: "",
    rgIssuer: "",
    cpf: "",
    sex: "Prefiro não informar",
    maritalStatus: "Solteiro(a)",
    educationLevel: "Ensino médio",
    ethnicity: "",
    sexualOrientation: "",
    isPcd: "",
    pcdDisabilityType: "",
    pcdDisabilityOther: "",
    firstJob: "",
    hasTelemarketingExperience: "",
    telemarketingWhere: "",
    bankName: "",
    bankAgency: "",
    bankAccount: "",
    pixKey: "",
    pixKeyType: "CPF",
    socialName: "",
    hasChildren: false,
    childrenCount: 0,
    notes: ""
  });

  function updateField(name: string, value: string | boolean | number) {
    setForm((current) => {
      if (name === "pixKey") return { ...current, pixKey: formatPixKeyInputValue(current.pixKeyType, String(value)) };
      if (name === "pixKeyType") {
        const pixKeyType = String(value);
        return { ...current, pixKeyType, pixKey: formatPixKeyInputValue(pixKeyType, current.pixKey) };
      }
      return { ...current, [name]: value };
    });
    setFieldErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      if (name === "pixKeyType") delete next.pixKey;
      return next;
    });
  }

  async function submitRegistration() {
    setError("");
    setFieldErrors({});
    setSavingRegistration(true);
    try {
      const payload = await apiJson<{ data: RegistrationItem }>("/api/employee-registrations/public", {
        method: "POST",
        body: JSON.stringify(form)
      });
      setSubmitted(payload.data);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setError(err.message);
        setFieldErrors(err.fields ?? {});
      } else {
        setError(err instanceof Error ? err.message : "Não foi possível enviar o cadastro.");
      }
    } finally {
      setSavingRegistration(false);
    }
  }

  const fieldError = (name: string) => fieldErrors[name];
  const fieldErrorEntries = Object.entries(fieldErrors);

  const sections = [
    <div key="personal" className="grid gap-4 md:grid-cols-2">
      <FormInput label="Nome completo" value={form.fullName} error={fieldError("fullName")} onChange={(value) => updateField("fullName", value)} />
      <FormInput label="Nome social (opcional)" value={form.socialName} error={fieldError("socialName")} onChange={(value) => updateField("socialName", value)} />
      <FormInput label="Senha" type="password" value={form.password} error={fieldError("password")} onChange={(value) => updateField("password", value)} />
      <FormInput label="Confirmar senha" type="password" value={form.confirmPassword} error={fieldError("confirmPassword")} onChange={(value) => updateField("confirmPassword", value)} />
      <FormInput label="Data de nascimento" type="date" value={form.birthDate} error={fieldError("birthDate")} onChange={(value) => updateField("birthDate", value)} />
      <FormSelect label="Gênero" value={form.sex} error={fieldError("sex")} options={["Feminino", "Masculino", "Não binário", "Prefiro não informar"]} onChange={(value) => updateField("sex", value)} />
      <FormSelect label="Estado civil" value={form.maritalStatus} error={fieldError("maritalStatus")} options={["Solteiro(a)", "Casado(a)", "Divorciado(a)", "União estável"]} onChange={(value) => updateField("maritalStatus", value)} />
      <FormSelect label="Escolaridade" value={form.educationLevel} error={fieldError("educationLevel")} options={["Ensino médio", "Superior cursando", "Superior completo", "Pós-graduação"]} onChange={(value) => updateField("educationLevel", value)} />
      <FormSelect label="Etnia" value={form.ethnicity} error={fieldError("ethnicity")} options={["", "Branca", "Preta", "Parda", "Amarela", "Indígena", "Prefiro não informar"]} onChange={(value) => updateField("ethnicity", value)} />
      <FormSelect label="Orientação sexual" value={form.sexualOrientation} error={fieldError("sexualOrientation")} options={["", "Heterossexual", "Homossexual", "Bissexual", "Assexual", "Outra", "Prefiro não informar"]} onChange={(value) => updateField("sexualOrientation", value)} />
      <FormSelect label="É PCD?" value={form.isPcd} error={fieldError("isPcd")} options={["", "Sim", "Não", "Prefiro não informar"]} onChange={(value) => {
        updateField("isPcd", value);
        if (value !== "Sim") {
          updateField("pcdDisabilityType", "");
          updateField("pcdDisabilityOther", "");
        }
      }} />
      {form.isPcd === "Sim" ? (
        <FormSelect label="Tipo de deficiência" value={form.pcdDisabilityType} error={fieldError("pcdDisabilityType")} options={pcdDisabilityTypeOptions} onChange={(value) => {
          updateField("pcdDisabilityType", value);
          if (value !== "Outra") updateField("pcdDisabilityOther", "");
        }} />
      ) : null}
      {form.isPcd === "Sim" && form.pcdDisabilityType === "Outra" ? (
        <FormInput label="Especifique o tipo de deficiência" value={form.pcdDisabilityOther} error={fieldError("pcdDisabilityOther")} onChange={(value) => updateField("pcdDisabilityOther", value)} />
      ) : null}
      <FormSelect label="Primeiro emprego?" value={form.firstJob} error={fieldError("firstJob")} options={["", "Sim", "Não"]} onChange={(value) => updateField("firstJob", value)} />
      <FormSelect label="Já trabalhou em telemarketing?" value={form.hasTelemarketingExperience} error={fieldError("hasTelemarketingExperience")} options={["", "Sim", "Não"]} onChange={(value) => {
        updateField("hasTelemarketingExperience", value);
        if (value === "Não") updateField("telemarketingWhere", "Não se aplica");
      }} />
      <FormInput label="Onde trabalhou em telemarketing?" value={form.telemarketingWhere} error={fieldError("telemarketingWhere")} onChange={(value) => updateField("telemarketingWhere", value)} />
      <FormSelect label="Tem filhos?" value={form.hasChildren ? "Sim" : "Não"} error={fieldError("hasChildren")} options={["Não", "Sim"]} onChange={(value) => updateField("hasChildren", value === "Sim")} />
      {form.hasChildren ? <FormInput label="Quantidade de filhos" type="number" value={String(form.childrenCount)} error={fieldError("childrenCount")} onChange={(value) => updateField("childrenCount", Number(value))} /> : null}
    </div>,
    <div key="contact" className="grid gap-4 md:grid-cols-2">
      <FormSelect label="Tipo de endereço" value={form.addressType} error={fieldError("addressType")} options={["Rua", "Avenida", "Alameda"]} onChange={(value) => updateField("addressType", value)} />
      <FormInput label="Endereço" value={form.addressName} error={fieldError("addressName")} onChange={(value) => updateField("addressName", value)} />
      <FormInput label="Número" value={form.addressNumber} error={fieldError("addressNumber")} onChange={(value) => updateField("addressNumber", value)} />
      <FormInput label="Complemento (opcional)" value={form.complement} error={fieldError("complement")} onChange={(value) => updateField("complement", value)} />
      <FormInput label="Bairro" value={form.neighborhood} error={fieldError("neighborhood")} onChange={(value) => updateField("neighborhood", value)} />
      <FormInput label="Cidade" value={form.city} error={fieldError("city")} onChange={(value) => updateField("city", value)} />
      <FormInput label="UF" value={form.stateUf} error={fieldError("stateUf")} onChange={(value) => updateField("stateUf", value.toUpperCase().slice(0, 2))} />
      <FormInput label="CEP" value={form.zipCode} error={fieldError("zipCode")} onChange={(value) => updateField("zipCode", value)} />
      <FormInput label="Contato principal" value={form.primaryPhone} error={fieldError("primaryPhone")} onChange={(value) => updateField("primaryPhone", value)} />
      <FormInput label="Contato de emergência (opcional)" value={form.emergencyPhone} error={fieldError("emergencyPhone")} onChange={(value) => updateField("emergencyPhone", value)} />
      <FormInput label="Nome do contato de emergência (opcional)" value={form.emergencyContactName} error={fieldError("emergencyContactName")} onChange={(value) => updateField("emergencyContactName", value)} />
      <FormInput label="Parentesco (opcional)" value={form.emergencyContactRelationship} error={fieldError("emergencyContactRelationship")} onChange={(value) => updateField("emergencyContactRelationship", value)} />
    </div>,
    <div key="docs" className="grid gap-4 md:grid-cols-2">
      <FormInput label="E-mail" type="email" value={form.email} error={fieldError("email")} onChange={(value) => updateField("email", value)} />
      <FormInput label="CPF" value={form.cpf} error={fieldError("cpf")} onChange={(value) => updateField("cpf", value)} />
      <FormInput label="RG" value={form.rg} error={fieldError("rg")} onChange={(value) => updateField("rg", value)} />
      <FormInput label="Órgão expedidor e UF" value={form.rgIssuer} error={fieldError("rgIssuer")} onChange={(value) => updateField("rgIssuer", value)} />
      <FormInput label="CNPJ" value={form.cnpj} error={fieldError("cnpj")} onChange={(value) => updateField("cnpj", value)} />
    </div>,
    <div key="bank" className="grid gap-4 md:grid-cols-2">
      <FormInput label="Banco" value={form.bankName} error={fieldError("bankName")} onChange={(value) => updateField("bankName", value)} />
      <FormInput label="Agência com dígito" value={form.bankAgency} error={fieldError("bankAgency")} onChange={(value) => updateField("bankAgency", value)} />
      <FormInput label="Conta corrente com dígito" value={form.bankAccount} error={fieldError("bankAccount")} onChange={(value) => updateField("bankAccount", value)} />
      <div>
        <FormInput label="Chave PIX" value={form.pixKey} error={fieldError("pixKey")} onChange={(value) => updateField("pixKey", value)} {...getPixInputProps(form.pixKeyType)} />
        <p className="mt-1 text-xs font-semibold text-muted">{getPixKeyFormatHint(form.pixKeyType)}</p>
      </div>
      <FormSelect label="Tipo de chave PIX" value={form.pixKeyType} error={fieldError("pixKeyType")} options={[...PIX_KEY_TYPES]} onChange={(value) => updateField("pixKeyType", value)} />
      <label className="md:col-span-2">
        <span className="mb-1.5 block text-sm font-bold text-muted">Observações adicionais</span>
        <textarea value={form.notes} onChange={(event) => updateField("notes", event.target.value)} className={cn("min-h-28 w-full rounded-lg border p-3 outline-none", fieldError("notes") ? "border-red-300 bg-red-50/40" : "border-border")} />
        {fieldError("notes") ? <span className="mt-1 block text-xs font-bold text-red-600">{fieldError("notes")}</span> : null}
      </label>
    </div>,
    <div key="review" className="grid gap-4 md:grid-cols-2">
      {[
        ["Nome", form.fullName],
        ["E-mail", form.email],
        ["CPF", form.cpf],
        ["CNPJ", form.cnpj],
        ["Cidade/UF", `${form.city}/${form.stateUf}`],
        ["Gênero", form.sex],
        ["Etnia", form.ethnicity],
        ["Orientação sexual", form.sexualOrientation],
        ["PCD", form.isPcd],
        ...(form.isPcd === "Sim" ? [["Tipo de deficiência", form.pcdDisabilityType], ...(form.pcdDisabilityType === "Outra" ? [["Especificação da deficiência", form.pcdDisabilityOther]] : [])] : []),
        ["Primeiro emprego", form.firstJob],
        ["Telemarketing", form.hasTelemarketingExperience],
        ["PIX principal", `${form.pixKeyType}: ${form.pixKey}`]
      ].map(([label, value]) => (
        <InfoLine key={label} label={label} value={value} />
      ))}
    </div>
  ];

  if (submitted) {
    return (
      <main className="min-h-screen bg-surface p-6">
        <div className="mx-auto max-w-4xl">
          <div className="card p-8 text-center">
            <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" />
            <h1 className="mt-4 text-3xl font-black text-navy-950">Cadastro enviado</h1>
            <p className="mt-2 text-muted">Protocolo {submitted.id}. O status atual é {submitted.status}; RH/Admin/WFM poderão aprovar, recusar ou solicitar ajuste.</p>
            <a href="/login" className="mt-6 inline-flex rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white">Voltar para login</a>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_84%_12%,rgba(37,99,235,.12),transparent_30rem),#F6F8FC] p-5">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-blue-600 text-white"><UserPlus className="h-6 w-6" /></div>
            <div>
              <h1 className="text-2xl font-black text-navy-950">Cadastro do Parceiro</h1>
              <p className="text-sm text-muted">Solicite seu acesso. O login só será liberado após aprovação.</p>
            </div>
          </div>
          <a href="/login" className="premium-control px-4 py-3 text-sm font-bold text-navy-950">Já tenho acesso</a>
        </div>
        <section className="card overflow-hidden">
          <div className="grid border-b border-border bg-white md:grid-cols-6">
            {registrationSteps.map((item, index) => (
              <button key={item} onClick={() => setStep(index)} className={cn("border-b-2 px-4 py-4 text-left text-sm font-extrabold", index === step ? "border-blue-600 bg-blue-50 text-blue-700" : "border-transparent text-muted")}>
                <span className="mr-2 inline-grid h-6 w-6 place-items-center rounded-full bg-white text-xs shadow-soft">{index + 1}</span>
                {item}
              </button>
            ))}
          </div>
          <div className="p-6">
            <div className="mb-5 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-700">
              Dados sensíveis são protegidos por permissão e só aparecem no Mapa de Parceiros para perfis autorizados.
            </div>
            {sections[step]}
            {error ? (
              <div className="mt-5 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-600">
                <p>{error}</p>
                {fieldErrorEntries.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 font-semibold">
                    {fieldErrorEntries.map(([field, message]) => (
                      <li key={field}>{registrationFieldLabels[field] ?? field}: {message}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            <div className="mt-6 flex justify-between">
              <button type="button" disabled={step === 0 || savingRegistration} onClick={() => setStep(Math.max(0, step - 1))} className="rounded-lg border border-border bg-white px-5 py-3 text-sm font-bold disabled:opacity-50">Voltar</button>
              {step < registrationSteps.length - 1 ? (
                <button type="button" disabled={savingRegistration} onClick={() => setStep(Math.min(registrationSteps.length - 1, step + 1))} className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-60">Continuar</button>
              ) : (
                <button type="button" disabled={savingRegistration} onClick={submitRegistration} className="rounded-lg bg-blue-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-60">{savingRegistration ? "Enviando..." : "Enviar cadastro para aprovação"}</button>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
