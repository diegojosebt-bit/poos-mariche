
"use client";

import { useDoc, useFirebase, useMemoFirebase } from "@/firebase";
import { doc } from "firebase/firestore";
import { Megaphone, X, Info, AlertTriangle } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

export function GlobalAnnouncement() {
    const { firestore } = useFirebase();
    const [isVisible, setIsVisible] = useState(true);

    const announcementRef = useMemoFirebase(() => 
        firestore ? doc(firestore, 'system', 'announcements') : null,
        [firestore]
    );
    const { data: announcement } = useDoc<any>(announcementRef);

    if (!announcement || !announcement.active || !isVisible) return null;

    const bgColor = announcement.type === 'critical' ? 'bg-destructive' : 
                    announcement.type === 'warning' ? 'bg-amber-500' : 'bg-primary';
    
    const textColor = 'text-white';

    return (
        <div className={cn("relative w-full px-4 py-2 flex items-center justify-center gap-3 transition-all", bgColor, textColor)}>
            <div className="flex items-center gap-2 max-w-4xl">
                {announcement.type === 'critical' ? <AlertTriangle className="w-4 h-4" /> : <Megaphone className="w-4 h-4" />}
                <p className="text-sm font-bold tracking-tight text-center">
                    {announcement.message}
                </p>
            </div>
            <button 
                onClick={() => setIsVisible(false)}
                className="absolute right-4 hover:bg-white/20 p-1 rounded-full"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
    );
}
