
import type { SVGProps } from 'react';

export function AppLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 256"
      aria-label="POS Mariche Logo"
      {...props}
    >
      <defs>
        <linearGradient id="logoAwningGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style={{ stopColor: '#ffffff', stopOpacity: 1 }} />
          <stop offset="100%" style={{ stopColor: '#a5b4fc', stopOpacity: 1 }} />
        </linearGradient>
      </defs>

      {/* Fondo Azul Vibrante Redondeado (Base de la tienda) */}
      <rect x="28" y="56" width="200" height="180" rx="32" fill="#2532c2" />

      {/* Toldo (Estilo Moderno con ondas) */}
      <g>
        {/* 4 Lóbulos redondeados que crean el efecto ondulado del toldo */}
        <rect x="28" y="24" width="50" height="80" rx="25" fill="url(#logoAwningGrad)" />
        <rect x="78" y="24" width="50" height="80" rx="25" fill="url(#logoAwningGrad)" />
        <rect x="128" y="24" width="50" height="80" rx="25" fill="url(#logoAwningGrad)" />
        <rect x="178" y="24" width="50" height="80" rx="25" fill="url(#logoAwningGrad)" />
        {/* Conector superior del toldo para que sea una pieza sólida arriba */}
        <rect x="28" y="24" width="200" height="40" fill="url(#logoAwningGrad)" />
      </g>

      {/* Paneles frontales (Estilo ventanas de la imagen) */}
      <rect x="60" y="145" width="60" height="75" rx="12" fill="#c7d2fe" />
      <rect x="136" y="145" width="60" height="50" rx="12" fill="#ffffff" />
    </svg>
  );
}
