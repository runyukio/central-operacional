INSERT INTO "RequestType" ("id", "name", "area", "slaHours", "requiresApproval")
VALUES ('reqtype_billing_invoice_adjustment', 'Ajuste de Invoice', 'Billing', 48, true)
ON CONFLICT ("name") DO NOTHING;
