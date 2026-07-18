CREATE TABLE "BillingFiscalInvoice" (
    "id" TEXT NOT NULL,
    "employeeInvoiceId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "grossAmount" DECIMAL(12,2) NOT NULL,
    "serviceDescription" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageBucket" TEXT NOT NULL DEFAULT 'billing-invoices',
    "storagePath" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingFiscalInvoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingFiscalInvoice_employeeInvoiceId_key" ON "BillingFiscalInvoice"("employeeInvoiceId");
CREATE INDEX "BillingFiscalInvoice_submittedById_idx" ON "BillingFiscalInvoice"("submittedById");
CREATE INDEX "BillingFiscalInvoice_submittedAt_idx" ON "BillingFiscalInvoice"("submittedAt");

ALTER TABLE "BillingFiscalInvoice"
ADD CONSTRAINT "BillingFiscalInvoice_employeeInvoiceId_fkey"
FOREIGN KEY ("employeeInvoiceId") REFERENCES "BillingEmployeeInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BillingFiscalInvoice"
ADD CONSTRAINT "BillingFiscalInvoice_submittedById_fkey"
FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BillingFiscalInvoice" ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'billing-invoices',
  'billing-invoices',
  false,
  10485760,
  ARRAY['application/pdf', 'application/xml', 'text/xml', 'image/png', 'image/jpeg']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
