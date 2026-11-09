import { MyInvoicePage } from "@/components/my-invoice-page";
import { getDefaultBillingReferenceMonth } from "@/lib/billing-reference-month-service";

export const dynamic = "force-dynamic";

export default async function MyInvoiceRoute() {
  return <MyInvoicePage defaultReferenceMonth={await getDefaultBillingReferenceMonth()} />;
}
