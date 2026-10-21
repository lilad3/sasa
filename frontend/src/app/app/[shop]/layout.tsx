import { Suspense } from "react";

import { FondNuit } from "@/components/ui/fond-nuit";
import { Sidebar, SidebarSkeleton } from "@/features/dashboard/sidebar";
import { NotesBannerFromRoute } from "@/features/notes/banner";

/**
 * Espace marchand : le décor vit (la lumière passe derrière le verre cannelé) mais reste voilé pour la lecture des chiffres.
 * Grille en lames : barre latérale sur 2 lames, contenu sur 10 (12 sur ordinateur, 8 sur tablette, 4 sur mobile).
 */
export default function ShopLayout({ children, params }: LayoutProps<"/app/[shop]">) {
  return (
    <div className="relative isolate">
      <FondNuit />
      <div className="grid min-h-dvh grid-cols-4 content-start gap-2.5 p-3 md:grid-cols-8 md:gap-3 md:p-[18px] lg:grid-cols-12 lg:gap-3.5 lg:p-5">
        <Suspense fallback={<SidebarSkeleton />}>
          <ShopSidebar params={params} />
        </Suspense>
        <main id="contenu" className="cascade col-span-4 grid grid-cols-subgrid content-start gap-y-2.5 md:col-span-8 md:gap-y-3 lg:col-span-10 lg:gap-y-3.5">
          {/* Le mot du patron non lu, épinglé en haut de chaque page jusqu'à « C'est noté ». */}
          <Suspense fallback={null}>
            <NotesBannerFromRoute params={params} />
          </Suspense>
          {children}
        </main>
      </div>
    </div>
  );
}

async function ShopSidebar({ params }: { params: LayoutProps<"/app/[shop]">["params"] }) {
  const { shop } = await params;
  return <Sidebar slug={shop} />;
}
