"use client";

import { type ReactNode, useEffect, useRef } from "react";

import { cn } from "@/lib/cn";

/**
 * Feuille du bas : un vrai <dialog> modal (focus piégé, Échap, fond inerte). Se ferme aussi en tirant la poignée vers le bas.
 * Sur grand écran, elle se pose en bas et centrée, sans changer de gestes.
 */
export function Sheet({ open, onClose, title, children, className }: { open: boolean; onClose: () => void; title: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const drag = useRef<number | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(event) => {
        // Un appui sur le fond (le <dialog> lui-même, pas son contenu) ferme la feuille.
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        "fixed inset-x-0 bottom-0 m-0 mx-auto max-h-[92dvh] w-full max-w-xl overflow-y-auto overscroll-contain rounded-t-[28px] border border-trait bg-nuit-2 p-0 text-texte",
        "shadow-[0_-18px_60px_rgb(0_0_0/0.55)] backdrop:bg-nuit/70 backdrop:backdrop-blur-sm",
        className,
      )}
    >
      {open ? (
        <div className="flex flex-col gap-4 px-5 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div
            aria-hidden
            className="mx-auto flex h-7 w-full max-w-[160px] cursor-grab touch-none items-center justify-center"
            onPointerDown={(event) => {
              drag.current = event.clientY;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerUp={(event) => {
              if (drag.current !== null && event.clientY - drag.current > 70) onClose();
              drag.current = null;
            }}
          >
            <span className="h-1 w-10 rounded-full bg-texte-3/60" />
          </div>
          <h2 className="text-lg font-medium">{title}</h2>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
