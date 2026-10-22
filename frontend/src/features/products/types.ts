// Types du catalogue de l'espace marchand (contrat §4.3). Les clés restent en snake_case, comme dans les réponses de Django.
import type { ProductPhoto } from "@/lib/types";

export type Product = {
  id: string;
  slug: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  price: number;
  stock: number;
  low_stock_threshold: number;
  is_active: boolean;
  image_url: string;
  /** Le produit de la couverture de la vitrine ; se change par sa propre route (storefront.edit). */
  is_featured: boolean;
  /** 3 au plus, la première est la principale. */
  photos: ProductPhoto[];
  created_at: string;
  updated_at: string;
};

/** En-tête de la page Produits : compteurs, rayons et limite du plan (null : sans limite). */
export type ProductOverview = {
  count: number;
  active: number;
  limit: number | null;
  low_stock: number;
  out_of_stock: number;
  categories: string[];
  csv_import: boolean;
};

export type StockFilter = "low" | "out";

export type ProductFilters = { q?: string; category?: string; stock?: StockFilter; page: number };

/** Rapport d'import : tout ou rien, une seule ligne en erreur et rien n'est enregistré. */
export type ImportReport = {
  dry_run: boolean;
  rows: number;
  created: number;
  updated: number;
  error_count: number;
  /** `line` 0 : erreur qui porte sur tout le fichier (limite du plan). */
  errors: { line: number; field: string; code: string; message: string }[];
};
