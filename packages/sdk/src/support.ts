/** A plan to link to; credits are no longer sold (2026-10-25). */
export interface CheckoutLinkInput { plan: "pro" | "business"; interval?: "month" | "year" }
export interface BillingLinkResponse {
  data: { url: string; /** Stripe Checkout session id, for checkoutStatus(); absent on links that sign the human in first. */ session_id?: string | null; kind: "checkout" | "portal" | "dashboard"; requires_confirmation: true; message: string; credits?: number; plan?: "pro" | "business"; interval?: "month" | "year"; amount_cents?: number };
  request_id: string;
}
export interface HelpResponse {
  data: { status: "articles_found" | "needs_support"; guidance: string; support: string; version: string; query_recorded: boolean;
    articles: Array<{ slug: string; title: string; category: string; paragraphs: string[]; sources: Array<{ title: string; url: string }>; url: string; updated_at: string }> };
  request_id: string;
}
/** One plan in the pricing document: the fleet-shared fields, then the older ones (`code`, `monthly_cents`…). */
export interface PricingPlan {
  id: "free" | "pro" | "business" | "enterprise";
  name: string;
  /** Dollars; null for Enterprise (negotiated). */
  price: { monthly: number | null; yearly: number | null };
  included: {
    /** Distinct vehicle images (each vehicle in each color and angle) a month, each delivered as often as needed; null = negotiated. */
    vehicle_images_per_month?: number | null;
    /** Credits for 3D models, make logos and upgrades. */
    credits_per_month: number;
    credits_once: number;
  };
  limits: { requests_per_minute_per_key: number; requests_per_minute_per_account: number; api_keys: number; /** Legacy credit meter only. */ distinct_vehicles_per_month?: number | null };
  license: string;
  /** What the license says about stored copies (paid plans: delete within 30 days after the plan ends; Image Packs: keep). */
  license_terms?: string | null;
  features: string[];
  /** No overage: past an allowance, new images answer 402 until the 1st (UTC). */
  overage: string | null;
  trial: null;
  /** Free: signup. Pro and Business: Stripe Checkout after sign-in (monthly). Enterprise: the contact section. Opening it charges nothing. */
  checkout_url: string;
  checkout_url_yearly: string | null;
  code: string; monthly_cents: number | null; yearly_cents: number | null; included_credits: number;
  images_per_month?: number | null; vehicles_per_month: number | null; rate_limit_per_minute: number;
}
/** A one-time Image Pack as `add_ons[]` lists it: its images may be self-hosted for good. */
export interface PricingAddOn {
  id: string; name: string; price: number; unit: string;
  images?: number; quality?: "standard" | "enhanced" | "premium"; one_time?: boolean; self_host?: string;
  available_on: string[]; checkout_url: string;
  /** Servers before 2026-10-25 listed credit packs here. */
  credits?: number; expires?: boolean;
}
/** GET /api/v1/pricing: the pricing document (the shape every Meter product shares), public and keyless. */
export interface PricingResponse {
  data: {
    product: "car-image"; currency: "usd"; updated_at: string;
    plans: PricingPlan[];
    add_ons: PricingAddOn[];
    free_tier: { plan: "free"; credits_once: number; card_required: boolean; license: string; vehicle_images_per_month?: number | null; distinct_vehicles_per_month?: number | null; signup_url: string };
    /** What a plan meters: `vehicle_image`, `not_prepared_yet`, `check_first`, `credits` (sentences), plus the live 3D price. */
    usage_unit: { vehicle_image?: string; not_prepared_yet?: string; check_first?: string; credits?: string; credits_per_3d_model: number; credits_per_image?: number; credits_per_dollar?: number };
    how_to_buy: Record<string, unknown>;
    docs: string;
    credits_per_model: number; free_signup_credits: number;
    /** Legacy credit meter: 1 credit per image. */
    credits_per_image?: number;
    /** Legacy: credits are no longer sold. */
    credits_per_dollar?: number;
    /** Legacy: credit packs, no longer sold (empty or absent). */
    packs?: Array<{ credits: number; cents: number; label?: string }>;
    notes?: string[];
  };
  request_id: string;
}

/** POST /api/v1/billing/purchase input (the SDK's spelling). */
export interface PurchasePlanInput {
  plan: "pro" | "business";
  interval?: "month" | "year";
  /** A Stripe Shared Payment Token (spt_…); never a card number. */
  paymentToken: string;
  /** Your ceiling in cents; a higher price is refused, never charged. */
  maxAmount?: number;
  /** Quote only: checks the mandate and the token, writes nothing. */
  dryRun?: boolean;
  /** Required for a paid call (one is generated if omitted); reuse it to retry. */
  idempotencyKey?: string;
}

export interface AgentSpend {
  limit: number | null;
  allowed_plans: string[];
  used_this_month: number;
  remaining: number | null;
  set_by: string | null;
  set_at: string | null;
  manage_url: string;
}

export interface AgentPurchaseResponse {
  data: {
    status: string;
    kind: "plan" | "invoice";
    dry_run: boolean;
    replayed: boolean;
    purchase_id: string | null;
    plan: "pro" | "business" | null;
    interval: "month" | "year" | null;
    charged: { amount: number; currency: string; card: string | null } | null;
    quote?: { amount: number; currency: string; card: string | null };
    subscription_id: string | null;
    invoice_id: string | null;
    receipt_url: string | null;
    current_period_end: string | null;
    renewal: { amount: number; on: string | null; method: "saved_card" | "needs_payment"; how: string } | null;
    agent_spend: AgentSpend;
  };
  request_id: string;
}

export interface CheckoutStatusResponse {
  data: { session_id: string; status: string | null; payment_status: string | null; mode: string | null; plan: string | null; interval: string | null; credits: number | null; amount_total: number | null; currency: string | null; subscription_id: string | null; expires_at: string | null; complete: boolean };
  request_id: string;
}

export interface AgentLimitResponse {
  data: AgentSpend;
  request_id: string;
}
