/**
 * Image Packs and Vehicle Packs (https://carimage.dev/docs/packs?ref=sdk): a
 * one-time purchase of a number of units, prepared in batches over 180 days
 * at the highest quality we make and self-hosted forever (nothing to delete
 * when a plan ends). An Image Pack's unit is one vehicle in one view, in any
 * color, size and format; a Vehicle Pack's unit is one make, model and year
 * in every view. Any quantity from 100 is sold, priced per unit by the tier
 * it falls in (`packPriceCents`). Every account may buy one (since
 * 2026-10-25); `listPacks()` lists the quick-buy offers and `custom` says how
 * any other quantity is priced. Every pack endpoint is free: the pack is paid
 * at Checkout.
 */
import type { VehicleSuggestion } from "./errors.js";

export const PACK_QUALITIES = ["standard", "enhanced", "premium"] as const;
export type PackQuality = (typeof PACK_QUALITIES)[number];

/** What a pack counts: images (one vehicle view each) or vehicles (every view of each). */
export const PACK_UNITS = ["image", "vehicle"] as const;
export type PackUnit = (typeof PACK_UNITS)[number];

/** The quantity tiers, lowest first: the quick-buy sizes, and where each per-unit rate starts. */
export const PACK_SIZES = [100, 500, 2_500, 10_000] as const;
export type PackSize = (typeof PACK_SIZES)[number];

/** The fewest and most units a pack may hold at list price. */
export const MIN_PACK_UNITS = 100;
export const MAX_PACK_UNITS = 100_000;

/** The views a Vehicle Pack unit includes. */
export const VEHICLE_PACK_VIEWS = 9;

/** The images one vehicle is priced as: all of its views for the price of three. */
export const VEHICLE_PACK_PRICED_IMAGES = 3;

/** One-time price in US cents of each quick-buy size, per quality (the server's PACK_PRICES; a test keeps them equal): the rate card of the tiers. */
export const PACK_PRICES: Readonly<Record<PackQuality, Readonly<Record<PackSize, number>>>> = {
  standard: { 100: 4_900, 500: 14_900, 2_500: 49_900, 10_000: 149_900 },
  enhanced: { 100: 9_900, 500: 29_900, 2_500: 99_900, 10_000: 299_900 },
  premium: { 100: 19_900, 500: 59_900, 2_500: 199_900, 10_000: 599_900 },
};

/** The tier a quantity falls in: the largest quick-buy size at or under it. */
export function packTierFor(units: number): PackSize {
  let tier: PackSize = PACK_SIZES[0];
  for (const size of PACK_SIZES) if (units >= size) tier = size;
  return tier;
}

/**
 * One-time price in US cents of `units` units at `quality`: the units times
 * their tier's per-image rate (times VEHICLE_PACK_PRICED_IMAGES for a Vehicle Pack),
 * rounded to the cent; what the server charges (a test keeps them equal).
 */
export function packPriceCents(units: number, quality: PackQuality, unit: PackUnit = "image"): number {
  const tier = packTierFor(units);
  return Math.round((units * (unit === "vehicle" ? VEHICLE_PACK_PRICED_IMAGES : 1) * PACK_PRICES[quality][tier]) / tier);
}

/** Items one batch may list (each view of a vehicle is one image). */
export const MAX_PACK_BATCH_ITEMS = 5_000;

/** What every batch answer says about the wait, word for word. */
export const PACK_WAIT_COPY =
  "We prepare each vehicle at the highest quality we make, on a 2K canvas, with a paint mask so it can be shown in any color you request. Batches are worked through our queue in the order received: a large request can take one to two hours to process, depending on how much is asked for at once. We send a webhook when each car is ready and email you when the batch is done.";

export interface ImagePack {
  id: string;
  object: "image_pack";
  /** Units in the pack: any quantity from 100 at list price (a custom pack agreed with the Car Image team may hold fewer). */
  images_included: number;
  images_used: number;
  images_remaining: number;
  quality: PackQuality;
  /** What the counts count: `image` (one vehicle view) or `vehicle` (one vehicle in every view). */
  unit: PackUnit;
  unit_description: string;
  price: { amount_cents: number; currency: "usd" };
  status: "active" | "window_closed" | "refunded";
  purchased_at: string;
  window_ends_at: string;
  window_open: boolean;
  license: { self_host: "perpetual"; terms_version: string };
}

export interface PackOffer {
  id: string;
  unit: PackUnit;
  /** Units in the pack: images, or vehicles. */
  units: PackSize;
  /** The same number, under its old name. */
  images: PackSize;
  quality: PackQuality;
  multiplier: number;
  price_cents: number;
  price: number;
  per_unit: number;
  per_image: number;
  /** Signs the human in and opens Stripe Checkout; nothing is charged until they pay there. */
  checkout_url: string;
}

export interface PackTierRate {
  from: PackSize;
  to: number | null;
  per_unit_cents: number;
  per_unit: number;
}

/** How any quantity the quick-buy list does not show is bought: the bounds, the rate card and a Checkout link with `{units}` to fill in. */
export interface PackCustomOffer {
  min_units: number;
  max_units: number;
  how: string;
  tiers: Record<PackUnit, PackTierRate[]>;
  checkout_url_template: Record<PackUnit, string>;
}

export interface PackListResponse {
  data: ImagePack[];
  /** The quick-buy packs this account may buy; empty only while pack sales are paused. */
  offers: PackOffer[];
  /** Any other quantity; null while pack sales are paused. */
  custom: PackCustomOffer | null;
  request_id: string;
}

export interface PackBatchItemInput {
  /** A stable vehicle id (`veh_…`), or send make, model and year. */
  vehicle?: string;
  make?: string;
  model?: string;
  year?: number;
  /** One image each; `front-3-4` when absent, or every view in a Vehicle Pack. */
  views?: string[];
  /** Echoed back when the entry is refused. */
  ref?: string | number;
}

export interface PackBatchInput {
  items: PackBatchItemInput[];
  /** Queue the matches and return refused entries if at least one vehicle matches. */
  allowPartial?: boolean;
  /** The pack's quality or a lower one; the pack's by default. */
  quality?: PackQuality;
  /** The market of sale the batch is for (an ISO 3166-1 alpha-2 code such as `AU`); the account default when absent. Recorded and echoed as `appearance`; every image is the default appearance today. */
  market?: string;
  /** Receives one POST `pack.batch.completed`, besides the account's endpoints. */
  webhookUrl?: string;
  webhookSecret?: string;
}

export interface PackEta {
  typical_seconds: number;
  per_image_seconds: number;
  images_stored: number;
  images_to_draw: number;
  exact?: boolean;
}

export interface PackWaitFields {
  why_it_takes_time: string;
  why_it_takes_time_url: string;
}

export interface PackBatch {
  id: string;
  object: "pack_batch";
  pack_id: string;
  status: "queued" | "running" | "completed";
  quality: PackQuality;
  items: number;
  images_charged: number;
  counts: { queued: number; ready: number; failed: number };
  created_at: string;
  completed_at: string | null;
  webhook: { url: string; delivered: boolean; attempts: number } | null;
}

export interface PackItem {
  id: string;
  object: "pack_item";
  position: number;
  vehicle: { id: string; make: string; model: string; year: number };
  view: string;
  quality: PackQuality;
  status: "queued" | "rendering" | "upgrading" | "ready" | "failed";
  charged: boolean;
  image_returned: boolean;
  delivered_quality: PackQuality | null;
  sha256: string | null;
  /** Fetch with your key (`downloadPackImage`): any color, size and format, free. */
  download_url: string | null;
  /** Failed at Enhanced or Premium while a standard image of the view is stored: send it again with `quality: "standard"` to get it. */
  standard_available: boolean;
  /** `hint` says how to get the stored standard image when `standard_available`. */
  error: { code: string; message: string; hint?: string } | null;
  ready_at: string | null;
}

export interface PackRefusedEntry {
  index: number;
  ref?: string | number;
  status: "suggestion" | "miss" | "invalid";
  reason?: "make" | "model" | "year" | "vehicle";
  suggestions?: VehicleSuggestion[];
  search?: string;
  error?: string;
}

export interface PackQuoteResponse extends PackWaitFields {
  data: {
    object: "pack_quote";
    quality: PackQuality;
    unit: PackUnit;
    images: number;
    /** Images, or vehicles for `unit: "vehicle"`. */
    units: number;
    images_stored: number;
    images_to_draw: number;
    images_to_upgrade: number;
    exact: boolean;
    refused: PackRefusedEntry[];
    pack: { images: number; units: number; unit: PackUnit; quality: PackQuality; price_cents: number } | null;
  };
  eta: PackEta;
  request_id: string;
}

export interface PackResponse {
  data: ImagePack & { batches: PackBatch[] };
  request_id: string;
}

export interface CreatedPackBatchResponse extends PackWaitFields {
  data: { id: string; object: "pack_batch"; status: "queued"; quality: PackQuality; items: number; images_charged: number; pack: ImagePack };
  /** Present when allowPartial is true. Indexes and refs refer to the input list. */
  refused?: PackRefusedEntry[];
  eta: PackEta;
  request_id: string;
}

export interface PackBatchResponse extends Partial<PackWaitFields> {
  data: PackBatch & { item_list: PackItem[] };
  /** Pass as `after` for the next page; null on the last. */
  next_after: number | null;
  request_id: string;
}

export interface PackManifestRow {
  vehicle_id: string;
  make: string;
  model: string;
  year: number;
  view: string;
  quality: PackQuality | null;
  sha256: string | null;
  ready_at: string | null;
  item_id: string;
  download_url: string;
  /**
   * The delivered bytes (`sha256`) are verified: compared, at full size and
   * together with the vehicle's other views, with the manufacturer's own
   * material for that model year, and matched. Judged for the bytes this item
   * holds, so it does not change when the catalog's image is later replaced.
   * `false` says only that these bytes have not been verified.
   */
  verified: boolean;
}

export interface PackManifestResponse {
  data: { object: "pack_manifest"; pack_id: string; quality: PackQuality; images: number; items: PackManifestRow[] };
  request_id: string;
}

export interface PackExport {
  id: string;
  object: "pack_export";
  pack_id: string;
  status: "queued" | "building" | "ready" | "failed" | "expired";
  color: string;
  format: "png" | "webp";
  width: number | null;
  images: number;
  parts: number;
  parts_done: number;
  /** One signed ZIP link per part once ready, valid until `expires_at` (7 days). */
  files: Array<{ part: number; bytes: number; url: string }>;
  error: string | null;
  created_at: string;
  ready_at: string | null;
  expires_at: string | null;
}

export interface PackExportInput {
  /** A preset or hex paint, or `neutral`; silver by default. */
  color?: string;
  format?: "png" | "webp";
  width?: number;
}

export interface PackExportResponse {
  data: PackExport;
  exports_this_month?: { used: number; limit: number };
  request_id: string;
}

/** Delivery of one pack image: everything but the vehicle and view, which the item names. */
export interface PackImageOptions {
  color?: string;
  width?: number;
  height?: number;
  format?: "png" | "webp" | "jpg" | "auto";
  fit?: "contain" | "cover" | "inside";
  background?: string;
  trim?: boolean;
  shadow?: boolean;
}

export interface PackImageResult {
  bytes: Uint8Array;
  contentType: string;
  /** `archive` after the pack's window: the exact bytes it delivered. */
  source: "live" | "archive";
}
