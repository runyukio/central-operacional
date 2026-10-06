export type BillingFiscalDocumentContext = {
  wbLogin?: string | null;
  referenceMonth?: string | null;
  documentHash?: string | null;
};

export type BillingFiscalDocumentIdentity = {
  accessKey: string;
  invoiceNumber: string;
  customerTaxId: string;
  supplierTaxId: string;
  serviceAmount: number;
};

// Explicit authorizations for individual invoices, not blanket partner exemptions.
const BILLING_FISCAL_DOCUMENT_CODE_EXCEPTIONS = [{
  id: "SAO_PAULO_NF30_LUIZA03_2026_08",
  wbLogin: "wb_luiza03",
  referenceMonth: "2026-08",
  documentHash: "0204976f20b0f8df862d0d4f4c12e7fbaef57e05599759183660a9d9c0ad52a8",
  taxationCode: "03115"
}, {
  id: "SAO_PAULO_NF31_LUIZA03_2026_09",
  wbLogin: "wb_luiza03",
  referenceMonth: "2026-09",
  documentHash: "166556f469ff75e0bae7921a0da770eb881367b9b61fcd2133999655050a88e2",
  taxationCode: "03115"
}, {
  id: "SAO_PAULO_NF9_GENE_2026_08",
  wbLogin: "wb_gene",
  referenceMonth: "2026-08",
  documentHash: "b46e7bc007247e335691d5ef6ed9afe1442aaed002c93ea00fe581a73b010503",
  taxationCode: "03158"
}, {
  id: "SAO_PAULO_NF10_GENE_2026_09",
  wbLogin: "wb_gene",
  referenceMonth: "2026-09",
  documentHash: "132f1f2366e2493206b062f424771540b171962075966ae45ab483d132efa477",
  taxationCode: "03158",
  documentIdentity: {
    accessKey: "35503081264652288000161000000000001026108705378364",
    invoiceNumber: "10",
    customerTaxId: "58151940000161",
    supplierTaxId: "64652288000161",
    serviceAmount: 10452.08
  }
}] as const;

export function getBillingFiscalDocumentCodeException(
  context?: BillingFiscalDocumentContext,
  identity?: Partial<BillingFiscalDocumentIdentity>
) {
  const wbLogin = String(context?.wbLogin ?? "").trim().toLowerCase();
  return BILLING_FISCAL_DOCUMENT_CODE_EXCEPTIONS.find((exception) => (
    exception.wbLogin === wbLogin
    && exception.referenceMonth === context?.referenceMonth
    && (exception.documentHash === context?.documentHash || (
      "documentIdentity" in exception
      && matchesDocumentIdentity(identity, exception.documentIdentity)
    ))
  )) ?? null;
}

function matchesDocumentIdentity(
  actual: Partial<BillingFiscalDocumentIdentity> | undefined,
  expected: BillingFiscalDocumentIdentity
) {
  const digits = (value: string | undefined) => String(value ?? "").replace(/\D/g, "");
  return digits(actual?.accessKey) === expected.accessKey
    && digits(actual?.invoiceNumber).replace(/^0+/, "") === expected.invoiceNumber
    && digits(actual?.customerTaxId) === expected.customerTaxId
    && digits(actual?.supplierTaxId) === expected.supplierTaxId
    && Math.round(Number(actual?.serviceAmount) * 100) === Math.round(expected.serviceAmount * 100);
}
