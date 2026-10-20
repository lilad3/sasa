"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Panier : identifiant produit → quantité. Il vit dans le navigateur ; le serveur ne le croit pas. */
export type Cart = Readonly<Record<string, number>>;

const EMPTY: Cart = Object.freeze({});
const listeners = new Set<() => void>();
const cache = new Map<string, Cart>();

const storageKey = (slug: string) => `akwaba:panier:${slug}`;

function read(slug: string): Cart {
  const cached = cache.get(slug);
  if (cached) return cached;
  let cart: Cart = EMPTY;
  try {
    const raw = JSON.parse(window.localStorage.getItem(storageKey(slug)) ?? "{}");
    if (raw && typeof raw === "object") {
      cart = Object.fromEntries(
        Object.entries(raw).filter((entry): entry is [string, number] => Number.isInteger(entry[1]) && (entry[1] as number) > 0),
      );
    }
  } catch {
    // Navigation privée ou stockage bloqué : le panier reste en mémoire pour cet onglet.
  }
  cache.set(slug, cart);
  return cart;
}

function write(slug: string, cart: Cart) {
  cache.set(slug, cart);
  try {
    window.localStorage.setItem(storageKey(slug), JSON.stringify(cart));
  } catch {
    // Voir read() : sans stockage, le panier ne survit pas au rechargement, mais la commande reste possible.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Un autre onglet a modifié le panier : on relit au prochain rendu.
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith("akwaba:panier:")) {
      cache.clear();
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Le panier d'une boutique, partagé entre tous les composants de la page.
 * Au rendu serveur, le panier est vide ; le vrai contenu apparaît à l'hydratation.
 */
export function useCart(slug: string) {
  const cart = useSyncExternalStore(subscribe, () => read(slug), () => EMPTY);

  const setQuantity = useCallback(
    (productId: string, quantity: number) => {
      const next = { ...read(slug) };
      if (quantity > 0) next[productId] = quantity;
      else delete next[productId];
      write(slug, next);
    },
    [slug],
  );

  const clear = useCallback(() => write(slug, EMPTY), [slug]);

  return { cart, setQuantity, clear };
}
