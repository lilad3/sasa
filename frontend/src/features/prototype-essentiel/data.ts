// Prototype P16 (docs/chantier-a2-essentiel.md) : une boutique de démonstration, sans Django.
// Les photos sont dans public/prototype-essentiel/, ignoré par git (voir le contrat, « Lancer le prototype »).
// À supprimer à l'étape 2, avec tout le dossier features/prototype-essentiel et la route /prototype/essentiel.

import type { DeliveryZone, PaymentMethod } from "@/lib/types";

export type ProtoProduct = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  price: number;
  images: string[];
  in_stock: boolean;
  low_stock: boolean;
  max_quantity: number;
};

const photo = (name: string) => `/prototype-essentiel/${name}.jpg`;

export const SHOP = {
  slug: "maison-adjoua",
  name: "Maison Adjoua",
  city: "Abidjan",
  accent: "#ff7a1f",
  delivery_zones: [
    { id: "z1", city: "Abidjan", commune: "Cocody", label: "Cocody", fee: 1000, delay_hours: 24 },
    { id: "z2", city: "Abidjan", commune: "Plateau", label: "Plateau", fee: 1000, delay_hours: 24 },
    { id: "z3", city: "Abidjan", commune: "Marcory", label: "Marcory", fee: 1000, delay_hours: 24 },
    { id: "z4", city: "Abidjan", commune: "Yopougon", label: "Yopougon", fee: 1500, delay_hours: 24 },
    { id: "z5", city: "Abidjan", commune: "Abobo", label: "Abobo", fee: 1500, delay_hours: 24 },
    { id: "z6", city: "Abidjan", commune: "Koumassi", label: "Koumassi", fee: 1500, delay_hours: 24 },
    { id: "z7", city: "Bouaké", commune: "", label: "Bouaké", fee: 3000, delay_hours: 72 },
  ] satisfies DeliveryZone[],
  payment_methods: [
    { id: "wave", label: "Wave" },
    { id: "orange_money", label: "Orange Money" },
    { id: "cash_on_delivery", label: "À la livraison" },
  ] satisfies { id: PaymentMethod; label: string }[],
};

export const PRODUCTS: ProtoProduct[] = [
  {
    id: "p1",
    slug: "ensemble-wax-feuillage",
    name: "Ensemble wax Feuillage",
    description:
      "Haut ajusté et jupe droite, cousus à Treichville dans un wax hollandais aux grandes feuilles bleues et vertes. Tailles 38 à 46, retouches offertes.",
    category: "Ensembles",
    price: 24000,
    images: [photo("feuillage-1"), photo("feuillage-2"), photo("feuillage-3")],
    in_stock: true,
    low_stock: false,
    max_quantity: 6,
  },
  {
    id: "p2",
    slug: "pagne-fleurs-de-mariage",
    name: "Pagne Fleurs de mariage, 6 yards",
    description: "Le motif des cérémonies : fleurs rouges sur fond jaune soleil. Coton épais, couleurs qui tiennent au lavage.",
    category: "Pagnes",
    price: 12500,
    images: [photo("fleurs-1"), photo("fleurs-2")],
    in_stock: true,
    low_stock: false,
    max_quantity: 10,
  },
  {
    id: "p3",
    slug: "bogolan-rouge",
    name: "Bogolan rouge, coupon 2 yards",
    description: "Teint à la terre, motifs tracés à la main. Pour un coussin, une veste ou une nappe.",
    category: "Pagnes",
    price: 9000,
    images: [photo("bogolan-1"), photo("bogolan-2")],
    in_stock: true,
    low_stock: true,
    max_quantity: 2,
  },
  {
    id: "p4",
    slug: "beurre-de-karite-brut",
    name: "Beurre de karité brut, 500 g",
    description: "Pressé à froid par une coopérative de Korhogo. Sans parfum ajouté.",
    category: "Épicerie",
    price: 3500,
    images: [],
    in_stock: true,
    low_stock: false,
    max_quantity: 12,
  },
  {
    id: "p5",
    slug: "lot-de-6-pagnes",
    name: "Lot de 6 pagnes assortis",
    description: "Six coupons de 2 yards, motifs mélangés : de quoi habiller toute la famille pour la fête.",
    category: "Pagnes",
    price: 45000,
    images: [photo("lot-1"), photo("lot-2")],
    in_stock: true,
    low_stock: false,
    max_quantity: 4,
  },
  {
    id: "p6",
    slug: "kita-jaune",
    name: "Kita jaune tissé main",
    description: "Bandes tissées à Bondoukou, assemblées en pagne de 2 mètres.",
    category: "Pagnes",
    price: 32000,
    images: [photo("kita-1")],
    in_stock: true,
    low_stock: false,
    max_quantity: 3,
  },
  {
    id: "p7",
    slug: "pagne-baoule-raye",
    name: "Pagne baoulé rayé indigo",
    description: "Rayures indigo sur coton écru, tissé à Tiébissou.",
    category: "Pagnes",
    price: 27500,
    images: [photo("baoule-1")],
    in_stock: false,
    low_stock: false,
    max_quantity: 0,
  },
  {
    id: "p8",
    slug: "cafe-robusta-de-man",
    name: "Café robusta de Man, 1 kg",
    description: "Grains torréfiés la semaine de l'envoi. Moulu sur demande.",
    category: "Épicerie",
    price: 6000,
    images: [],
    in_stock: true,
    low_stock: false,
    max_quantity: 10,
  },
];

export const FEATURED = PRODUCTS[0];
