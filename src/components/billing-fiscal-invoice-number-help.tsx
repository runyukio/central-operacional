"use client";

import Image from "next/image";
import { useId, useState } from "react";

import nfseNumberHelpImage from "@/assets/nfse-number-help.png";
import { cn } from "@/lib/utils";

type BillingFiscalInvoiceNumberHelpProps = {
  align?: "left" | "right";
};

export function BillingFiscalInvoiceNumberHelp({
  align = "left"
}: BillingFiscalInvoiceNumberHelpProps) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);

  return (
    <span className="inline-flex items-center gap-1.5">
      <span>Número da nota fiscal</span>
      <span className="group relative inline-flex normal-case tracking-normal">
        <button
          type="button"
          aria-label="Ver onde encontrar o número da NFS-e"
          aria-controls={tooltipId}
          aria-expanded={open}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpen((current) => !current);
          }}
          className="grid h-4 w-4 place-items-center rounded-full border border-blue-300 bg-blue-50 text-[10px] font-black leading-none text-blue-700 transition hover:border-blue-500 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
        >
          ?
        </button>
        <span
          id={tooltipId}
          role="tooltip"
          className={cn(
            "absolute top-full z-[80] mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-2xl",
            align === "right" ? "right-0" : "left-0",
            open ? "block" : "hidden group-hover:block group-focus-within:block"
          )}
        >
          <span className="block px-3 pb-2 pt-3 text-xs font-bold leading-relaxed text-navy-950">
            Informe somente o número exibido no campo “Número da NFS-e”, destacado em vermelho.
          </span>
          <span className="block border-t border-slate-100 bg-slate-50 p-2">
            <Image
              src={nfseNumberHelpImage}
              alt="Exemplo de NFS-e com o campo Número da NFS-e destacado em vermelho"
              className="h-auto w-full rounded-lg border border-slate-200"
            />
          </span>
        </span>
      </span>
    </span>
  );
}
