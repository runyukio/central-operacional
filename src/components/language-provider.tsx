"use client";

import { Check, Globe2 } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";

import { LANGUAGE_STORAGE_KEY, translateUiText, type AppLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type LanguageContextValue = {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  toggleLanguage: () => void;
  t: (value: string) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);
const originalText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
const translatableAttributes = ["aria-label", "placeholder", "title"] as const;
const ignoredTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE", "TEXTAREA"]);

function shouldIgnoreElement(element: Element | null) {
  if (!element) return true;
  if (ignoredTags.has(element.tagName)) return true;
  if (element.closest("[data-no-translate], [translate='no'], [contenteditable='true']")) return true;
  return false;
}

function translateTextNode(node: Text, language: AppLanguage) {
  if (shouldIgnoreElement(node.parentElement)) return;
  const current = node.nodeValue ?? "";

  if (language === "pt-BR") {
    const source = originalText.get(node);
    if (source !== undefined && current !== source) node.nodeValue = source;
    originalText.delete(node);
    return;
  }

  let source = originalText.get(node);
  if (source === undefined || current !== translateUiText(source, "en-US")) {
    source = current;
    originalText.set(node, source);
  }
  const translated = translateUiText(source, "en-US");
  if (current !== translated) node.nodeValue = translated;
}

function translateElementAttributes(element: Element, language: AppLanguage) {
  if (shouldIgnoreElement(element)) return;

  let stored = originalAttributes.get(element);
  for (const attribute of translatableAttributes) {
    const current = element.getAttribute(attribute);
    if (current === null) continue;

    if (language === "pt-BR") {
      const source = stored?.get(attribute);
      if (source !== undefined && current !== source) element.setAttribute(attribute, source);
      stored?.delete(attribute);
      continue;
    }

    const existingSource = stored?.get(attribute);
    const source = existingSource === undefined || current !== translateUiText(existingSource, "en-US")
      ? current
      : existingSource;
    if (!stored) {
      stored = new Map<string, string>();
      originalAttributes.set(element, stored);
    }
    stored.set(attribute, source);
    const translated = translateUiText(source, "en-US");
    if (current !== translated) element.setAttribute(attribute, translated);
  }

  if (language === "pt-BR" && stored && stored.size === 0) originalAttributes.delete(element);
}

function translateSubtree(root: Node, language: AppLanguage) {
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root as Text, language);
    return;
  }
  if (!(root instanceof Element) && !(root instanceof DocumentFragment) && root !== document.body) return;

  if (root instanceof Element) translateElementAttributes(root, language);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) translateTextNode(current as Text, language);
    else translateElementAttributes(current as Element, language);
    current = walker.nextNode();
  }
}

function applyDocumentLanguage(language: AppLanguage) {
  document.documentElement.lang = language;
  document.documentElement.dataset.language = language;
  const expectedTitle = language === "en-US" ? "Operations Center" : "Central Operacional";
  if (document.title === "Central Operacional" || document.title === "Operations Center") document.title = expectedTitle;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>("pt-BR");

  useEffect(() => {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    const initialLanguage: AppLanguage = stored === "en-US" ? "en-US" : "pt-BR";
    setLanguageState(initialLanguage);
    applyDocumentLanguage(initialLanguage);

    function handleStorage(event: StorageEvent) {
      if (event.key !== LANGUAGE_STORAGE_KEY) return;
      const nextLanguage: AppLanguage = event.newValue === "en-US" ? "en-US" : "pt-BR";
      setLanguageState(nextLanguage);
      applyDocumentLanguage(nextLanguage);
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  useEffect(() => {
    applyDocumentLanguage(language);
    translateSubtree(document.body, language);

    const titleObserver = new MutationObserver(() => applyDocumentLanguage(language));
    titleObserver.observe(document.head, {
      subtree: true,
      childList: true,
      characterData: true
    });

    const pendingRoots = new Set<Node>();
    let animationFrame = 0;
    const flush = () => {
      animationFrame = 0;
      pendingRoots.forEach((root) => translateSubtree(root, language));
      pendingRoots.clear();
    };
    const queue = (root: Node) => {
      pendingRoots.add(root);
      if (!animationFrame) animationFrame = window.requestAnimationFrame(flush);
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList") mutation.addedNodes.forEach(queue);
        else queue(mutation.target);
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...translatableAttributes]
    });

    return () => {
      observer.disconnect();
      titleObserver.disconnect();
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, [language]);

  const value = useMemo<LanguageContextValue>(() => ({
    language,
    setLanguage: (nextLanguage) => {
      setLanguageState(nextLanguage);
      applyDocumentLanguage(nextLanguage);
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
    },
    toggleLanguage: () => {
      const nextLanguage = language === "pt-BR" ? "en-US" : "pt-BR";
      setLanguageState(nextLanguage);
      applyDocumentLanguage(nextLanguage);
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
    },
    t: (text) => translateUiText(text, language)
  }), [language]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider");
  return context;
}

export function LanguageSwitcher({
  className,
  buttonClassName,
  align = "right"
}: {
  className?: string;
  buttonClassName?: string;
  align?: "left" | "right";
}) {
  const { language, setLanguage } = useLanguage();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const isEnglish = language === "en-US";
  return (
    <div ref={containerRef} className={cn("relative", className)} data-no-translate>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "grid h-9 w-9 place-items-center rounded-lg border border-transparent transition hover:border-border hover:bg-surface",
          open && "border-border bg-surface",
          buttonClassName
        )}
        aria-label={isEnglish ? "Change language" : "Mudar idioma"}
        title={isEnglish ? "Change language" : "Mudar idioma"}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Globe2 className="h-[18px] w-[18px]" />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={isEnglish ? "Interface language" : "Idioma da interface"}
          className={cn(
            "absolute top-11 z-[100] w-[210px] overflow-hidden rounded-xl border border-border bg-white p-1.5 shadow-2xl shadow-navy-950/15 dark:bg-slate-950 dark:shadow-none",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          <p className="px-3 pb-1.5 pt-1 text-[10px] font-black uppercase tracking-[0.16em] text-muted">
            {isEnglish ? "Language" : "Idioma"}
          </p>
          {([
            { value: "pt-BR" as const, label: "Português (Brasil)" },
            { value: "en-US" as const, label: "English" }
          ]).map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={language === option.value}
              onClick={() => {
                setLanguage(option.value);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-bold text-navy-950 transition hover:bg-blue-50 dark:text-slate-100 dark:hover:bg-blue-500/10",
                language === option.value && "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-200"
              )}
            >
              <span>{option.label}</span>
              {language === option.value ? <Check className="h-4 w-4" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
