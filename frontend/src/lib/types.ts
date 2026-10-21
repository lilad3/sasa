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
  /** En congé : la vitrine reste visible, mais Django refuse les commandes (409 shop_on_vacation). */
  vacation: { active: boolean; message: string; until: string | null };
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

/** Suivi d'une commande par le client : l'état seulement, ni adresse ni téléphone (contrat §4.4). */
export type TrackedOrder = {
  reference: string;
  status: OrderStatus;
  created_at: string;
  updated_at: string;
  total: number;
  payment_method: PaymentMethod;
  items: { name: string; quantity: number }[];
  delivery: { city: string; commune: string };
};

/* ---------- Paramètres de la boutique (propriétaire) ---------- */

export type ShopSettings = {
  slug: string;
  name: string;
  description: string;
  city: string;
  accent: Accent;
  plan: Plan;
  /** Le plan permet de choisir la couleur de la vitrine (Pro et plus). */
  custom_accent: boolean;
  /** `on_vacation` : actif et la date de retour n'est pas passée. */
  vacation: { active: boolean; message: string; until: string | null; on_vacation: boolean };
};

export type PlanSpec = {
  id: Plan;
  name: string;
  price: number;
  /** null : sans limite. */
  products: number | null;
  members: number | null;
  monthly_orders: number | null;
  api_keys: boolean;
  csv_import: boolean;
  custom_accent: boolean;
};

export type PlansOverview = {
  current: Plan;
  plans: PlanSpec[];
  usage: { products: number; members: number; orders_this_month: number; active_api_keys: number };
};

export type ApiScope = "catalog:read" | "orders:read";

export type ApiKey = {
  id: string;
  name: string;
  /** Début de la clé, pour la reconnaître : akw_live_XXXXXXXX_ */
  prefix: string;
  scopes: ApiScope[];
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  last_used_ip: string | null;
  revoked_at: string | null;
  active: boolean;
};

/* ---------- Journal de la boutique et santé de la sécurité (propriétaire) ---------- */

export type ShopActivityEvent = {
  id: string;
  type: string;
  label: string;
  severity: "info" | "warning" | "critical";
  created_at: string;
  /** null : un client ou un robot, en vitrine. `role` null : la personne a quitté la boutique. */
  actor: { name: string; role: Role | null; is_you: boolean } | null;
  target: { type: string; label: string } | null;
  /** Liste blanche par type d'événement (rows, previous_role, new_status…). */
  details: Record<string, unknown>;
  device_label: string;
  ip: string | null;
};

export type SecurityOverview = {
  team: {
    user_id: string;
    name: string;
    role: Role;
    is_you: boolean;
    mfa_enabled: boolean;
    pending: boolean;
    temporary_password_expired: boolean;
  }[];
  api_keys: {
    active: number;
    dormant: { id: string; name: string; last_used_at: string | null; created_at: string }[];
    expiring_soon: { id: string; name: string; expires_at: string }[];
  };
  /** Tentatives sur les comptes de l'équipe, 7 derniers jours. */
  suspicious: { user_id: string; name: string; is_you: boolean; type: string; label: string; count: number; last_at: string }[];
  last_export: { at: string; by: string; rows: number | null } | null;
  sensitive_events_7d: number;
};
