import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Skeleton } from "../ui/skeleton";

type StatCardProps = {
    title: string;
    value: string | number;
    icon: ReactNode;
    description?: string;
    href?: string;
    isLoading?: boolean;
};

export default function StatCard({ title, value, icon, description, href, isLoading }: StatCardProps) {
    const cardContent = (
        <Card className={cn("transition-colors", href && "hover:border-primary")}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
                <div className="text-muted-foreground">{icon}</div>
            </CardHeader>
            <CardContent>
                 {isLoading ? (
                    <Skeleton className="h-8 w-24" />
                ) : (
                    <div className="text-2xl font-bold">{value}</div>
                )}
                {isLoading ? (
                    <Skeleton className="h-4 w-32 mt-1" />
                ) : (
                    description && <p className="text-xs text-muted-foreground">{description}</p>
                )}
            </CardContent>
        </Card>
    );

    if (href) {
        return <Link href={href}>{cardContent}</Link>;
    }

    return cardContent;
}
