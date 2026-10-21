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
  /** Compte créé par un patron, encore sur son mot de passe provisoire. */
  must_change_password: boolean;
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

export type OrderCounts = Record<OrderStatus, number>;

export type DayPoint = { date: string; revenue: number; orders: number };

export type DashboardSummary = {
  period: { from: string; to: string; label: Period };
  currency: "XOF";
  kpis: { revenue: Kpi; orders: Kpi; average_basket: Kpi; customers: Kpi };
  revenue_series: DayPoint[];
  /** Même longueur que revenue_series : le jour i de la période précédente. */
  previous_series: DayPoint[];
  top_products: { id: string; name: string; units: number; revenue: number }[];
  recent_orders: Order[];
  /** Commandes ouvertes, toutes dates confondues. */
  to_process: Record<"pending" | "confirmed" | "shipped", number>;
  /** Commandes passées sur la période, annulées comprises. */
  statuses: OrderCounts;
  payment_methods: { method: PaymentMethod; orders: number; revenue: number }[];
  places: { city: string; commune: string; orders: number; revenue: number }[];
  /** 7 lignes (lundi d'abord) de 24 heures. */
  order_hours: number[][];
  customers: { new: number; returning: number };
  top_customers: { name: string; city: string; commune: string; orders: number; revenue: number }[];
  /** Produits en vente arrivés à leur seuil d'alerte, les plus bas d'abord. */
  low_stock: { count: number; items: { id: string; name: string; sku: string; stock: number; threshold: number }[] };
};

/* ---------- Sécurité du compte (contrat §4.2) ---------- */

export type Session = {
  id: string;
  device_label: string;
  ip: string;
  shared_device: boolean;
  current: boolean;
  created_at: string;
  last_seen_at: string;
};

export type SecurityEvent = {
  id: string;
  type: string;
  label: string;
  severity: "info" | "warning" | "critical";
  ip: string;
  device_label: string;
  created_at: string;
};

export type MfaSetup = { otpauth_uri: string; secret: string; qr_svg: string };

export type OrderNote = { id: string; author_name: string; body: string; created_at: string };

/** La fiche d'une commande : la commande et les notes internes de l'équipe. */
export type OrderDetail = Order & { notes: OrderNote[] };

/* ---------- Équipe et mot du patron ---------- */

export type Member = {
  user_id: string;
  name: string;
  first_name: string;
  last_name: string;
  role: Role;
  joined_at: string;
  pending: boolean;
  temporary_password_expires_at: string | null;
  email?: string;
  is_you: boolean;
};

export type NoteAudience = "all" | "managers" | "sellers" | "member";

export type TeamNote = {
  id: string;
  body: string;
  urgent: boolean;
  author: { name: string; role: Role; is_you: boolean };
  audience: { type: NoteAudience; label: string };
  created_at: string;
  withdrawn: boolean;
  /** La note m'est adressée ; read_at est mon accusé de lecture. */
  for_you: boolean;
  read_at: string | null;
  /** Seulement pour le propriétaire et les gérants. */
  receipts?: { name: string; read_at: string | null }[];
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
  /** Limite du plan, sur `plan_limit_reached`. */
  limit?: number;
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
