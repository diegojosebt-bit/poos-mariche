"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type DraftKind = "repair" | "product";

type Draft = {
  values: Record<string, unknown>;
  updatedAt: string;
};

type DraftModalsContextValue = {
  drafts: Partial<Record<DraftKind, Draft>>;
  saveDraft: (kind: DraftKind, values: Record<string, unknown>) => void;
  clearDraft: (kind: DraftKind) => void;
  formOpen: boolean;
  setFormOpen: (open: boolean) => void;
};

const STORAGE_KEY = "mm_modal_drafts";
const DRAFTS_EVENT = "mm-drafts-changed";
const DraftModalsContext = createContext<DraftModalsContextValue | undefined>(undefined);

function readStoredDrafts(): Partial<Record<DraftKind, Draft>> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function persistDraft(kind: DraftKind, values: Record<string, unknown>) {
  const next = {
    ...readStoredDrafts(),
    [kind]: { values, updatedAt: new Date().toISOString() },
  };
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
  window.dispatchEvent(new Event(DRAFTS_EVENT));
}

export function DraftModalsProvider({ children }: { children: ReactNode }) {
  const [drafts, setDrafts] = useState<Partial<Record<DraftKind, Draft>>>({});
  const [formOpen, setFormOpen] = useState(false);
  const draftsRef = useRef<Partial<Record<DraftKind, Draft>>>({});
  const pathname = usePathname();

  useEffect(() => {
    setFormOpen(false);
  }, [pathname]);

  useEffect(() => {
    const sync = () => {
      const stored = readStoredDrafts();
      draftsRef.current = stored;
      setDrafts(stored);
    };
    sync();
    window.addEventListener(DRAFTS_EVENT, sync);
    return () => window.removeEventListener(DRAFTS_EVENT, sync);
  }, []);

  const commit = useCallback((next: Partial<Record<DraftKind, Draft>>) => {
    draftsRef.current = next;
    setDrafts(next);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Sin sessionStorage: el borrador vive solo en memoria.
    }
    window.dispatchEvent(new Event(DRAFTS_EVENT));
  }, []);

  const saveDraft = useCallback((kind: DraftKind, values: Record<string, unknown>) => {
    commit({
      ...draftsRef.current,
      [kind]: { values, updatedAt: new Date().toISOString() },
    });
  }, [commit]);

  const clearDraft = useCallback((kind: DraftKind) => {
    const next = { ...draftsRef.current };
    delete next[kind];
    commit(next);
  }, [commit]);

  const value = useMemo(
    () => ({ drafts, saveDraft, clearDraft, formOpen, setFormOpen }),
    [drafts, saveDraft, clearDraft, formOpen],
  );

  return <DraftModalsContext.Provider value={value}>{children}</DraftModalsContext.Provider>;
}

export function useDraftModals() {
  const context = useContext(DraftModalsContext);
  if (!context) throw new Error("useDraftModals must be used within DraftModalsProvider");
  return context;
}

export function DraftRestorePill() {
  const { drafts, clearDraft, formOpen } = useDraftModals();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [storedDrafts, setStoredDrafts] = useState<Partial<Record<DraftKind, Draft>>>({});

  useEffect(() => {
    const sync = () => setStoredDrafts(readStoredDrafts());
    sync();
    setMounted(true);
    window.addEventListener(DRAFTS_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(DRAFTS_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const activeDrafts = Object.keys(storedDrafts).length > 0 ? storedDrafts : drafts;
  const entries = (Object.entries(activeDrafts) as Array<[DraftKind, Draft]>).filter(([, draft]) => draft);

  if (!mounted || formOpen || entries.length === 0) return null;

  const restore = (kind: DraftKind) => {
    const path = kind === "repair" ? "/dashboard/repairs" : "/dashboard/inventory";
    router.push(`${path}?restoreDraft=${kind}&t=${Date.now()}`);
  };

  return createPortal(
    <div
      className="pointer-events-auto flex flex-col items-end gap-2"
      style={{ position: "fixed", right: "1rem", bottom: "1rem", zIndex: 2147483647 }}
    >
      {entries.map(([kind]) => (
        <div
          key={kind}
          className="flex items-center gap-0.5 rounded-full border border-white/20 bg-primary p-1 text-primary-foreground shadow-[0_10px_30px_rgba(37,50,194,0.35)] ring-1 ring-primary/20"
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-9 rounded-full px-3.5 text-[10px] font-black uppercase tracking-wide text-primary-foreground hover:bg-white/15 hover:!text-primary-foreground"
            onClick={() => restore(kind)}
          >
            {kind === "repair" ? "Restaurar reparación" : "Restaurar producto"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-full text-primary-foreground/70 hover:bg-white/15 hover:text-primary-foreground"
            onClick={() => clearDraft(kind)}
            aria-label="Descartar borrador"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
