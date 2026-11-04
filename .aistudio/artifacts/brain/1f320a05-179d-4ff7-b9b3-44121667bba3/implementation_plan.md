# Plan de Ciberseguridad e Implementación: Bloqueo de Eliminación de Datos con PIN de Administrador

## 1. Diagnóstico de Seguridad y Vulnerabilidad Actual
Al auditar el código fuente del sistema se identificó una falla de diseño crítico en `src/components/admin-auth-dialog.tsx`:
- La validación del PIN estaba condicionada a `profile.isPinRequired !== true`.
- Este indicador (`isPinRequired`) fue concebido originalmente para bloquear la navegación de pestañas (`lockedModules` como Reportes o Administración).
- **Vulnerabilidad**: Si el administrador desactivaba el bloqueo de navegación para que los empleados pudieran ver el sistema, **quedaban desprotegidos los botones de eliminar**. Cualquier empleado o cajero podía borrar ventas, inventario, reparaciones o deudas de fiados sin contraseña alguna.

---

## 2. Nueva Arquitectura de Seguridad (Principio de Menor Privilegio)

Separaremos la seguridad en dos capas independientes:
1. **Capa A: Bloqueo de Módulos (Navegación)**: Controla qué pestañas del menú lateral puede abrir el personal (`lockedModules`).
2. **Capa B: Bloqueo de Datos (Acciones Destructivas)**: Controla qué operaciones críticas (Eliminar Ventas, Reparaciones, Productos, Fiados, Gastos) requieren estrictamente la autorización del Administrador mediante PIN.

### Parámetros en el Perfil de Usuario (`UserProfile` en `src/lib/types.ts`):
```typescript
export interface UserProfile {
  // ... campos existentes
  securityPin?: string;           // PIN numérico o clave maestra (4-8 dígitos)
  isPinRequired?: boolean;        // Bloqueo de módulos de navegación
  lockedModules?: UserModule[];   // Módulos protegidos en el sidebar
  
  // NUEVOS CAMPOS DE CIBERSEGURIDAD:
  isDataDeletionLocked?: boolean; // Interruptor maestro de Bloqueo de Datos
  protectedDataActions?: {        // Opciones granulares de protección
    deleteSales?: boolean;        // Reembolsar o anular ventas
    deleteRepairs?: boolean;      // Eliminar órdenes de reparación
    deleteProducts?: boolean;     // Eliminar artículos del inventario
    deleteFiados?: boolean;       // Eliminar cuentas de crédito o deudas
    deleteExpenses?: boolean;     // Eliminar egresos o gastos de caja
  };
}
```

---

## 3. Nueva Área en Configuración (`src/app/dashboard/settings/page.tsx`)

Añadiremos una nueva tarjeta visual destacada con diseño de seguridad y advertencia:
### **"🔒 Bloqueo y Protección de Datos"**
- **Switch Principal**: `Activar Bloqueo de Datos contra Eliminaciones`.
- **Explicación Clara**: *"Al estar activado, nadie podrá anular una venta, eliminar un producto, borrar una reparación o cancelar un fiado sin ingresar el PIN de Administrador."*
- **Selector de Protección Granular**:
  - `[✔] Protección de Ventas (Reembolsos y anulaciones)`
  - `[✔] Protección de Reparaciones (Eliminar órdenes)`
  - `[✔] Protección de Inventario (Eliminar productos)`
  - `[✔] Protección de Fiados (Eliminar clientes deudores)`
  - `[✔] Protección de Gastos (Eliminar registros de gastos)`
- **Gestión Inmediata del PIN**:
  - Si el usuario activa el switch y no tiene un PIN configurado, la interfaz le solicitará definirlo en ese mismo instante para evitar estados inconsistentes.

---

## 4. Blindaje del Componente `AdminAuthDialog` (`src/components/admin-auth-dialog.tsx`)

Rediseño completo del modal de autenticación con estándares de ciberseguridad:
1. **Condición Infranqueable**:
   - Si `isDataDeletionLocked === true` (o si la acción específica está protegida), **NUNCA** se salta la autenticación, incluso si el bloqueo de módulos está apagado.
2. **Protección Anti-Fuerza Bruta (Rate Limiting en UI)**:
   - Contador de intentos fallidos.
   - Si se ingresan **3 intentos erróneos consecutivos**, se bloquea el diálogo por **30 segundos** con un temporizador regresivo visible, impidiendo que un empleado pruebe combinaciones rápidas.
3. **Visibilidad y Privacidad**:
   - Campo de contraseña enmascarado con botón de alternancia (`Ver / Ocultar PIN`).
   - Teclado numérico o soporte de `Enter` directo.
   - Mensaje contextual del registro a eliminar: *"Autorización requerida: Estás a punto de eliminar un registro crítico del sistema"*.

---

## 5. Auditoría de los Módulos Protegidos

Revisaremos y aseguraremos los 5 módulos clave:
1. **Ventas y Reportes (`src/components/reports/transaction-list.tsx`)**:
   - Reembolso de tickets y anulación de transacciones protegidos por `actionType="deleteSales"`.
2. **Reparaciones (`src/components/repairs/columns.tsx`)**:
   - Eliminación de trabajos de reparación protegido por `actionType="deleteRepairs"`.
3. **Inventario (`src/components/inventory/columns.tsx`)**:
   - Eliminación de productos protegido por `actionType="deleteProducts"`.
4. **Fiados (`src/app/dashboard/fiados/page.tsx`)**:
   - Eliminación de registros o cuentas de fiados protegido por `actionType="deleteFiados"`.
5. **Gastos (`src/app/dashboard/expenses/page.tsx`)**:
   - Eliminación de egresos protegido por `actionType="deleteExpenses"`.

---

## 6. Fases de Ejecución

1. **Fase 1: Tipos y Estado Global**
   - Actualizar `UserProfile` en `src/lib/types.ts` con `isDataDeletionLocked` y `protectedDataActions`.
2. **Fase 2: Componente `AdminAuthDialog`**
   - Implementar la lógica segura, evaluación de `isDataDeletionLocked`, rate-limiting de 3 intentos y bloqueo temporal de 30s.
3. **Fase 3: Vista de Configuración (`settings/page.tsx`)**
   - Crear el área "Bloqueo de Datos", switches de protección y sincronización con Firestore / Store de Zustand.
4. **Fase 4: Enlace en Módulos (Ventas, Reparaciones, Productos, Fiados, Gastos)**
   - Pasar la propiedad correspondiente de acción a cada `AdminAuthDialog`.
5. **Fase 5: Pruebas y Compilación**
   - Ejecutar `compile_applet` para garantizar cero errores de TypeScript y compilación óptima.

---

## 7. Pregunta para Aprobación
¿Estás de acuerdo con este plan para proceder a implementar la separación entre Bloqueo de Módulos y Bloqueo de Datos con PIN seguro y protección anti-fuerza bruta?
