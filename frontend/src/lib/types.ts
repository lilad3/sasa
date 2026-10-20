// Types du contrat d'API (docs/contrat-api.md). Les clés restent en snake_case, comme dans les réponses de Django.

export type Role = "owner" | "manager" | "seller";
export type Plan = "free" | "pro" | "business";

export type Me = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  mfa_enabled: boolean;
  is_demo: boolean;
  date_joined: string;
};

export type ShopMembership = {
  slug: string;
  name: string;
  role: Role;
  plan: Plan;
  permissions: string[];
};

export type AuthResult = {
  status: "authenticated";
  access: string;
  refresh: string;
  access_expires_in: number;
  refresh_expires_in: number;
  user: Me;
  shops: ShopMembership[];
};

export type MfaChallenge = {
  status: "mfa_required";
  mfa_token: string;
  methods: ("totp" | "recovery_code")[];
  expires_in: number;
};

export type TokenPair = {
  access: string;
  access_expires_in: number;
  // Absent pendant la fenêtre de grâce : le cookie refresh ne doit alors pas être touché.
  refresh?: string;
  refresh_expires_in?: number;
};

export type Kpi = { value: number; previous: number };
export type Period = "7d" | "30d" | "90d";

export type OrderStatus = "pending" | "confirmed" | "shipped" | "delivered" | "cancelled";
export type PaymentMethod = "cash_on_delivery" | "orange_money" | "mtn_momo" | "moov_money" | "wave";

export type Order = {
  id: string;
  reference: string;
  status: OrderStatus;
  payment_method: PaymentMethod;
  customer: { name: string; phone: string; city: string; commune: string; landmark: string };
  items: { product_id: string; name: string; unit_price: number; quantity: number; line_total: number }[];
  subtotal: number;
  delivery_fee: number;
  total: number;
  created_at: string;
};

export type DashboardSummary = {
  period: { from: string; to: string; label: Period };
  currency: "XOF";
  kpis: { revenue: Kpi; orders: Kpi; average_basket: Kpi; customers: Kpi };
  revenue_series: { date: string; revenue: number; orders: number }[];
  top_products: { id: string; name: string; units: number; revenue: number }[];
  recent_orders: Order[];
};

export type Paginated<T> = { results: T[]; count: number; page: number; pages: number };

/** Erreur au format unique de l'API (RFC 9457). */
export type Problem = {
  status: number;
  code: string;
  detail: string;
  /** `available` : stock restant, sur une ligne `out_of_stock`. */
  errors?: Record<string, { code: string; message: string; available?: number }[]>;
  retry_after?: number;
  attempts_remaining?: number;
  request_id?: string;
  /** Total recalculé par le serveur, sur `price_changed`. */
  total?: number;
};

/* ---------- Boutique publique (contrat §4.4) ---------- */

export type Accent = "orange" | "indigo" | "ocre" | "lagune" | "corail";

export type DeliveryZone = { id: string; city: string; commune: string; label: string; fee: number };

export type Storefront = {
  slug: string;
  name: string;
  description: string;
  city: string;
  accent: Accent;
  currency: "XOF";
  product_count: number;
  delivery_zones: DeliveryZone[];
  payment_methods: { id: PaymentMethod; label: string }[];
};

export type PublicProduct = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  price: number;
  image_url: string | null;
  in_stock: boolean;
  low_stock: boolean;
  max_quantity: number;
};

export type PlacedOrder = { reference: string; total: number; status: OrderStatus };
