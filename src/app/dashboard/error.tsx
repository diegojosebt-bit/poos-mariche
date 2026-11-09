"use client";

import { ChunkErrorFallback } from "@/components/chunk-error-fallback";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ChunkErrorFallback error={error} reset={reset} />;
}
