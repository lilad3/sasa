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
  /** Droits effectifs : ceux du rôle, plus ceux que le propriétaire a accordés à un gérant (docs/chantier-p4.md §A). */
  permissions: string[];
  grants?: string[];
  /** Empreinte du logo (null : pas de logo), pour invalider le cache de l'image. */
  logo_version?: string | null;
  /** Plafond des remises d'un gérant qui a le droit discounts.give (docs/chantier-p5.md §1.3), sinon null. */
  discount_cap_percent?: number | null;
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
  /** Code de réduction utilisé (vide sans réduction) et remise sur le sous-total (docs/chantier-p5.md §1.6). */
  discount_code: string;
  discount_amount: number;
  delivery_fee: number;
  total: number;
  channel: Channel;
  created_at: string;
};

/** D'où vient une commande (lien ?via= de la vitrine). Liste fermée, comme côté Django. */
export const CHANNELS = ["whatsapp", "facebook", "instagram", "tiktok", "sms", "direct", "autre"] as const;
export type Channel = (typeof CHANNELS)[number];

export type OrderCounts = Record<OrderStatus, number>;

export type DayPoint = { date: string; revenue: number; orders: number };

export type DashboardSummary = {
  period: { from: string; to: string; label: Period };
  currency: "XOF";
  kpis: { revenue: Kpi; orders: Kpi; average_basket: Kpi; customers: Kpi };
  revenue_series: DayPoint[];
  /** Même longueur que revenue_series : le jour i de la période précédente. */
  previous_series: DayPoint[];
  top_products: TopProduct[];
  recent_orders: Order[];
  /** Commandes ouvertes, toutes dates confondues. */
  to_process: Record<"pending" | "confirmed" | "shipped", number>;
  /** Commandes passées sur la période, annulées comprises. */
  statuses: OrderCounts;
  /** Livrées à temps (chantier-p5.md §4.4) : commandes livrées et horodatées de la période. */
  on_time: { measured: number; on_time: number; average_hours: number | null };
  payment_methods: { method: PaymentMethod; orders: number; revenue: number }[];
  /** D'où viennent les ventes de la période, hors annulées. */
  channels: { channel: Channel; orders: number; revenue: number }[];
  places: { city: string; commune: string; orders: number; revenue: number }[];
  /** 7 lignes (lundi d'abord) de 24 heures. */
  order_hours: number[][];
  customers: { new: number; returning: number };
  top_customers: { name: string; city: string; commune: string; orders: number; revenue: number }[];
  /** Produits en vente arrivés à leur seuil d'alerte, les plus bas d'abord. */
  low_stock: { count: number; items: { id: string; name: string; sku: string; stock: number; threshold: number }[] };
  /** Le mois en cours, quelle que soit la période choisie : `previous_revenue` couvre le mois d'avant jusqu'au même jour. */
  month?: { month: string; label: string; revenue: number; orders: number; previous_revenue: number };
  generated_at?: string;
  /** Des commandes de démo existent : le front l'indique (« exemple »). */
  has_demo_data?: boolean;
};

export type TopProduct = {
  id: string;
  name: string;
  units: number;
  revenue: number;
  category?: string;
  image_url?: string | null;
  previous_revenue?: number;
  /** CA par jour sur la période, pour la petite courbe. */
  series?: number[];
};

/* ---------- Objectif du mois (docs/chantier-p4.md §D) ---------- */

export type Goal = {
  month: string;
  label: string;
  days_left: number;
  /** `amount` et `revenue` sont null pour qui ne voit pas le chiffre d'affaires : le vendeur ne voit que le pourcentage. */
  goal: {
    percent: number;
    reached: boolean;
    set_at: string;
    set_by: { name: string; role: Role; is_you: boolean };
    amount: number | null;
    revenue: number | null;
  } | null;
  history: { month: string; label: string; percent: number; reached: boolean; amount: number | null }[];
};

/* ---------- Clients (docs/chantier-p4.md §C) ---------- */

export type CustomerFlag = "new" | "win_back" | "at_risk";
export type CustomerSegment = "all" | "loyal" | "new" | "win_back" | "at_risk";

export type CustomerRow = {
  /** Identifiant opaque : jamais le numéro dans une adresse. */
  id: string;
  name: string;
  phone_masked: string;
  city: string;
  commune: string;
  orders: number;
  delivered: number;
  cancelled: number;
  spent: number;
  average_basket: number;
  first_order_at: string | null;
  last_order_at: string | null;
  /** Part des commandes terminées qui ont été livrées, en %. null : aucune n'est terminée. */
  reliability: number | null;
  loyal: boolean;
  /** Nommé fidèle à la main par le propriétaire. */
  vip: boolean;
  flags: CustomerFlag[];
};

export type CustomerSummary = {
  total: number;
  active_30d: number;
  active_30d_previous: number;
  loyal: number;
  new_30d: number;
  win_back: number;
  at_risk: number;
  loyalty_threshold: number;
  loyal_top: (CustomerRow & { monthly: number[] })[];
};

/** Sur la fiche, `orders` est la liste des dernières commandes ; leur nombre passe dans `order_count`. */
export type CustomerDetail = Omit<CustomerRow, "orders"> & {
  order_count: number;
  phone: string;
  names_used: string[];
  payment_favorite: PaymentMethod | null;
  addresses: { city: string; commune: string; landmark: string; orders: number }[];
  products: { name: string; quantity: number }[];
  orders: { id: string; reference: string; created_at: string; total: number; status: OrderStatus; payment_method: PaymentMethod }[];
  vip_set_by: { name: string } | null;
  vip_set_at: string | null;
  /** Les 20 dernières réductions, celles en cours d'abord. Code masqué sans le droit discounts.give. */
  discounts: Discount[];
};

/* ---------- Réductions personnelles (docs/chantier-p5.md §1) ---------- */

export type DiscountKind = "percent" | "amount";
export type DiscountStatus = "active" | "used" | "expired" | "revoked";

export type Discount = {
  id: string;
  code: string;
  kind: DiscountKind;
  value: number;
  /** « −15 % » ou « −2 000 F ». */
  label: string;
  ends_on: string;
  max_uses: number;
  uses: number;
  status: DiscountStatus;
  created_at: string;
  created_by: { name: string; is_you: boolean };
  can_revoke: boolean;
};

/** Réponse de la création : le code en clair et le numéro, pour préparer le message WhatsApp. */
export type CreatedDiscount = Discount & { customer: { name: string; phone: string } };

export type DiscountCheck = { code: string; label: string; subtotal: number; discount_amount: number };

/* ---------- Mon personnel : présence (docs/chantier-p4.md §B) ---------- */

export type PresenceEntry = {
  user_id: string;
  name: string;
  role: Role;
  is_you: boolean;
  status: "today" | "absent" | "never";
  last_seen_at: string | null;
  first_seen_today: string | null;
  handled_today: number;
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
export type OrderDetail = Order & {
  /** L'heure de chaque étape (null : pas encore, ou commande passée avant qu'on les note). */
  confirmed_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  /** Le délai promis pour sa zone, et le temps réel de la commande à la livraison (en heures). */
  promised_hours: number;
  delivery_hours: number | null;
  notes: OrderNote[];
};

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
  /** Droits accordés à un gérant, visibles du propriétaire. */
  grants?: string[];
  /** Plafond de ses remises (avec discounts.give), visible du propriétaire. */
  discount_cap_percent?: number | null;
};

export type NoteAudience = "all" | "managers" | "sellers" | "member";

export type TeamNote = {
  id: string;
  /** « goal » : message envoyé automatiquement quand le propriétaire fixe l'objectif du mois. */
  kind?: "message" | "goal";
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
  /** Remise recalculée par le serveur, sur `price_changed` avec un code de réduction. */
  discount_amount?: number;
  /** Limite du plan, sur `plan_limit_reached`. */
  limit?: number;
};

/* ---------- Boutique publique (contrat §4.4) ---------- */

export type Accent = "orange" | "indigo" | "ocre" | "lagune" | "corail";

/** `delay_hours` : le délai de livraison promis (24 h Grand Abidjan, 48 h Bingerville et Grand-Bassam, 72 h ailleurs). */
export type DeliveryZone = { id: string; city: string; commune: string; label: string; fee: number; delay_hours: number };

/* ---------- Vitrine : thèmes et versions (docs/chantier-p5.md §3) ---------- */

export const THEME_IDS = ["essentiel", "epicerie", "beaute", "artisanat", "piece-phare"] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export const SECTION_IDS = ["livraison", "demandes", "collection", "histoire", "suivi"] as const;
export type SectionId = (typeof SECTION_IDS)[number];
export const MOTIONS = ["full", "soft", "none"] as const;
export type Motion = (typeof MOTIONS)[number];

/** La configuration de la vitrine : un JSON fermé, validé par Django (et par zod pour l'aperçu). */
export type StorefrontDesign = {
  version: 1;
  theme: ThemeId;
  motion: Motion;
  cover: "featured" | "name";
  sections: SectionId[];
  texts: { tagline: string; story: string };
};

export type DesignVersion = {
  number: number;
  status: "draft" | "published" | "archived";
  config: StorefrontDesign;
  updated_at: string;
  created_by_name: string;
  published_at: string | null;
  published_by_name: string;
};

export type DesignOverview = {
  draft: DesignVersion | null;
  published: DesignVersion | null;
  default: StorefrontDesign;
  limits: { plan: Plan; plan_name: string; custom_sections: boolean; story: boolean; versions_kept: number };
  accent: Accent;
  themes: { id: ThemeId; label: string; plan: Plan; allowed: boolean; sections: SectionId[] }[];
};

/** Une photo envoyée par la boutique : l'image passe par /boutique/{slug}/photo/{id}?v={version}. */
export type ProductPhoto = { id: string; version: string };

/** D'où vient le produit de la couverture (docs/chantier-p5.md §2.4). */
export type CoverSource = "chosen" | "best_seller" | "price";

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
  /** Empreinte du logo (null : pas de logo) ; l'image passe par /boutique/{slug}/logo?v=. */
  logo_version?: string | null;
  /** Le produit de la couverture : à la une, sinon le plus vendu sur 30 jours, sinon le plus cher (null : aucun en stock). */
  featured: { product_id: string; source: CoverSource } | null;
  /** Les 3 produits les plus vendus sur 30 jours (« Les plus demandés »). */
  popular: string[];
  /** La version en ligne de « Ma boutique », sinon Essentiel. */
  design: StorefrontDesign;
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
  /** L'adresse de l'image : la première photo envoyée (relayée par Next), sinon l'adresse externe. */
  image_url: string | null;
  photos: ProductPhoto[];
  in_stock: boolean;
  low_stock: boolean;
  max_quantity: number;
};

export type PlacedOrder = { reference: string; total: number; status: OrderStatus; discount_amount: number };

/** Suivi d'une commande par le client : l'état seulement, ni adresse ni téléphone (contrat §4.4). */
export type TrackedOrder = {
  reference: string;
  status: OrderStatus;
  created_at: string;
  updated_at: string;
  subtotal: number;
  /** La remise, sans le code : il pourrait encore servir. */
  discount_amount: number;
  delivery_fee: number;
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
