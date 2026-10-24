// Types du catalogue de l'espace marchand (contrat §4.3). Les clés restent en snake_case, comme dans les réponses de Django.
import type { ProductPhoto } from "@/lib/types";

export type ProductStatus = "draft" | "active" | "archived";
export type Condition = "new" | "refurbished" | "used";
export type SoldBy = "piece" | "kg" | "sachet" | "tas" | "litre";

export type Product = {
  id: string;
  slug: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  price: number;
  /** Prix avant réduction (affiché barré, jamais dans un calcul). */
  compare_at_price: number | null;
  /** Absents (clés absentes, pas null) pour qui n'a pas le droit products.cost : le propriétaire seul. */
  cost?: number | null;
  margin_amount?: number | null;
  margin_percent?: number | null;
  stock: number;
  low_stock_threshold: number;
  status: ProductStatus;
  /** Lecture seule, dérivée du statut (gardée une version pour les anciennes intégrations). */
  is_active: boolean;
  allow_backorder: boolean;
  backorder_days: number | null;
  backorder_limit: number;
  image_url: string;
  /** Le produit de la couverture de la vitrine ; se change par sa propre route (storefront.edit). */
  is_featured: boolean;
  tags: string[];
  condition: Condition | "";
  warranty_months: number | null;
  sold_by: SoldBy;
  one_of_a_kind: boolean;
  made_to_order: boolean;
  bulky: boolean;
  /** 3 au plus, la première est la principale. */
  photos: ProductPhoto[];
  created_at: string;
  updated_at: string;
};

/** En-tête de la page Produits : compteurs, rayons, étiquettes et limite du plan (null : sans limite). */
export type ProductOverview = {
  /** Hors archivés : c'est ce qui compte dans le plan. */
  count: number;
  active: number;
  draft: number;
  archived: number;
  limit: number | null;
  low_stock: number;
  out_of_stock: number;
  categories: string[];
  tags: { label: string; count: number }[];
  csv_import: boolean;
};

export type StockFilter = "low" | "out";
/** Par défaut : actifs et brouillons. */
export type StatusFilter = "all" | ProductStatus;

export type ProductFilters = { q?: string; category?: string; stock?: StockFilter; status?: StatusFilter; tag?: string; page: number };

/** Une variation de stock : en ajout seul, la preuve de ce qui s'est passé. */
export type StockMovement = {
  id: string;
  delta: number;
  stock_after: number;
  reason: StockReason;
  /** Libellé écrit par le serveur (« Vendu », « Annulation »…). */
  label: string;
  order: { id: string; reference: string } | null;
  actor: { name: string; is_you: boolean } | null;
  note: string;
  created_at: string;
};

export type StockReason = "initial" | "received" | "sold" | "cancelled" | "returned" | "damaged" | "correction" | "import";

export type MovementPage = { results: StockMovement[]; next_before: string | null };

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

/** Les actions de la modification en masse (contrat §A2.8). Le coût n'y figure jamais. */
export type BulkAction =
  | { type: "price"; mode: "set" | "percent"; value: number }
  | { type: "stock"; mode: "add" | "set"; value: number; reason: "received" | "returned" | "damaged" | "correction"; note?: string }
  | { type: "status"; status: ProductStatus }
  | { type: "tag_add"; label: string }
  | { type: "tag_remove"; label: string };
