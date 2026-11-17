import { z } from "zod";

/**
 * The body POST /api/v1/billing/link reads. `credits` is still read so a
 * client from before 2026-10-25 gets the dashboard's plan card instead of a
 * 400, but credits are no longer sold; the create_checkout_link tool takes a
 * plan only ({@link checkoutLinkToolSchema}).
 */
export const checkoutLinkSchema = z.object({
  credits: z.union([z.literal(100), z.literal(500), z.literal(1000), z.literal(2500), z.literal(10000)]).optional(),
  plan: z.enum(["starter", "pro", "business"]).optional(),
  interval: z.enum(["month", "year"]).optional(),
}).strict().refine((value) => (value.credits !== undefined) !== (value.plan !== undefined), "Provide exactly one of credits or plan")
  .refine((value) => !value.interval || !!value.plan, "interval requires plan");
/** create_checkout_link's input: a plan (credits are no longer sold). */
export const checkoutLinkToolSchema = z.object({
  plan: z.enum(["starter", "pro", "business"]).describe("The plan to link to. Credits are not sold; a plan includes vehicle images and credits every month."),
  interval: z.enum(["month", "year"]).optional().describe("Defaults to month."),
}).strict();
export const helpQuerySchema = z.object({ report_gap: z.boolean().optional().describe("Set true when prior results did not answer this question, to flag missing context for staff."), query: z.string().trim().min(2).max(1000).describe("One product question. Do not include personal information, credentials or full customer emails; queries are recorded privately to improve help articles.") }).strict();
export const billingLinkResultSchema = z.looseObject({
  data: z.object({
    url: z.string().url(), session_id: z.string().nullable().optional(), kind: z.enum(["checkout", "portal", "dashboard"]),
    requires_confirmation: z.literal(true), message: z.string(),
    credits: z.number().optional(), plan: z.enum(["starter", "pro", "business"]).optional(),
    interval: z.enum(["month", "year"]).optional(), amount_cents: z.number().optional(),
  }), request_id: z.string(),
});
export const helpResultSchema = z.looseObject({
  data: z.object({
    status: z.enum(["articles_found", "needs_support"]), guidance: z.string(), support: z.string(), version: z.string(), query_recorded: z.boolean(),
    articles: z.array(z.object({ slug: z.string(), title: z.string(), category: z.string(), paragraphs: z.array(z.string()), sources: z.array(z.object({ title: z.string(), url: z.string() })), url: z.string(), updated_at: z.string() })),
  }), request_id: z.string(),
});
const money = z.object({ monthly: z.number().nullable(), yearly: z.number().nullable() });
/** The pricing document (GET /api/v1/pricing): the fleet-shared fields, then the older ones, which stay. */
export const pricingResultSchema = z.looseObject({
  data: z.looseObject({
    product: z.literal("car-image"), updated_at: z.string(),
    currency: z.literal("usd"), credits_per_model: z.number(), free_signup_credits: z.number(),
    plans: z.array(z.looseObject({
      id: z.enum(["free", "starter", "pro", "business", "enterprise"]), name: z.string(), price: money,
      included: z.looseObject({ vehicle_images_per_month: z.number().nullable(), credits_per_month: z.number(), credits_once: z.number() }),
      limits: z.looseObject({ requests_per_minute_per_key: z.number(), requests_per_minute_per_account: z.number(), api_keys: z.number() }),
      features: z.array(z.string()), overage: z.string().nullable(), trial: z.null(),
      checkout_url: z.string().describe("Free: signup. Pro/Business: Stripe Checkout after sign-in; works before signup and charges nothing until the human pays. Enterprise: contact."),
      checkout_url_yearly: z.string().nullable(),
      code: z.string(), monthly_cents: z.number().nullable(), yearly_cents: z.number().nullable(), included_credits: z.number(), license: z.string(), vehicles_per_month: z.number().nullable(), rate_limit_per_minute: z.number(),
    })),
    add_ons: z.array(z.looseObject({ id: z.string(), price: z.number(), checkout_url: z.string().describe("A one-time Image Pack's Checkout; works before signup and charges nothing until the human pays.") })),
    free_tier: z.looseObject({ credits_once: z.number(), card_required: z.boolean(), signup_url: z.string() }),
    how_to_buy: z.record(z.string(), z.unknown()),
    docs: z.string(),
  }), request_id: z.string(),
});

/** A Stripe Shared Payment Token id, minted by the agent platform from the buyer's card; never a card number. */
const paymentToken = z.string().regex(/^spt_[A-Za-z0-9_]{8,255}$/).describe("A Stripe Shared Payment Token (spt_…) the agent platform minted for this seller. Never a card number: card numbers are refused.");
const purchaseId = z.string().regex(/^[A-Za-z0-9_.:-]{8,255}$/).describe("Your idempotency key for this purchase (8-255 letters, digits, . _ : -). Send the same one to retry safely: a repeat returns the first result and never charges twice.");
const maxAmount = z.number().int().min(0).describe("Your ceiling in cents, from get_pricing or the dry run. A higher price is refused (price_changed), never charged.");

export const purchasePlanSchema = z.object({
  plan: z.enum(["starter", "pro", "business"]),
  interval: z.enum(["month", "year"]).optional().describe("Defaults to month."),
  payment_token: paymentToken,
  max_amount: maxAmount,
  dry_run: z.boolean().optional().describe("true: quote the charge and check the mandate and the token, write nothing. Do this first and confirm the amount."),
  purchase_id: purchaseId,
}).strict();

export const payInvoiceSchema = z.object({
  invoice_id: z.string().regex(/^in_[A-Za-z0-9]{8,255}$/).describe("The open plan invoice (billing.renewal_due.invoice_id from get_account)."),
  payment_token: paymentToken,
  max_amount: maxAmount,
  dry_run: z.boolean().optional(),
  purchase_id: purchaseId,
}).strict();

export const checkoutStatusSchema = z.object({
  session_id: z.string().regex(/^cs_(test|live)_[A-Za-z0-9]{10,255}$/).describe("data.session_id from create_checkout_link."),
}).strict();

const agentSpendSchema = z.looseObject({ limit: z.number().nullable(), allowed_plans: z.array(z.string()), used_this_month: z.number(), remaining: z.number().nullable() });

export const purchaseResultSchema = z.looseObject({
  data: z.looseObject({
    status: z.string(), kind: z.enum(["plan", "invoice"]), dry_run: z.boolean(), replayed: z.boolean(), purchase_id: z.string().nullable(),
    plan: z.string().nullable(), interval: z.string().nullable(),
    charged: z.looseObject({ amount: z.number(), currency: z.string(), card: z.string().nullable() }).nullable(),
    subscription_id: z.string().nullable(), invoice_id: z.string().nullable(), receipt_url: z.string().nullable(), current_period_end: z.string().nullable(),
    agent_spend: agentSpendSchema,
  }),
  request_id: z.string().optional(),
});

export const checkoutStatusResultSchema = z.looseObject({
  data: z.looseObject({ session_id: z.string(), status: z.string().nullable(), payment_status: z.string().nullable(), complete: z.boolean() }),
  request_id: z.string().optional(),
});
