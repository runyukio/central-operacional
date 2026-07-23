"use client";

import Image from "next/image";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import nfseNumberHelpImage from "@/assets/nfse-number-help.png";

type BillingFiscalInvoiceNumberHelpProps = {
  align?: "left" | "right";
};

export function BillingFiscalInvoiceNumberHelp({
  align = "left"
}: BillingFiscalInvoiceNumberHelpProps) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visible = open || hovered;

  const clearHideTimer = useCallback(() => {
    if (!hideTimerRef.current) return;
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
  }, []);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const gutter = 8;
    const triggerRect = trigger.getBoundingClientRect();
    const width = Math.min(352, window.innerWidth - gutter * 2);
    const preferredLeft = align === "right" ? triggerRect.right - width : triggerRect.left;
    const left = Math.min(Math.max(gutter, preferredLeft), window.innerWidth - width - gutter);
    const tooltipHeight = tooltipRef.current
      ? Math.min(tooltipRef.current.offsetHeight, window.innerHeight - gutter * 2)
      : 0;
    const roomBelow = window.innerHeight - triggerRect.bottom - gutter;
    const roomAbove = triggerRect.top - gutter;
    const preferredTop = tooltipHeight > roomBelow && roomAbove > roomBelow
      ? triggerRect.top - tooltipHeight - gutter
      : triggerRect.bottom + gutter;
    const top = tooltipHeight
      ? Math.min(
          Math.max(gutter, preferredTop),
          Math.max(gutter, window.innerHeight - tooltipHeight - gutter)
        )
      : preferredTop;

    setPosition({
      left,
      top,
      width
    });
  }, [align]);

  useEffect(() => {
    setMounted(true);
    return clearHideTimer;
  }, [clearHideTimer]);

  useLayoutEffect(() => {
    if (!visible || !mounted) return;

    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);

    const handleViewportChange = () => updatePosition();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [mounted, updatePosition, visible]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || tooltipRef.current?.contains(target)) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const showOnHover = () => {
    clearHideTimer();
    updatePosition();
    setHovered(true);
  };

  const hideAfterHover = () => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => setHovered(false), 160);
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <span>Número da nota fiscal</span>
      <span
        className="relative inline-flex normal-case tracking-normal"
        onMouseEnter={showOnHover}
        onMouseLeave={hideAfterHover}
      >
        <button
          ref={triggerRef}
          type="button"
          aria-label="Ver onde encontrar o número da NFS-e"
          aria-controls={tooltipId}
          aria-expanded={visible}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            updatePosition();
            setOpen((current) => !current);
          }}
          className="grid h-4 w-4 place-items-center rounded-full border border-blue-300 bg-blue-50 text-[10px] font-black leading-none text-blue-700 transition hover:border-blue-500 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-1"
        >
          ?
        </button>
        {mounted && visible && position
          ? createPortal(
              <div
                ref={tooltipRef}
                id={tooltipId}
                role="tooltip"
                onMouseEnter={showOnHover}
                onMouseLeave={hideAfterHover}
                className="fixed z-[120] max-h-[calc(100vh-1rem)] overflow-x-hidden overflow-y-auto rounded-xl border border-slate-200 bg-white text-left normal-case tracking-normal shadow-2xl"
                style={{ left: position.left, top: position.top, width: position.width }}
              >
                <div className="px-3 pb-2 pt-3 text-xs font-bold leading-relaxed text-navy-950">
                  Informe somente o número exibido no campo “Número da NFS-e”, destacado em vermelho.
                </div>
                <div className="border-t border-slate-100 bg-slate-50 p-2">
                  <Image
                    src={nfseNumberHelpImage}
                    alt="Exemplo de NFS-e com o campo Número da NFS-e destacado em vermelho"
                    className="h-auto w-full rounded-lg border border-slate-200"
                  />
                </div>
              </div>,
              document.body
            )
          : null}
      </span>
    </span>
  );
}
