"use client";

import { ChunkErrorFallback } from "@/components/chunk-error-fallback";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <body>
        <ChunkErrorFallback error={error} reset={reset} />
      </body>
    </html>
  );
}
