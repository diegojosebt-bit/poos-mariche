# Despliegue en Vercel

> El sistema es una app Next.js 14 (App Router). Firestore/Auth siguen en Firebase; Vercel solo sirve la app y la ruta `/api/bcv-rate`.

---

## 1. Antes de subir

- [ ] `npm install` (sincroniza `package-lock.json`; **no uses `npm ci`** hasta que el lock esté commiteado).
- [ ] `npm run typecheck` sin errores.
- [ ] `npm run build` local (opcional pero recomendado).
- [ ] Commit y push del repo a GitHub/GitLab.
- [ ] Índices, reglas, claims y backfill ya desplegados (pasos 3–6 del runbook).

> `apphosting.yaml` y `firebase.json` son de Firebase; Vercel los ignora. No los borres.

---

## 2. Importar en Vercel

1. Vercel → **Add New → Project** → importa el repo.
2. Framework preset: **Next.js** (autodetectado).
3. Build Command: `npm run build` (por defecto).
4. Output Directory: `.next` (por defecto).
5. Install Command: `npm install` (por defecto). Si Vercel intenta `npm ci` y falla, cambia a `npm install`.
6. Node.js Version: **22.x** (ya fijado en `package.json` → `engines.node`).
7. Variables de entorno: **ninguna obligatoria** (la config de Firebase está en `firebase-applet-config.json`, que es pública).

Deploy.

---

## 3. Firebase Auth

1. Firebase Console → **Authentication → Settings → Authorized domains**.
2. Añade el dominio de Vercel (`tu-proyecto.vercel.app`) y tu dominio propio si lo usas.
3. Con email/contraseña no es estrictamente necesario, pero evita problemas con enlaces y OAuth.

---

## 4. Después del deploy

| Prueba | Esperado |
|---|---|
| Login | entra al POS |
| POS | ~100 productos, “Cargar 100 más” |
| Búsqueda “bater” | encuentra fuera de la página 1 |
| Inventario / Reparaciones | 100 + cargar más |
| Reportes de un mes pasado | totales correctos (stats) |
| Fiados / Gastos | 50 por página; totales correctos |
| Análisis | 1 lectura por mes, sin cargar catálogo |
| `/api/bcv-rate` | responde con tasas |

Abre `https://tu-dominio/dashboard/pos?reads=1` para ver el medidor.

---

## 5. Variables y límites

- No hay secretos en el cliente: la `apiKey` de Firebase es pública por diseño; la seguridad está en las reglas.
- `/api/bcv-rate` hace fetch a APIs externas con `revalidate: 60`; no requiere claves.
- Región de Vercel: elige la más cercana a tus usuarios (p. ej. `iad1`). Firestore no cambia de región.
- El plan gratuito de Vercel es suficiente para esta app.

---

## 6. Qué no es bloqueante para desplegar

Estas mejoras quedan pendientes, pero no impiden usar el sistema con las banderas activas:

- Dashboard leyendo `stats_monthly` (hoy: 50 ventas + 100 reparaciones).
- Exportaciones paginadas.
- Admin sin listados masivos.
- Limpieza Fase 5 (`inventory_status`, código legacy, service worker).

---

## 7. Rollback

- Vercel → Deployments → **Promote** a un deployment anterior.
- En Firestore, poner `featureFlags.pagedData = false` revierte las pantallas al comportamiento anterior sin redeploy.
