/**
 * Account webhooks (https://carimage.dev/docs/webhooks?ref=sdk): the event types, the
 * shapes the API answers with, and `verifyWebhook()`, which checks a
 * delivery's `X-CarImage-Signature` before you trust its body.
 */

/** Every account webhook event type. */
export const WEBHOOK_EVENT_TYPES = [
  "webhook.test",
  "image.ready",
  "3d_model.ready",
  "3d_model.failed",
  "image_upgrade.succeeded",
  "image_upgrade.failed",
  "image.upgraded",
  "image.issue_reported",
  "image.issue_resolved",
  "image.replaced",
  "vehicle.available",
  "pack.batch.completed",
  "pack.exhausted",
  "pack.export.ready",
  "pack.window.ending",
  "pack.window.ended",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/** The body of every delivery, and an item of GET /api/v1/events. */
export interface WebhookEvent<T extends string = WebhookEventType | (string & {})> {
  /** `evt_…`; deliveries can repeat, so dedupe on it. */
  id: string;
  type: T;
  created_at: string;
  data: Record<string, unknown>;
}

export interface WebhookEndpoint {
  id: string;
  object: "webhook_endpoint";
  url: string;
  /** Event types, or `["*"]` for every type the account receives. */
  events: string[];
  description: string | null;
  status: "active" | "disabled";
  disabled_reason: "failing" | "manual" | null;
  /** `whsec_` and four characters; the secret itself is returned once, by createWebhook. */
  secret_prefix: string;
  consecutive_failures: number;
  failing_since: string | null;
  last_success_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WebhookEntitlement {
  plan: string;
  /** "all" on a paid plan in force; Free receives only `webhook.test`. */
  receives: "all" | readonly ["webhook.test"];
}

export interface WebhookListResponse {
  data: WebhookEndpoint[];
  limit: number;
  entitlement: WebhookEntitlement;
  request_id: string;
}

export interface WebhookResponse {
  data: WebhookEndpoint;
  request_id: string;
}

export interface CreatedWebhookResponse {
  /** `secret` (`whsec_…`) is shown once: store it server-side to verify signatures. */
  data: WebhookEndpoint & { secret: string };
  entitlement: WebhookEntitlement;
  request_id: string;
}

export interface CreateWebhookInput {
  url: string;
  events?: Array<WebhookEventType | "*">;
  description?: string;
}

export interface UpdateWebhookInput {
  url?: string;
  events?: Array<WebhookEventType | "*">;
  description?: string | null;
  status?: "active" | "disabled";
}

export interface DeletedWebhookResponse {
  data: { id: string; object: "webhook_endpoint"; deleted: true };
  request_id: string;
}

export interface WebhookTestResponse {
  data: { event_id: string; type: "webhook.test"; endpoint_id: string; status: "queued" };
  request_id: string;
}

export interface WebhookDelivery {
  id: string;
  object: "webhook_delivery";
  event: { id: string; type: string; created_at: string };
  endpoint_id: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  next_attempt_at: string | null;
  last_status: number | null;
  last_error: string | null;
  last_attempt_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

export interface WebhookDeliveriesResponse {
  data: WebhookDelivery[];
  request_id: string;
}

export interface ListEventsParams {
  type?: WebhookEventType;
  /** ISO 8601 time; at most 30 days ago. */
  since?: string | Date;
  /** An event id: the page after it. */
  startingAfter?: string;
  /** 1-100, default 50. */
  limit?: number;
}

export interface EventListResponse {
  data: Array<WebhookEvent & { object: "event" }>;
  has_more: boolean;
  request_id: string;
}

export const WEBHOOK_SIGNATURE_HEADER = "X-CarImage-Signature";
export const WEBHOOK_EVENT_HEADER = "X-CarImage-Event";
export const WEBHOOK_DELIVERY_HEADER = "X-CarImage-Delivery";

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

export interface VerifyWebhookOptions {
  /** Seconds a delivery's signed timestamp may be away from now (default 300). */
  toleranceSeconds?: number;
  /** For tests: the current time in milliseconds. */
  now?: number;
}

const encoder = new TextEncoder();

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifies an account webhook delivery and returns its event. Pass the raw
 * request body exactly as received (not re-serialized JSON), the
 * `X-CarImage-Signature` header and the endpoint's `whsec_…` secret. Throws
 * `WebhookVerificationError` when the header is missing or malformed, the
 * timestamp is outside the tolerance (a replay), or no signature matches.
 *
 *     const event = await verifyWebhook(await request.text(), request.headers.get("X-CarImage-Signature"), webhookSecret); // the endpoint's whsec_ secret
 *
 * Uses Web Crypto: Node 20+, Bun, Deno and edge runtimes.
 */
export async function verifyWebhook(
  body: string,
  signatureHeader: string | null | undefined,
  secret: string,
  options: VerifyWebhookOptions = {}
): Promise<WebhookEvent> {
  if (!signatureHeader) throw new WebhookVerificationError(`Missing ${WEBHOOK_SIGNATURE_HEADER} header`);
  if (!secret) throw new WebhookVerificationError("Missing webhook secret");
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of signatureHeader.split(",")) {
    const [name, value = ""] = part.trim().split("=", 2);
    if (name === "t" && /^\d+$/.test(value)) timestamp = Number(value);
    else if (name === "sha256" && value) signatures.push(value.toLowerCase());
  }
  if (timestamp === null || signatures.length === 0) throw new WebhookVerificationError(`Malformed ${WEBHOOK_SIGNATURE_HEADER} header`);
  const now = options.now ?? Date.now();
  const tolerance = options.toleranceSeconds ?? 300;
  if (Math.abs(now / 1000 - timestamp) > tolerance) throw new WebhookVerificationError("Webhook timestamp is outside the tolerance");
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new TypeError("verifyWebhook needs Web Crypto (globalThis.crypto.subtle): Node 20+, Bun, Deno or an edge runtime");
  const key = await subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = toHex(new Uint8Array(await subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`))));
  if (!signatures.some((signature) => constantTimeEqual(signature, expected))) throw new WebhookVerificationError("Webhook signature does not match");
  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    throw new WebhookVerificationError("Webhook body is not JSON");
  }
  if (!event || typeof event !== "object" || typeof (event as WebhookEvent).id !== "string" || typeof (event as WebhookEvent).type !== "string") {
    throw new WebhookVerificationError("Webhook body is not an event");
  }
  return event as WebhookEvent;
}
