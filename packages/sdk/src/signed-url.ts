import { imageSearchParams } from "./params.js";
import { DEFAULT_BASE_URL, VEHICLE_ID_PATTERN, type ImageOptions, type VehicleId } from "./types.js";

/**
 * Account-signed image URLs: `https://carimage.dev/i/{vehicle}/{view}.{format}?…&k=…&sig=…`.
 *
 * Your server signs each URL locally with an API key's signing secret
 * (`imgsig_…`, made in the dashboard key card or with
 * `POST /api/v1/signing-secrets`), so a page shows images straight from the
 * CDN with no API call per image and no key in the page. The URL is stable,
 * so the CDN keeps it; the account is billed when the CDN first fetches an
 * image in a calendar month, and never again that month for the same image.
 * Available on request while in early access (docs: /docs/signed-urls).
 *
 * The signature is HMAC-SHA256 over the path and every query parameter but
 * `sig`, sorted by name and serialized by URLSearchParams, in lowercase hex.
 * Web Crypto only, so it runs in Node 20+, Bun, Deno and edge runtimes. Keep
 * the signing secret on the server: it is as good as the key for images.
 */

/** An image of one catalog vehicle, by its id: signed URLs name the vehicle in the path. */
export type SignedImageParams = { vehicle: VehicleId } & ImageOptions;

export interface CarImageUrlOptions {
  /** The API key's id (a UUID, shown with the signing secret); not the key itself. */
  keyId: string;
  /** The key's signing secret, `imgsig_…`. Server-side only. */
  signingSecret: string;
  /** Defaults to https://carimage.dev. */
  origin?: string;
  /** Optional unix time in seconds after which the URL stops working. */
  expiresAt?: number;
}

const KEY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const encoder = new TextEncoder();

/** The message the server verifies: path, then the query without `sig`, sorted by name. */
export function canonicalSignedMessage(pathname: string, params: URLSearchParams): string {
  const entries = [...params.entries()].filter(([key]) => key !== "sig");
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `${pathname}?${new URLSearchParams(entries).toString()}`;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new TypeError("carImageUrl needs Web Crypto (globalThis.crypto.subtle): Node 20+, Bun, Deno or an edge runtime");
  const key = await subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await subtle.sign("HMAC", key, encoder.encode(message)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Signs an image URL for `<img src>`. Resolves to the full URL:
 *
 * ```ts
 * const src = await carImageUrl(
 *   { vehicle: "veh_395yw8tn73ff8", view: "side", color: "red", width: 600, format: "auto" },
 *   { keyId: process.env.CAR_IMAGE_KEY_ID!, signingSecret: process.env.CAR_IMAGE_SIGNING_SECRET! }
 * );
 * ```
 */
export async function carImageUrl(params: SignedImageParams, options: CarImageUrlOptions): Promise<string> {
  if (!params || typeof params.vehicle !== "string" || !VEHICLE_ID_PATTERN.test(params.vehicle.trim())) {
    throw new TypeError("carImageUrl needs a vehicle id such as veh_395yw8tn73ff8; look it up with client.resolve() or client.vehicles()");
  }
  if (!options || typeof options.keyId !== "string" || !KEY_ID_PATTERN.test(options.keyId)) {
    throw new TypeError("carImageUrl needs options.keyId, the API key's id (a UUID shown with the signing secret)");
  }
  if (typeof options.signingSecret !== "string" || !options.signingSecret.startsWith("imgsig_")) {
    throw new TypeError("carImageUrl needs options.signingSecret, the key's imgsig_… signing secret");
  }
  if (options.expiresAt !== undefined && (!Number.isInteger(options.expiresAt) || options.expiresAt <= 0)) {
    throw new TypeError("options.expiresAt must be a unix time in whole seconds");
  }
  const vehicle = params.vehicle.trim();
  const view = params.view ?? "front-3-4";
  const format = params.format ?? "png";
  // The same query /images/car.png reads, minus what the path names.
  const query = imageSearchParams({ ...params, vehicle });
  // A signed image URL names one image: it reads no market (the server answers 400 to one).
  query.delete("market");
  for (const name of ["vehicle", "view", "format"]) query.delete(name);
  query.set("k", options.keyId);
  if (options.expiresAt !== undefined) query.set("exp", String(options.expiresAt));

  const pathname = `/i/${encodeURIComponent(vehicle)}/${encodeURIComponent(view)}.${format}`;
  const message = canonicalSignedMessage(pathname, query);
  const sig = await hmacHex(options.signingSecret, message);
  const origin = (options.origin ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  // The query is written in the signed order, so one image is one URL and one CDN entry.
  return `${origin}${message}&sig=${sig}`;
}
