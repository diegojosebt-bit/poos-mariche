"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  MoreVertical,
  PlusSquare,
  Share,
  Smartphone,
  Monitor,
  AlertCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export type PwaPlatform = "ios" | "android" | "desktop" | "unknown";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

type PwaInstallContextValue = {
  platform: PwaPlatform;
  isStandalone: boolean;
  canPromptNative: boolean;
  shouldShowInstall: boolean;
  isInAppBrowser: boolean;
  isIosNonSafari: boolean;
  triggerInstall: () => Promise<void>;
};

const PwaInstallContext = createContext<PwaInstallContextValue | undefined>(undefined);

function detectPlatformInfo() {
  if (typeof window === "undefined") {
    return {
      platform: "unknown" as PwaPlatform,
      isStandalone: false,
      isInAppBrowser: false,
      isIosNonSafari: false,
      isSecure: true,
    };
  }

  const ua = navigator.userAgent || "";
  const isIOSDevice =
    /iPad|iPhone|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1);
  const isAndroid = /Android/i.test(ua);
  const platform: PwaPlatform = isIOSDevice ? "ios" : isAndroid ? "android" : "desktop";

  const isStandalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: minimal-ui)").matches ||
    (navigator as any).standalone === true;

  const isInAppBrowser = /FBAN|FBAV|Instagram|WhatsApp|Line\/|MicroMessenger|TikTok|Snapchat/i.test(ua);
  const isIosNonSafari = isIOSDevice && /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  const isSecure = window.isSecureContext;

  return { platform, isStandalone, isInAppBrowser, isIosNonSafari, isSecure };
}

export function PwaInstallProvider({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [platform, setPlatform] = useState<PwaPlatform>("unknown");
  const [isStandalone, setIsStandalone] = useState(false);
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);
  const [isIosNonSafari, setIsIosNonSafari] = useState(false);
  const [isSecure, setIsSecure] = useState(true);
  const [guideOpen, setGuideOpen] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  useEffect(() => {
    const info = detectPlatformInfo();
    setPlatform(info.platform);
    setIsStandalone(info.isStandalone);
    setIsInAppBrowser(info.isInAppBrowser);
    setIsIosNonSafari(info.isIosNonSafari);
    setIsSecure(info.isSecure);

    // 1. Captura temprana global de `beforeinstallprompt` (antes del splash y del login)
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
      setGuideOpen(false);
      toast({
        title: "¡Aplicación instalada!",
        description: "Ya puedes abrir Cobranza Online desde tu pantalla de inicio.",
      });
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    const standaloneQuery = window.matchMedia("(display-mode: standalone)");
    const handleDisplayModeChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        setIsStandalone(true);
        setDeferredPrompt(null);
      }
    };
    standaloneQuery.addEventListener?.("change", handleDisplayModeChange);

    // 2. Registro real del Service Worker en contextos seguros (HTTPS producción o localhost)
    if (
      "serviceWorker" in navigator &&
      window.isSecureContext &&
      (process.env.NODE_ENV === "production" || window.location.protocol === "https:")
    ) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => {
          console.warn("[PWA] No se pudo registrar el Service Worker:", err);
        });
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
      standaloneQuery.removeEventListener?.("change", handleDisplayModeChange);
    };
  }, [toast]);

  const triggerInstall = useCallback(async () => {
    if (isStandalone) return;

    // Caso 1: Chrome / Edge / Samsung Internet (Android y PC) con prompt nativo disponible
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === "accepted") {
          setDeferredPrompt(null);
          setIsStandalone(true);
          toast({
            title: "¡Instalación exitosa!",
            description: "Cobranza Online ya está disponible como aplicación.",
          });
          return;
        }
      } catch (err) {
        console.warn("[PWA] Error al invocar el instalador nativo:", err);
      }
      return;
    }

    // Caso 2: Apple (iOS/iPadOS) o navegador sin prompt nativo -> abrir guía visual 2026
    setCopiedUrl(false);
    setGuideOpen(true);
  }, [deferredPrompt, isStandalone, toast]);

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiedUrl(true);
      toast({
        title: "Enlace copiado",
        description: "Pégalo en Safari o Chrome para instalar la aplicación.",
      });
      setTimeout(() => setCopiedUrl(false), 2500);
    } catch {
      toast({
        variant: "destructive",
        title: "No se pudo copiar el enlace",
      });
    }
  };

  const canPromptNative = Boolean(deferredPrompt);
  // Mostrar botón de instalar siempre que no esté instalada:
  // - En Android y Apple SIEMPRE visible (nativo si hay prompt, guía visual si no)
  // - En PC visible cuando hay prompt nativo disponible
  const shouldShowInstall =
    !isStandalone &&
    (canPromptNative || platform === "ios" || platform === "android");

  return (
    <PwaInstallContext.Provider
      value={{
        platform,
        isStandalone,
        canPromptNative,
        shouldShowInstall,
        isInAppBrowser,
        isIosNonSafari,
        triggerInstall,
      }}
    >
      {children}

      {/* Modal guiado 2026 para Apple (iOS/iPadOS), navegadores embebidos o Android sin prompt */}
      <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
        <DialogContent className="w-[calc(100%-1.5rem)] max-w-[420px] gap-0 overflow-hidden rounded-2xl border border-blue-200/90 bg-white p-0 shadow-xl ring-1 ring-blue-100/80 sm:p-0">
          <div className="border-b border-slate-100 bg-white px-5 py-4 pr-11">
            <DialogHeader className="space-y-0 text-left">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-200/80 bg-blue-50 text-blue-600">
                  {platform === "desktop" ? (
                    <Monitor className="h-4 w-4" />
                  ) : (
                    <Smartphone className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0">
                  <DialogTitle className="text-base font-semibold text-slate-900">
                    Instalar Cobranza Online
                  </DialogTitle>
                  <DialogDescription className="text-xs text-slate-500">
                    {platform === "ios"
                      ? "Instalación rápida en iPhone / iPad"
                      : platform === "android"
                      ? "Instalación rápida en Android"
                      : "Instalación en escritorio"}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>
          </div>

          <div className="space-y-3.5 px-5 py-4">
            {/* Aviso especial: abierto dentro de WhatsApp / Instagram / etc. */}
            {isInAppBrowser && (
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-200/80 bg-amber-50/70 p-3 text-xs text-amber-900">
                <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="space-y-1">
                  <p className="font-semibold">Estás dentro de un navegador embebido</p>
                  <p className="text-[11px] leading-relaxed text-amber-800">
                    Abre este enlace en <strong>{platform === "ios" ? "Safari" : "Google Chrome"}</strong> para poder instalar la app en tu pantalla de inicio.
                  </p>
                </div>
              </div>
            )}

            {/* Aviso especial: iPhone/iPad abierto en Chrome/Edge en vez de Safari */}
            {platform === "ios" && isIosNonSafari && !isInAppBrowser && (
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-200/80 bg-amber-50/70 p-3 text-xs text-amber-900">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="space-y-1">
                  <p className="font-semibold">Ábrelo en Safari</p>
                  <p className="text-[11px] leading-relaxed text-amber-800">
                    En iPhone y iPad, Apple solo permite instalar aplicaciones web desde <strong>Safari</strong>. Copia el enlace y ábrelo allá.
                  </p>
                </div>
              </div>
            )}

            {/* Aviso especial: Android en red local HTTP sin HTTPS */}
            {platform === "android" && !isSecure && (
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-200/80 bg-amber-50/70 p-3 text-xs text-amber-900">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div className="space-y-1">
                  <p className="font-semibold">Conexión local sin HTTPS</p>
                  <p className="text-[11px] leading-relaxed text-amber-800">
                    Android Chrome exige <strong>HTTPS</strong> para instalar la app. En tu enlace publicado (con candado HTTPS) el botón instalará en 1 toque.
                  </p>
                </div>
              </div>
            )}

            {/* Pasos Apple (iOS / iPadOS) */}
            {platform === "ios" && (
              <ol className="space-y-2.5">
                <li className="flex items-start gap-3 rounded-xl border border-slate-200/80 bg-slate-50/60 p-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[11px] font-semibold text-white">
                    1
                  </span>
                  <div className="min-w-0 text-xs text-slate-700">
                    <p className="font-semibold text-slate-900">Toca el botón Compartir en Safari</p>
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500">
                      Busca el ícono <Share className="inline h-3.5 w-3.5 text-blue-600" /> en la barra inferior.
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-3 rounded-xl border border-slate-200/80 bg-slate-50/60 p-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[11px] font-semibold text-white">
                    2
                  </span>
                  <div className="min-w-0 text-xs text-slate-700">
                    <p className="font-semibold text-slate-900">Agregar a pantalla de inicio</p>
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500">
                      Desliza hacia abajo y toca <PlusSquare className="inline h-3.5 w-3.5 text-blue-600" /> <strong>Agregar a inicio</strong>.
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-3 rounded-xl border border-slate-200/80 bg-slate-50/60 p-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-semibold text-white">
                    3
                  </span>
                  <div className="min-w-0 text-xs text-slate-700">
                    <p className="font-semibold text-slate-900">Confirma tocando &ldquo;Agregar&rdquo;</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      El ícono de Cobranza Online aparecerá junto a tus apps.
                    </p>
                  </div>
                </li>
              </ol>
            )}

            {/* Pasos Android fallback */}
            {platform === "android" && (
              <ol className="space-y-2.5">
                <li className="flex items-start gap-3 rounded-xl border border-slate-200/80 bg-slate-50/60 p-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[11px] font-semibold text-white">
                    1
                  </span>
                  <div className="min-w-0 text-xs text-slate-700">
                    <p className="font-semibold text-slate-900">Abre el menú del navegador</p>
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500">
                      Toca los 3 puntos <MoreVertical className="inline h-3.5 w-3.5 text-slate-700" /> arriba a la derecha en Chrome.
                    </p>
                  </div>
                </li>
                <li className="flex items-start gap-3 rounded-xl border border-slate-200/80 bg-slate-50/60 p-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[11px] font-semibold text-white">
                    2
                  </span>
                  <div className="min-w-0 text-xs text-slate-700">
                    <p className="font-semibold text-slate-900">Toca &ldquo;Instalar aplicación&rdquo;</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      También puede aparecer como <strong>Agregar a pantalla principal</strong>.
                    </p>
                  </div>
                </li>
              </ol>
            )}

            {/* Pasos PC fallback */}
            {platform === "desktop" && (
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3.5 text-xs leading-relaxed text-slate-600">
                Haz clic en el ícono de <strong className="text-slate-900">Instalar</strong>{" "}
                <Download className="inline h-3.5 w-3.5 text-blue-600" /> ubicado en el extremo derecho de la barra de direcciones de Chrome o Edge.
              </div>
            )}
          </div>

          <DialogFooter className="flex-row items-center justify-between gap-2 border-t border-slate-100 bg-white px-5 py-3.5 sm:justify-between">
            {(isInAppBrowser || isIosNonSafari) ? (
              <Button
                type="button"
                variant="outline"
                onClick={handleCopyUrl}
                className="h-9 rounded-xl border-slate-200 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                {copiedUrl ? (
                  <>
                    <Check className="mr-1.5 h-3.5 w-3.5 text-emerald-600" />
                    Copiado
                  </>
                ) : (
                  <>
                    <Copy className="mr-1.5 h-3.5 w-3.5 text-blue-600" />
                    Copiar enlace
                  </>
                )}
              </Button>
            ) : (
              <span />
            )}

            <Button
              type="button"
              onClick={() => setGuideOpen(false)}
              className="h-9 rounded-xl bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 px-4 text-xs font-semibold text-white shadow-sm hover:opacity-95"
            >
              Entendido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PwaInstallContext.Provider>
  );
}

export function usePwaInstall() {
  const ctx = useContext(PwaInstallContext);
  if (!ctx) {
    throw new Error("usePwaInstall must be used within PwaInstallProvider");
  }
  return ctx;
}
