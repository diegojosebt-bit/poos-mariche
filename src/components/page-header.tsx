"use client";

import type { ReactNode } from 'react';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

type PageHeaderProps = {
  title: string;
  children?: ReactNode;
};

export function PageHeader({ title, children }: PageHeaderProps) {
  return (
    <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur-md">
      <div className="flex h-14 sm:h-16 items-center justify-between gap-2 px-3 sm:px-6">
        <div className="flex flex-1 items-center gap-2 sm:gap-4 min-w-0">
          <SidebarTrigger className="shrink-0" />
          <h1 className="truncate text-base sm:text-lg md:text-xl font-bold tracking-tight text-slate-800">{title}</h1>
        </div>
        
        <div className="flex items-center gap-1 sm:gap-2 shrink-0">
          {children}
        </div>
      </div>
    </header>
  );
}
