"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useFirebase, setDocumentNonBlocking } from "@/firebase";
import { doc, collection, runTransaction } from "firebase/firestore";
import type { Product, PaymentMethod, Expense } from "@/lib/types";
import { useCurrency } from "@/hooks/use-currency";
import { PackagePlus, DollarSign, CreditCard, Landmark, Banknote, Smartphone, Loader2, AlertCircle } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

const paymentMethodOptions: { value: PaymentMethod, label: string, icon: any, isBs: boolean }[] = [
    { value: 'Efectivo USD', label: 'Efectivo USD', icon: DollarSign, isBs: false },
    { value: 'Efectivo Bs', label: 'Efectivo Bs', icon: Landmark, isBs: true },
    { value: 'Tarjeta / Pago Móvil', label: 'Tarjeta / Pago Móvil', icon: Smartphone, isBs: true },
    { value: 'Transferencia', label: 'Transferencia', icon: Banknote, isBs: true },
];

interface ReplenishStockDialogProps {
  product: Product;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReplenishStockDialog({ product, isOpen, onOpenChange }: ReplenishStockDialogProps) {
  const { firestore, user } = useFirebase();
  const { toast } = useToast();
  const { format: formatCurrency, bcvRate, convert } = useCurrency();
  const [loading, setLoading] = useState(false);

  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState(String(product.costPrice || 0));
  const [registerExpense, setRegisterExpense] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("Efectivo USD");

  const totalCostUSD = useMemo(() => {
    const q = parseFloat(quantity) || 0;
    const c = parseFloat(unitCost) || 0;
    return q * c;
  }, [quantity, unitCost]);

  const totalCostBS = useMemo(() => totalCostUSD * bcvRate, [totalCostUSD, bcvRate]);

  const handleReplenish = async () => {
    if (!firestore || !user || !quantity || parseFloat(quantity) <= 0) return;

    setLoading(true);
    try {
      await runTransaction(firestore, async (transaction) => {
        const productRef = doc(firestore, 'users', user.uid, 'products', product.id!);
        const productSnap = await transaction.get(productRef);
        
        if (!productSnap.exists()) throw new Error("El producto ya no existe.");
        
        const currentData = productSnap.data() as Product;
        const newStock = (currentData.stockLevel || 0) + parseFloat(quantity);
        const newCost = parseFloat(unitCost) || currentData.costPrice;

        // 1. Actualizar Inventario
        transaction.update(productRef, {
          stockLevel: newStock,
          costPrice: newCost,
          updatedAt: new Date().toISOString()
        });

        // 2. Registrar Gasto si está marcado
        if (registerExpense && totalCostUSD > 0) {
          const expenseRef = doc(collection(firestore, 'users', user.uid, 'expenses'));
          const isBsMethod = paymentMethod !== 'Efectivo USD';
          
          const expenseData: Expense = {
            id: expenseRef.id,
            description: `REPOSICIÓN: ${quantity}x ${product.name}`,
            category: 'Mercancía',
            amountUSD: isBsMethod ? 0 : totalCostUSD,
            amountBs: isBsMethod ? totalCostBS : 0,
            methodUSD: 'Efectivo USD',
            methodBs: paymentMethod,
            createdAt: new Date().toISOString()
          };
          transaction.set(expenseRef, expenseData);
        }
      });

      toast({ 
        title: "Reposición Exitosa", 
        description: `Se han añadido ${quantity} unidades a ${product.name}.` 
      });
      onOpenChange(false);
      setQuantity("");
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent 
        className="sm:max-w-md"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackagePlus className="w-5 h-5 text-primary" />
            Reposición: {product.name}
          </DialogTitle>
          <DialogDescription>
            Ingresa la cantidad que llegó y el costo pagado para actualizar stock y precios.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase">Cantidad Entrante</Label>
              <Input 
                type="number" 
                step="any" 
                placeholder="0" 
                value={quantity} 
                onChange={(e) => setQuantity(e.target.value)} 
                className="h-11 text-lg font-black"
                autoFocus
              />
              <p className="text-[10px] text-muted-foreground italic">Stock actual: {product.stockLevel}</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase">Costo Unitario ($)</Label>
              <div className="relative">
                <DollarSign className="absolute left-2.5 top-3 h-4 w-4 text-muted-foreground" />
                <Input 
                  type="number" 
                  step="0.01" 
                  value={unitCost} 
                  onChange={(e) => setUnitCost(e.target.value)} 
                  className="pl-8 h-11 text-lg font-black border-primary/20"
                />
              </div>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-900 text-white space-y-2 shadow-lg">
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Inversión Total</p>
            <div className="flex justify-between items-baseline">
              <span className="text-3xl font-black">${formatCurrency(totalCostUSD)}</span>
              <span className="text-sm font-bold text-slate-400">Bs {formatCurrency(totalCostBS)}</span>
            </div>
          </div>

          <div className="space-y-4 border-t pt-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-bold">Registrar Pago en Caja</Label>
                <p className="text-[10px] text-muted-foreground">Se creará un egreso en Tesorería automáticamente.</p>
              </div>
              <Switch checked={registerExpense} onCheckedChange={setRegisterExpense} />
            </div>

            {registerExpense && (
              <div className="space-y-2 animate-in slide-in-from-top-2 duration-200">
                <Label className="text-[10px] font-black uppercase text-muted-foreground">¿Con qué dinero se pagó?</Label>
                <Select value={paymentMethod} onValueChange={(v: any) => setPaymentMethod(v)}>
                  <SelectTrigger className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentMethodOptions.map(opt => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <div className="flex items-center gap-2">
                          <opt.icon className="w-4 h-4 opacity-70" />
                          <span className="text-xs font-bold uppercase">{opt.label}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {!registerExpense && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-[10px] text-amber-800 leading-tight">
                <strong>Atención:</strong> El stock subirá pero no se restará dinero de tu caja. Úsalo solo si la mercancía ya fue pagada anteriormente.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button 
            className="w-full h-12 text-base font-black shadow-lg" 
            onClick={handleReplenish} 
            disabled={loading || !quantity || parseFloat(quantity) <= 0}
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <PackagePlus className="w-5 h-5 mr-2" />}
            CONFIRMAR REPOSICIÓN
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}