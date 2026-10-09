import type { Timestamp } from "firebase/firestore";

export type ComboItem = {
  productId: string;
  productName: string;
  quantity: number;
}

export type ProductUnit = 'unit' | 'kg' | 'g' | 'lb' | 'liter';

export type Product = {
  id?: string;
  name: string;
  category: string;
  sku: string;
  barcode?: string;
  costPrice: number;
  promoPrice?: number;
  stockLevel: number;
  reservedStock: number;
  damagedStock: number;
  lowStockThreshold: number;
  compatibleModels?: string[];
  searchKeywords?: string[];
  isCombo?: boolean;
  comboItems?: ComboItem[];
  isGiftable?: boolean;
  isFixedPrice?: boolean;
  fixedPrice?: number;
  hasCustomMargin?: boolean;
  customMargin?: number;
  hasIVA?: boolean;
  hasDiscount?: boolean;
  discountAmount?: number;
  unit: ProductUnit;
  createdAt?: string;
  updatedAt?: any; 
  isDeleted?: boolean; 
  salesCount?: number; 
};

export type ReservedPart = {
  productId: string;
  productName: string;
  quantity: number;
  costPrice: number;
  isPromo?: boolean;
  isWarranty?: boolean;
  isManual?: boolean;
  manualPrice?: number; 
  manualPriceOffer?: number; 
}

export type RepairStatus = 'Pendiente' | 'Pagado' | 'Completado' | 'Garantía';

export type RepairJob = {
  id?: string;
  customerName: string;
  customerPhone: string;
  customerID?: string;
  customerAddress?: string;
  deviceMake: string;
  deviceModel: string;
  reportedIssue: string;
  initialConditionsChecklist?: string[];
  partsCost: number;
  laborCost: number;
  estimatedCost: number;
  amountPaid: number;
  isPaid: boolean;
  status: RepairStatus;
  notes?: string;
  createdAt: string;
  reservedParts?: ReservedPart[];
  consumedParts?: ReservedPart[]; 
  completedAt?: string;
  warrantyEndDate?: string;
  partsConsumed?: boolean; 
  isPromo?: boolean;
};

export type FiadoStatus = 'Pendiente' | 'Pagado';

export type FiadoItem = {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  costPrice: number;
  isPromo?: boolean;
};

export type Fiado = {
  id?: string;
  customerName: string;
  customerID: string;
  customerPhone: string;
  concept: string;
  totalAmount: number;
  amountPaid: number;
  totalCost: number;
  status: FiadoStatus;
  createdAt: string;
  dueDate?: string;
  notes?: string;
  items?: FiadoItem[];
  isPromo?: boolean;
};

export type Worker = {
  id?: string;
  name: string;
  phone?: string;
  active: boolean;
  createdAt: string;
};

export type PayrollPayment = {
  id?: string;
  workerId?: string;
  workerName: string;
  amountUSD: number;
  amountBs: number;
  methodUSD: PaymentMethod;
  methodBs: PaymentMethod;
  dateFrom: string;
  dateTo: string;
  createdAt: string;
  notes?: string;
  loanId?: string;
  loanDeduction?: number;
};

export type LoanStatus = 'active' | 'paid';

export type Loan = {
  id?: string;
  partnerName: string;
  totalAmount: number;
  remainingAmount: number;
  currency: Currency;
  sourceMethod: PaymentMethod;
  hasWeeklyDeduction: boolean;
  weeklyDeduction: number;
  status: LoanStatus;
  createdAt: string;
  notes?: string;
};

export type CurrencyExchange = {
  id?: string;
  bsAmount: number;
  usdAmount: number;
  rate: number;
  sourceMethod: PaymentMethod;
  notes?: string;
  createdAt: string;
};

export type BsTransfer = {
  id?: string;
  amountSent: number;
  amountReceived: number;
  sourceMethod: PaymentMethod;
  targetMethod: PaymentMethod;
  notes?: string;
  createdAt: string;
};

export type ExpenseCategory = 'Mercancía' | 'Servicios' | 'Alquiler' | 'Retiro Personal' | 'Otros';

export type Expense = {
  id?: string;
  description: string;
  category: ExpenseCategory;
  amountUSD: number;
  amountBs: number;
  methodUSD: PaymentMethod;
  methodBs: PaymentMethod;
  createdAt: string;
};

export type UserModule = 'inventory' | 'pos' | 'repairs' | 'reports' | 'analysis' | 'fiados' | 'inventory_aging' | 'expenses';

export type CartItem = {
  productId: string;
  quantity: number;
  name: string;
  isRepair?: boolean;
  isPromo?: boolean;
  isGift?: boolean;
  isWarranty?: boolean;
  isCustom?: boolean;
  customPrice?: number;
  customCostPrice?: number;
  costPrice?: number; 
  discount?: number;
};

export type HeldSale = {
  id: string;
  name: string;
  createdAt: string;
  items: CartItem[];
  customerName?: string;
  customerID?: string;
};

export type PaymentMethod = 'Efectivo USD' | 'Efectivo Bs' | 'Tarjeta' | 'Pago Móvil' | 'Transferencia' | 'Tarjeta / Pago Móvil' | 'USDT / Crypto';

export type Payment = {
  method: PaymentMethod;
  amount: number;
  reference?: string;
}

export type Sale = {
  id?: string;
  items: (CartItem & { price: number; costPrice: number })[];
  repairJobId?: string;
  fiadoId?: string;
  customerName?: string;
  customerID?: string;
  customerAddress?: string;
  consumedParts?: ReservedPart[];
  subtotal: number;
  discount: number;
  totalAmount: number;
  costPrice: number; 
  paymentMethod: string;
  transactionDate: string;
  payments: Payment[];
  status: 'completed' | 'refunded';
  refundedAt?: string;
  refundReason?: string;
  refundPaymentMethod?: PaymentMethod;
  reconciliationId?: string;
  totalChangeInUSD?: number;
  changeGiven?: Payment[];
  actualPaidAmount?: number;
  bcvRateAtTime?: number;
  parallelRateAtTime?: number;
  docType?: 'DELIVERY_NOTE' | 'FISCAL_INVOICE';
  isFiscal?: boolean;
  fiscalMetadata?: {
    invoiceNumber: string;
    controlNumber: string;
    bcvRate: number;
    ivaPercent: number;
    igtfPercent: number;
    authorizedPrintShop?: {
      name: string;
      rif: string;
      providence: string;
      date: string;
      range: string;
    };
  };
};

export type BusinessStats = {
  totalRealSales30d: number;
  totalRealProfit30d: number;
  updatedAt: string;
};

export type ReconciliationPaymentMethodSummary = {
  expected: number;
  counted: number;
  difference: number;
};

export type DailyReconciliation = {
  id: string;
  date: string;
  totalSales: number;
  totalTransactions: number;
  closedAt: string;
  paymentMethods: {
    [key in PaymentMethod]?: ReconciliationPaymentMethodSummary;
  };
  totalExpected: number;
  totalCounted: number;
  totalDifference: number;
  totalPaymentsReceived?: number;
  totalChangeGiven?: number;
  notes?: string;
};

export type Currency = 'USD' | 'Bs';

export type RepairInputMode = 'inventory' | 'manual' | 'both';

export type FiscalSettings = {
    businessName: string;
    businessRIF: string;
    businessAddress: string;
    businessPhone: string;
    printShopName: string;
    printShopRIF: string;
    providenceNumber: string;
    formatDate: string;
    authorizedRange: string;
};

export type AppSettings = {
    currency: Currency;
    bcvRate: number;
    parallelRate: number;
    profitMargin: number;
    autoUpdateBcv?: boolean;
    lastUpdated?: string;
    balancesUpdatedAt?: string;
    weeklyRent?: number;
    investmentPercentage?: number;
    partnersCount?: number;
    repairInputMode?: RepairInputMode;
    initialBalances?: {
        'Efectivo USD'?: number;
        'Efectivo Bs'?: number;
        'Tarjeta'?: number;
        'Pago Móvil'?: number;
        'Transferencia'?: number;
        'Tarjeta / Pago Móvil'?: number;
        'USDT / Crypto'?: number;
    };
};

export type UserProfile = {
  id?: string;
  uid: string;
  email: string;
  businessName?: string;
  businessAddress?: string;
  businessRIF?: string;
  showInfoOnReceipt?: boolean;
  showRateOnReceipt?: boolean;
  showTermsOnReceipt?: boolean;
  printLeftMargin?: number;
  licenseStatus: 'active' | 'expired' | 'trial';
  licenseExpiry: string;
  createdAt: string;
  isAdmin?: boolean;
  lastSessionId?: string;
  updatedAt?: string;
  enabledModules?: UserModule[];
  securityPin?: string;
  isPinRequired?: boolean;
  lockedModules?: UserModule[];
  repairWarrantyPolicy?: string;
  repairPickupPolicy?: string;
  repairDisclaimer?: string;
};
