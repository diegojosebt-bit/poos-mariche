"use client";

import { useEffect, useMemo, useState } from "react";
import { doc } from "firebase/firestore";
import { AlertTriangle, Info, Megaphone, ChevronLeft, ChevronRight } from "lucide-react";
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

const TYPE_CONFIG: Record<AnnouncementType, { icon: typeof Info; header: string; label: string }> = {
  info: { icon: Info, header: "bg-primary text-white", label: "Información" },
  warning: { icon: AlertTriangle, header: "bg-amber-500 text-white", label: "Advertencia" },
  critical: { icon: AlertTriangle, header: "bg-destructive text-white", label: "Importante" },
};

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

  const current: AnnouncementItem | undefined = unseen[Math.min(page, Math.max(0, unseen.length - 1))];

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
  const isLast = page >= unseen.length - 1;

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) dismissAll();
      }}
    >
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-lg"
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className={cn("space-y-0 p-5", config.header)}>
          <DialogTitle className="flex items-center gap-2 text-base font-black uppercase tracking-tight">
            <Icon className="h-5 w-5 shrink-0" />
            <Megaphone className="hidden h-4 w-4 opacity-70 sm:block" />
            {config.label}
          </DialogTitle>
          <DialogDescription className="text-xs font-semibold text-white/80">
            Comunicado del administrador
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-6">
          <p className="whitespace-pre-wrap text-sm font-medium leading-relaxed text-slate-800">
            {current.message}
          </p>
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 border-t bg-muted/20 px-5 py-3 sm:justify-between">
          <div className="flex items-center gap-2">
            {unseen.length > 1 && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setPage((value) => Math.max(0, value - 1))}
                  disabled={page === 0}
                  aria-label="Comunicado anterior"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-12 text-center text-[10px] font-black uppercase text-muted-foreground">
                  {page + 1} de {unseen.length}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setPage((value) => Math.min(unseen.length - 1, value + 1))}
                  disabled={isLast}
                  aria-label="Comunicado siguiente"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>

          <Button
            type="button"
            className="h-9 px-4 text-xs font-black uppercase"
            onClick={() => {
              if (isLast) dismissAll();
              else setPage((value) => Math.min(unseen.length - 1, value + 1));
            }}
          >
            {isLast ? "Entendido" : "Siguiente"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
