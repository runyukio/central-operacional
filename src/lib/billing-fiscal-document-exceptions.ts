export type BillingFiscalDocumentContext = {
  wbLogin?: string | null;
  referenceMonth?: string | null;
  documentHash?: string | null;
};

// Explicit authorization for this PDF only; not a blanket exemption for the partner.
const BILLING_FISCAL_DOCUMENT_CODE_EXCEPTIONS = [{
  id: "SAO_PAULO_NF30_LUIZA03_2026_08",
  wbLogin: "wb_luiza03",
  referenceMonth: "2026-08",
  documentHash: "0204976f20b0f8df862d0d4f4c12e7fbaef57e05599759183660a9d9c0ad52a8",
  taxationCode: "03115"
}] as const;

export function getBillingFiscalDocumentCodeException(context?: BillingFiscalDocumentContext) {
  const wbLogin = String(context?.wbLogin ?? "").trim().toLowerCase();
  return BILLING_FISCAL_DOCUMENT_CODE_EXCEPTIONS.find((exception) => (
    exception.wbLogin === wbLogin
    && exception.referenceMonth === context?.referenceMonth
    && exception.documentHash === context?.documentHash
  )) ?? null;
}
