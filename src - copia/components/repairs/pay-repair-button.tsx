
"use client";

import { safeJsonStringify, cleanObject } from "@/lib/json-guard";
import { Button } from "@/components/ui/button";
import type { RepairJob } from "@/lib/types";
import { DollarSign } from "lucide-react";
import { useRouter } from "next/navigation";

type PayRepairButtonProps = {
    repairJob: RepairJob;
};

export function PayRepairButton({ repairJob }: PayRepairButtonProps) {
    const router = useRouter();

    const handlePay = () => {
        const cleanJob = cleanObject({
            id: repairJob.id,
            customerName: repairJob.customerName,
            customerPhone: repairJob.customerPhone,
            customerID: repairJob.customerID,
            deviceMake: repairJob.deviceMake,
            deviceModel: repairJob.deviceModel,
            reportedIssue: repairJob.reportedIssue,
            estimatedCost: repairJob.estimatedCost,
            amountPaid: repairJob.amountPaid,
            isPaid: repairJob.isPaid,
            status: repairJob.status,
            createdAt: repairJob.createdAt,
            isPromo: repairJob.isPromo,
            reservedParts: repairJob.reservedParts,
            consumedParts: repairJob.consumedParts
        });
        const repairData = encodeURIComponent(safeJsonStringify(cleanJob));
        router.push(`/dashboard/pos?repairJob=${repairData}`);
    };
    
    // Safety check: Don't render the button if there is no balance remaining.
    const remainingBalance = repairJob.estimatedCost - (repairJob.amountPaid || 0);
    if (remainingBalance <= 0.001) {
        return null;
    }


    return (
        <Button onClick={handlePay} variant="outline" size="sm" className="bg-green-500 text-white hover:bg-green-600 hover:text-white">
            <DollarSign className="mr-2 h-4 w-4" />
            Cobrar
        </Button>
    );
}
