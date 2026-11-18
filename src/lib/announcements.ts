export type AnnouncementType = "info" | "warning" | "critical";

export type AnnouncementItem = {
  id: string;
  message: string;
  type: AnnouncementType;
  active: boolean;
  updatedAt: string;
};

export type AnnouncementsDocument = {
  items?: AnnouncementItem[];
  version?: number;
  // Compatibilidad con el comunicado único anterior.
  message?: string;
  type?: AnnouncementType;
  active?: boolean;
  updatedAt?: string;
};

export function normalizeAnnouncements(doc: unknown): AnnouncementItem[] {
  const data = (doc || {}) as AnnouncementsDocument;

  if (Array.isArray(data.items)) {
    return data.items
      .filter((item) => item && typeof item.message === "string")
      .map((item) => ({
        id: item.id || crypto.randomUUID(),
        message: item.message,
        type: (item.type || "info") as AnnouncementType,
        active: item.active !== false,
        updatedAt: item.updatedAt || data.updatedAt || "",
      }));
  }

  // Documento antiguo: { message, type, active }
  if (typeof data.message === "string" && data.message.trim()) {
    return [{
      id: "legacy",
      message: data.message,
      type: (data.type || "info") as AnnouncementType,
      active: data.active !== false,
      updatedAt: data.updatedAt || "",
    }];
  }

  return [];
}

export function announcementKey(item: AnnouncementItem): string {
  return `${item.id}:${item.updatedAt || ""}`;
}

export function newAnnouncement(): AnnouncementItem {
  return {
    id: typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `a-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    message: "",
    type: "info",
    active: true,
    updatedAt: new Date().toISOString(),
  };
}
