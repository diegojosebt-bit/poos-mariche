"use client";

import { useEffect, useMemo, useState } from "react";
import { doc } from "firebase/firestore";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Info, Megaphone } from "lucide-react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { useDoc, useFirebase, useMemoFirebase } from "@/firebase";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  announcementKey,
  normalizeAnnouncements,
  type AnnouncementItem,
  type AnnouncementType,
} from "@/lib/announcements";

const TYPE_CONFIG: Record<
  AnnouncementType,
  {
    icon: typeof Info;
    label: string;
    modalBorder: string;
    iconBox: string;
    badge: string;
    messageBox: string;
    dotActive: string;
    ctaClass: string;
  }
> = {
  info: {
    icon: Megaphone,
    label: "Información",
    modalBorder: "border-blue-300/80 ring-1 ring-blue-100/80",
    iconBox: "border-blue-200/80 bg-blue-50 text-blue-600",
    badge: "border-blue-200/80 bg-blue-50 text-blue-700",
    messageBox: "border-slate-200/70 bg-slate-50/70",
    dotActive: "bg-blue-600",
    ctaClass: "bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 text-white hover:opacity-95",
  },
  warning: {
    icon: AlertTriangle,
    label: "Advertencia",
    modalBorder: "border-amber-300/80 ring-1 ring-amber-100/80",
    iconBox: "border-amber-200/80 bg-amber-50 text-amber-600",
    badge: "border-amber-200/80 bg-amber-50 text-amber-700",
    messageBox: "border-amber-200/60 bg-amber-50/35",
    dotActive: "bg-amber-500",
    ctaClass: "bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 text-white hover:opacity-95",
  },
  critical: {
    icon: AlertTriangle,
    label: "Importante",
    modalBorder: "border-rose-300/80 ring-1 ring-rose-100/80",
    iconBox: "border-rose-200/80 bg-rose-50 text-rose-600",
    badge: "border-rose-200/80 bg-rose-50 text-rose-700",
    messageBox: "border-rose-200/60 bg-rose-50/35",
    dotActive: "bg-rose-600",
    ctaClass: "bg-rose-600 text-white hover:bg-rose-700",
  },
};

function formatNoticeDate(iso?: string): string | null {
  if (!iso) return null;
  try {
    return format(parseISO(iso), "dd MMM, HH:mm", { locale: es });
  } catch {
    return null;
  }
}

export function GlobalAnnouncement() {
  const { firestore, user } = useFirebase();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [seenKeys, setSeenKeys] = useState<string[]>([]);
  const [seenLoaded, setSeenLoaded] = useState(false);

  const announcementRef = useMemoFirebase(
    () => (firestore ? doc(firestore, "system", "announcements") : null),
    [firestore],
  );
  const { data: announcement } = useDoc<any>(announcementRef);

  const storageKey = `mm_announcements_seen_${user?.uid ?? "anon"}`;

  const items = useMemo(
    () => normalizeAnnouncements(announcement).filter((item) => item.active),
    [announcement],
  );

  const unseen = useMemo(
    () => items.filter((item) => !seenKeys.includes(announcementKey(item))),
    [items, seenKeys],
  );
  const unseenSignature = unseen.map(announcementKey).join("|");

  useEffect(() => {
    setSeenLoaded(false);
    setOpen(false);
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setSeenKeys(Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : []);
    } catch {
      setSeenKeys([]);
    }
    setSeenLoaded(true);
  }, [storageKey]);

  useEffect(() => {
    if (!seenLoaded) return;
    setPage(0);
    setOpen(unseen.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unseenSignature, seenLoaded]);

  const safePage = Math.min(page, Math.max(0, unseen.length - 1));
  const current: AnnouncementItem | undefined = unseen[safePage];

  const dismissAll = () => {
    const keys = Array.from(new Set([...seenKeys, ...items.map(announcementKey)]));
    setSeenKeys(keys);
    try {
      localStorage.setItem(storageKey, JSON.stringify(keys));
    } catch {
      // Sin almacenamiento local: al menos se cierra en esta sesión.
    }
    setOpen(false);
  };

  if (!current) return null;

  const config = TYPE_CONFIG[current.type] || TYPE_CONFIG.info;
  const Icon = config.icon;
  const isLast = safePage >= unseen.length - 1;
  const publishedLabel = formatNoticeDate(current.updatedAt);

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) dismissAll();
      }}
    >
      <DialogContent
        className={cn(
          "w-[calc(100%-1.5rem)] max-w-[440px] gap-0 overflow-hidden rounded-2xl border bg-white p-0 shadow-xl sm:max-w-[460px] sm:p-0",
          config.modalBorder,
        )}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <div className="border-b border-slate-100 bg-white px-5 py-4 pr-11">
          <DialogHeader className="space-y-0 text-left">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
                  config.iconBox,
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle className="text-base font-semibold text-slate-900">
                    Comunicado
                  </DialogTitle>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
                      config.badge,
                    )}
                  >
                    {config.label}
                  </span>
                </div>
                <DialogDescription className="mt-0.5 text-xs text-slate-500">
                  Aviso del administrador{publishedLabel ? ` · ${publishedLabel}` : ""}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="space-y-3 bg-white px-5 py-5">
          <div
            className={cn(
              "max-h-[48vh] overflow-y-auto rounded-xl border p-4",
              config.messageBox,
            )}
          >
            <p className="whitespace-pre-wrap text-sm font-normal leading-relaxed text-slate-700">
              {current.message}
            </p>
          </div>

          {unseen.length > 1 && (
            <div className="flex items-center justify-center gap-1.5 pt-0.5">
              {unseen.map((item, idx) => (
                <button
                  key={announcementKey(item)}
                  type="button"
                  onClick={() => setPage(idx)}
                  aria-label={`Ver comunicado ${idx + 1}`}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-200",
                    idx === safePage ? cn("w-5", config.dotActive) : "w-1.5 bg-slate-200 hover:bg-slate-300",
                  )}
                />
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 border-t border-slate-100 bg-white px-5 py-3.5 sm:justify-between">
          <div className="flex items-center gap-1.5">
            {unseen.length > 1 ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-lg border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  onClick={() => setPage((value) => Math.max(0, value - 1))}
                  disabled={safePage === 0}
                  aria-label="Comunicado anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-10 text-center text-xs font-medium tabular-nums text-slate-500">
                  {safePage + 1} / {unseen.length}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 rounded-lg border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  onClick={() => setPage((value) => Math.min(unseen.length - 1, value + 1))}
                  disabled={isLast}
                  aria-label="Comunicado siguiente"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                <Info className="h-3.5 w-3.5" />
                Aviso del sistema
              </span>
            )}
          </div>

          <Button
            type="button"
            className={cn(
              "h-9 rounded-xl px-4 text-xs font-semibold shadow-sm transition-opacity",
              config.ctaClass,
            )}
            onClick={() => {
              if (isLast) dismissAll();
              else setPage((value) => Math.min(unseen.length - 1, value + 1));
            }}
          >
            {isLast ? (
              <>
                <Check className="mr-1.5 h-3.5 w-3.5" />
                Entendido
              </>
            ) : (
              <>
                Siguiente
                <ChevronRight className="ml-1 h-3.5 w-3.5" />
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
