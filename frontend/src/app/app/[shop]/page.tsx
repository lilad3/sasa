import type { Metadata } from "next";
import { Suspense } from "react";

import { Dashboard, DashboardSkeleton, periodFromParam } from "@/features/dashboard/dashboard";

export const metadata: Metadata = { title: "Vue d'ensemble" };

export default function ShopDashboardPage({ params, searchParams }: PageProps<"/app/[shop]">) {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <DashboardFromRoute params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function DashboardFromRoute({ params, searchParams }: Pick<PageProps<"/app/[shop]">, "params" | "searchParams">) {
  const [{ shop }, query] = await Promise.all([params, searchParams]);
  return <Dashboard slug={shop} period={periodFromParam(query.periode)} />;
}
