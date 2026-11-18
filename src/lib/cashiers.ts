import type {
  ActiveOperator,
  CashierPermissions,
  CashierProfile,
  CashierRolePreset,
  PlanTier,
  UserModule,
  UserProfile,
} from './types';

export const OWNER_OPERATOR_ID = 'owner';
export const DEFAULT_MAX_REGISTERS = 1;
export const DEFAULT_MAX_CASHIERS = 2;

export const PLAN_PRESETS: Record<
  PlanTier,
  {
    id: PlanTier;
    label: string;
    description: string;
    maxRegisters: number;
    maxCashiers: number;
  }
> = {
  basic: {
    id: 'basic',
    label: 'Básico',
    description: '1 caja a la vez · hasta 2 cajeros por turnos',
    maxRegisters: 1,
    maxCashiers: 2,
  },
  multi: {
    id: 'multi',
    label: 'Multi-Caja',
    description: 'Hasta 3 cajas simultáneas · 6 cajeros',
    maxRegisters: 3,
    maxCashiers: 6,
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    description: 'Hasta 6 cajas simultáneas · 15 cajeros',
    maxRegisters: 6,
    maxCashiers: 15,
  },
};

export const CASHIER_ROLE_PRESETS: Record<
  CashierRolePreset,
  {
    id: CashierRolePreset;
    label: string;
    description: string;
    permissions: CashierPermissions;
  }
> = {
  cashier: {
    id: 'cashier',
    label: 'Cajero',
    description: 'Cobra en POS, gestiona fiados, reparaciones y cierra su propia caja.',
    permissions: {
      modules: ['pos', 'repairs', 'fiados', 'reports'],
      canViewCostsAndProfits: false,
      canEditProducts: false,
      canDeleteRecords: false,
      canGiveDiscounts: false,
      canViewAllCashiersReports: false,
    },
  },
  technician: {
    id: 'technician',
    label: 'Técnico / Taller',
    description: 'Registra reparaciones, consulta inventario y puede pasar a cobro en POS.',
    permissions: {
      modules: ['repairs', 'inventory', 'pos'],
      canViewCostsAndProfits: false,
      canEditProducts: false,
      canDeleteRecords: false,
      canGiveDiscounts: false,
      canViewAllCashiersReports: false,
    },
  },
  manager: {
    id: 'manager',
    label: 'Encargado',
    description: 'Acceso amplio operativo incluyendo inventario, gastos y reportes.',
    permissions: {
      modules: ['pos', 'inventory', 'repairs', 'fiados', 'expenses', 'reports'],
      canViewCostsAndProfits: false,
      canEditProducts: true,
      canDeleteRecords: false,
      canGiveDiscounts: true,
      canViewAllCashiersReports: true,
    },
  },
};

export const CASHIER_ASSIGNABLE_MODULES: { id: UserModule; label: string }[] = [
  { id: 'pos', label: 'Punto de Venta' },
  { id: 'inventory', label: 'Inventario' },
  { id: 'repairs', label: 'Reparaciones' },
  { id: 'fiados', label: 'Fiados' },
  { id: 'expenses', label: 'Gastos y Egresos' },
  { id: 'reports', label: 'Reportes / Mi Caja' },
  { id: 'analysis', label: 'Análisis' },
];

export function getEffectivePlanLimits(profile: UserProfile | null | undefined) {
  const tier: PlanTier = profile?.planTier || 'basic';
  const preset = PLAN_PRESETS[tier] || PLAN_PRESETS.basic;
  const maxRegisters =
    typeof profile?.maxRegisters === 'number' && profile.maxRegisters >= 1
      ? Math.floor(profile.maxRegisters)
      : preset.maxRegisters;
  const maxCashiers =
    typeof profile?.maxCashiers === 'number' && profile.maxCashiers >= 0
      ? Math.floor(profile.maxCashiers)
      : preset.maxCashiers;

  return {
    planTier: tier,
    planLabel: preset.label,
    maxRegisters,
    maxCashiers,
    isMultiRegister: maxRegisters > 1,
  };
}

export function getActiveCashiers(profile: UserProfile | null | undefined): CashierProfile[] {
  return (profile?.cashiers || []).filter((c) => c.active);
}

export function hasCashierSystemActive(profile: UserProfile | null | undefined): boolean {
  return getActiveCashiers(profile).length > 0;
}

export function buildOwnerOperator(profile: UserProfile | null | undefined): ActiveOperator {
  return {
    id: OWNER_OPERATOR_ID,
    name: profile?.accountName?.trim() || 'Dueño',
    isOwner: true,
  };
}

export function buildCashierOperator(cashier: CashierProfile): ActiveOperator {
  return {
    id: cashier.id,
    name: cashier.name,
    isOwner: false,
    role: cashier.role,
    permissions: cashier.permissions,
  };
}

export function canOperatorAccessModule(
  operator: ActiveOperator | null,
  module: UserModule | 'settings' | 'admin',
): boolean {
  if (!operator || operator.isOwner) return true;
  if (module === 'admin' || module === 'settings') return false;
  return operator.permissions.modules.includes(module);
}

export function canOperatorPerform(
  operator: ActiveOperator | null,
  action: keyof Omit<CashierPermissions, 'modules'>,
): boolean {
  if (!operator || operator.isOwner) return true;
  return operator.permissions[action] === true;
}

export function createCashierId(): string {
  return `cashier_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
