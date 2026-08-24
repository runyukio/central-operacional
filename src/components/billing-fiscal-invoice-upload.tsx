"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileSearch, RefreshCw, Upload, XCircle } from "lucide-react";

import { cn } from "@/lib/utils";

export type BillingFiscalInvoiceAnalysis = {
  accessKey: string;
  invoiceNumber: string;
  serviceAmount: number;
  serviceDescription: string;
  customerTaxId: string;
  supplierTaxId: string;
  taxationCode: string;
  nbsCode: string;
  complianceValidated: boolean;
  extractionMethod: "PDF_TEXT" | "OCR" | "XML";
  billingGrossAmount: number;
  difference: number;
  matchesBilling: boolean;
  amountMismatchAccepted: boolean;
  validationToken: string;
};

export type BillingFiscalInvoiceUploadValue = {
  file: File | null;
  analysis: BillingFiscalInvoiceAnalysis | null;
  validationToken: string;
};

export type ExistingBillingFiscalInvoice = {
  accessKey: string;
  invoiceNumber: string;
  grossAmount: number;
  fileName: string;
};

export const EMPTY_BILLING_FISCAL_UPLOAD: BillingFiscalInvoiceUploadValue = {
  file: null,
  analysis: null,
  validationToken: ""
};

export function billingFiscalUploadIsReady(
  value: BillingFiscalInvoiceUploadValue,
  existing: ExistingBillingFiscalInvoice | null | undefined,
  expectedGrossAmount: number,
  allowAmountMismatch = false
) {
  if (value.file) return Boolean(
    (value.analysis?.matchesBilling || value.analysis?.amountMismatchAccepted)
    && value.validationToken
  );
  return Boolean(
    existing?.accessKey
    && existing.invoiceNumber
    && (allowAmountMismatch || currencyEquals(existing.grossAmount, expectedGrossAmount))
  );
}

export function BillingFiscalInvoiceUpload({
  referenceMonth,
  employeeId,
  expectedGrossAmount,
  allowAmountMismatch = false,
  existing,
  disabled = false,
  value,
  onChange
}: {
  referenceMonth: string;
  employeeId?: string;
  expectedGrossAmount: number;
  allowAmountMismatch?: boolean;
  existing?: ExistingBillingFiscalInvoice | null;
  disabled?: boolean;
  value: BillingFiscalInvoiceUploadValue;
  onChange: (value: BillingFiscalInvoiceUploadValue) => void;
}) {
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const requestIdRef = useRef(0);

  useEffect(() => {
    requestIdRef.current += 1;
    setAnalyzing(false);
    setError("");
  }, [employeeId, referenceMonth]);

  async function selectFile(file: File | null) {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setError("");
    if (!file) {
      onChange(EMPTY_BILLING_FISCAL_UPLOAD);
      return;
    }

    setAnalyzing(true);
    onChange({ file, analysis: null, validationToken: "" });
    try {
      const form = new FormData();
      form.set("referenceMonth", referenceMonth);
      if (employeeId) form.set("employeeId", employeeId);
      form.set("file", file);
      const response = await fetch("/api/billing/fiscal-invoice/preview", {
        method: "POST",
        body: form
      });
      const payload = await response.json().catch(() => ({}));
      if (requestId !== requestIdRef.current) return;
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível ler a nota fiscal.");
      const analysis = payload.data as BillingFiscalInvoiceAnalysis;
      onChange({
        file,
        analysis,
        validationToken: analysis.validationToken
      });
    } catch (nextError) {
      if (requestId !== requestIdRef.current) return;
      setError(nextError instanceof Error ? nextError.message : "Não foi possível ler a nota fiscal.");
      onChange({ file, analysis: null, validationToken: "" });
    } finally {
      if (requestId === requestIdRef.current) setAnalyzing(false);
    }
  }

  const displayed = value.analysis
    ? {
      accessKey: value.analysis.accessKey,
      invoiceNumber: value.analysis.invoiceNumber,
      serviceAmount: value.analysis.serviceAmount,
      matchesBilling: value.analysis.matchesBilling,
      amountMismatchAccepted: value.analysis.amountMismatchAccepted
    }
    : existing?.accessKey
      ? {
        accessKey: existing.accessKey,
        invoiceNumber: existing.invoiceNumber,
        serviceAmount: existing.grossAmount,
        matchesBilling: currencyEquals(existing.grossAmount, expectedGrossAmount),
        amountMismatchAccepted: allowAmountMismatch
          && !currencyEquals(existing.grossAmount, expectedGrossAmount)
      }
      : null;

  return (
    <div className="space-y-3">
      <label className={cn(
        "flex min-h-24 items-center gap-3 rounded-xl border border-dashed px-4 py-3 transition",
        disabled
          ? "cursor-not-allowed border-slate-200 bg-slate-50 opacity-70"
          : "cursor-pointer border-blue-200 bg-blue-50/60 hover:border-blue-400 hover:bg-blue-50"
      )}>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-blue-700 shadow-sm">
          {analyzing ? <RefreshCw className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-black text-navy-950">
            {analyzing ? "Lendo a nota fiscal..." : "Selecionar nota fiscal"}
          </span>
          <span className="mt-1 block break-all text-xs font-semibold text-muted">
            {value.file?.name ?? existing?.fileName ?? "PDF, XML, PNG ou JPG - máximo de 10 MB"}
          </span>
          <span className="mt-1 block text-[11px] font-bold text-blue-700">
            Chave, número e valor serão preenchidos automaticamente.
          </span>
        </span>
        <input
          type="file"
          accept=".pdf,.xml,.png,.jpg,.jpeg,application/pdf,application/xml,text/xml,image/png,image/jpeg"
          disabled={disabled || analyzing}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0] ?? null;
            event.currentTarget.value = "";
            void selectFile(file);
          }}
          className="sr-only"
        />
      </label>

      {displayed ? (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <ReadField label="Chave de acesso da NFS-e" value={displayed.accessKey} mono wide />
            <ReadField label="Número da NFS-e" value={displayed.invoiceNumber} mono />
            <ReadField label="Valor do serviço na nota" value={formatCurrency(displayed.serviceAmount)} />
            <ReadField label="Valor esperado na NFS-e" value={formatCurrency(expectedGrossAmount)} />
          </div>
          <div className={cn(
            "flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm font-bold",
            displayed.matchesBilling
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : displayed.amountMismatchAccepted
                ? "border-blue-200 bg-blue-50 text-blue-700"
              : "border-red-200 bg-red-50 text-red-700"
          )}>
            {displayed.matchesBilling || displayed.amountMismatchAccepted
              ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>
              {displayed.matchesBilling
                ? "Nota validada: o valor do serviço é igual ao valor esperado do Billing."
                : displayed.amountMismatchAccepted
                  ? "Nota validada: a divergência de valor está liberada para este parceiro."
                : `Aprovação bloqueada: a nota está em ${formatCurrency(displayed.serviceAmount)} e o valor esperado do Billing em ${formatCurrency(expectedGrossAmount)}.`}
            </span>
          </div>
        </>
      ) : null}

      {value.analysis?.complianceValidated ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <ComplianceField label="Tomador validado" value={formatCnpj(value.analysis.customerTaxId)} />
          <ComplianceField label="Prestador validado" value={formatCnpj(value.analysis.supplierTaxId)} />
          <ComplianceField label="Código de Tributação" value={value.analysis.taxationCode} />
          <ComplianceField label="Código da NBS" value={value.analysis.nbsCode} />
        </div>
      ) : null}

      {analyzing ? (
        <div className="flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800">
          <FileSearch className="h-4 w-4 shrink-0" />
          O OCR está conferindo os dados. Isso pode levar alguns segundos.
        </div>
      ) : null}

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-bold text-red-700">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {existing && !existing.accessKey && !value.file ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
          Esta nota foi salva antes da leitura automática. Selecione o arquivo novamente para validar chave, número e valor.
        </p>
      ) : null}
    </div>
  );
}

function ReadField({ label, value, mono = false, wide = false }: { label: string; value: string; mono?: boolean; wide?: boolean }) {
  return (
    <div className={cn("min-w-0 rounded-xl border border-border bg-slate-50 px-3 py-2.5", wide && "sm:col-span-3")}>
      <p className="text-[10px] font-black uppercase tracking-wide text-muted">{label}</p>
      <p className={cn("mt-1 break-all text-sm font-black text-navy-950", mono && "font-mono")}>{value || "-"}</p>
    </div>
  );
}

function ComplianceField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-emerald-800">
      <CheckCircle2 className="h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-wide">{label}</p>
        <p className="break-all text-xs font-black">{value}</p>
      </div>
    </div>
  );
}

function currencyEquals(left: number, right: number) {
  return Math.round(Number(left) * 100) === Math.round(Number(right) * 100);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number.isFinite(value) ? value : 0);
}

function formatCnpj(value: string) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length !== 14) return value || "-";
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
}
