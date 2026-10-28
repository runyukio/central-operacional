-- Visibility affects only the adjustments list; hidden adjustments remain active.
ALTER TABLE "BillingAdjustment" ADD COLUMN "hiddenAt" TIMESTAMP(3);
