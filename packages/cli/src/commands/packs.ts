import { readFile, writeFile } from "node:fs/promises";
import { PACK_QUALITIES, type ImagePack, type PackBatchItemInput, type PackQuality, type PackRefusedEntry } from "@meterapp/car-image-sdk";
import { flagChoice, flagInteger, flagString, flagBoolean } from "../args.js";
import type { CommandContext, CommandDefinition } from "../context.js";
import { CliError } from "../errors.js";
import { printJson } from "../output.js";
import { parseVehicleList } from "../vehicle-list.js";

const SIGN_IN_HINT = "Run `car-image login` or set CAR_IMAGE_API_KEY.";
const SUBCOMMANDS = ["list", "show", "buy", "quote", "batch", "status", "manifest", "export"] as const;
const POLL_MS = 15_000;

/**
 * `car-image packs`: Image Packs (https://carimage.dev/docs/packs?ref=cli).
 * A pack is bought once at Checkout (`buy` prints the link for a human),
 * then filled with batches of vehicles from a CSV or JSON list; every pack
 * call is free. Every account may buy one (since 2026-10-25); `list` shows what this
 * one may buy.
 */
export const packsCommand: CommandDefinition = {
  name: "packs",
  aliases: ["pack"],
  summary: "Image Packs: buy, send batches from a vehicle list, follow them, manifest and ZIP exports (free calls)",
  usage: [
    "car-image packs [list] [--json]                          your packs and the packs you may buy",
    "car-image packs buy --images 500 [--quality enhanced]    prints the Checkout link for a human",
    "car-image packs show <pck_…> [--json]",
    "car-image packs quote <vehicles.csv|json> [--views front-3-4,rear-3-4] [--quality …] [--json]",
    "car-image packs batch <pck_…> <vehicles.csv|json> [--allow-partial] [--views …] [--quality …] [--webhook-url <https-url>] [--wait] [--json]",
    "car-image packs status <pck_…> <pbt_…> [--wait] [--json]",
    "car-image packs manifest <pck_…> [--format json|csv] [--out manifest.csv]",
    "car-image packs export <pck_…> [--color silver] [--format png|webp] [--width 512] [--wait] [--json]",
  ].join("\n"),
  async run(ctx: CommandContext): Promise<number> {
    if (!ctx.clientContext.apiKey) throw new CliError("Not signed in.", 1, SIGN_IN_HINT);
    const sub = ctx.args.positionals[0] ?? "list";
    if (!(SUBCOMMANDS as readonly string[]).includes(sub)) throw new CliError(`Unknown packs command "${sub}". Use ${SUBCOMMANDS.join(", ")}.`, 2);
    const client = ctx.clientContext.client;
    const { io } = ctx;
    const asJson = (value: unknown): number => {
      printJson(io, value);
      return 0;
    };
    switch (sub) {
      case "list": {
        const result = await client.listPacks();
        if (io.json) return asJson(result);
        if (result.data.length === 0) io.stdout("No Image Packs yet.\n");
        for (const pack of result.data) io.stdout(describe(pack));
        if (result.offers.length) {
          io.stdout("\nPacks you can buy (one-time; `car-image packs buy --images <n> --quality <q>`):\n");
          for (const offer of result.offers) io.stdout(`  ${String(offer.images).padStart(6)} ${offer.quality.padEnd(9)} $${offer.price.toLocaleString("en-US")}  ($${offer.per_image}/image)\n`);
        }
        return 0;
      }
      case "buy": {
        const images = flagInteger(ctx.args.flags, "images");
        const quality = flagChoice(ctx.args.flags, "quality", PACK_QUALITIES) ?? "standard";
        const { offers } = await client.listPacks();
        if (offers.length === 0) throw new CliError("Image Pack sales are paused right now.", 1, "See `car-image pricing` for the plans.");
        const offer = offers.find((candidate) => candidate.images === images && candidate.quality === quality);
        if (!offer) throw new CliError(`No ${quality} pack of ${images ?? "?"} images on sale.`, 2, `Sizes: ${[...new Set(offers.map((o) => o.images))].join(", ")}; qualities: ${[...new Set(offers.map((o) => o.quality))].join(", ")}.`);
        if (io.json) return asJson({ data: offer });
        io.stdout(`${offer.images.toLocaleString("en-US")} ${offer.quality} images, $${offer.price.toLocaleString("en-US")} one-time. Open this link to pay in Stripe Checkout:\n  ${offer.checkout_url}\n`);
        return 0;
      }
      case "show": {
        const result = await client.getPack(requireId(ctx, 1, "pack"));
        if (io.json) return asJson(result);
        io.stdout(describe(result.data));
        for (const batch of result.data.batches) io.stdout(`  ${batch.id}  ${batch.status.padEnd(9)} ${batch.counts.ready}/${batch.items} ready, ${batch.counts.failed} failed  ${batch.created_at}\n`);
        return 0;
      }
      case "quote": {
        const items = await readItems(ctx, 1);
        const result = await client.quotePack(items, quality(ctx));
        if (io.json) return asJson(result);
        const { data, eta } = result;
        io.stdout(`${data.images} images at ${data.quality}: ${data.images_stored} stored (ready in seconds), ${data.images_to_draw} to draw, ${data.images_to_upgrade} to upgrade.\n`);
        io.stdout(`About ${minutes(eta.typical_seconds)}${data.exact ? "" : " (estimated from the first views)"}. ${result.why_it_takes_time}\n`);
        if (data.pack) io.stdout(`Smallest pack that holds them: ${data.pack.images} ${data.pack.quality} images, $${(data.pack.price_cents / 100).toLocaleString("en-US")}.\n`);
        printRefused(ctx, data.refused);
        return 0;
      }
      case "batch": {
        const packId = requireId(ctx, 1, "pack");
        const items = await readItems(ctx, 2);
        const created = await client.createPackBatch(packId, {
          items,
          allowPartial: flagBoolean(ctx.args.flags, "allow-partial") || undefined,
          quality: quality(ctx),
          webhookUrl: flagString(ctx.args.flags, "webhook-url"),
        });
        if (!io.json && created.refused) printRefused(ctx, created.refused);
        if (!flagBoolean(ctx.args.flags, "wait")) {
          if (io.json) return asJson(created);
          io.stdout(`Batch ${created.data.id}: ${created.data.items} images, ${created.data.images_charged} taken from the pack (${created.data.pack.images_remaining} left).\n`);
          io.stdout(`About ${minutes(created.eta.typical_seconds)}. ${created.why_it_takes_time}\n`);
          io.stdout(`Follow it: car-image packs status ${packId} ${created.data.id} --wait\n`);
          return 0;
        }
        return follow(ctx, packId, created.data.id, created.refused);
      }
      case "status": {
        const packId = requireId(ctx, 1, "pack");
        const batchId = requireId(ctx, 2, "batch");
        if (flagBoolean(ctx.args.flags, "wait")) return follow(ctx, packId, batchId);
        const result = await client.getPackBatch(packId, batchId, { limit: 500 });
        if (io.json) return asJson(result);
        io.stdout(`${result.data.id}  ${result.data.status}  ${result.data.counts.ready} ready, ${result.data.counts.failed} failed, ${result.data.counts.queued} to go\n`);
        for (const item of result.data.item_list.filter((entry) => entry.status === "failed")) {
          io.stdout(`  failed: ${item.vehicle.make} ${item.vehicle.model} ${item.vehicle.year} ${item.view}: ${item.error?.message ?? "failed"}${item.image_returned ? " (image returned to the pack)" : ""}\n`);
          if (item.standard_available) io.stdout(`    standard quality is stored: send it again with --quality standard\n`);
        }
        return 0;
      }
      case "manifest": {
        const packId = requireId(ctx, 1, "pack");
        const format = flagChoice(ctx.args.flags, "format", ["json", "csv"] as const) ?? (io.json ? "json" : "csv");
        const out = flagString(ctx.args.flags, "out");
        const text = format === "csv" ? await client.getPackManifestCsv(packId) : `${JSON.stringify(await client.getPackManifest(packId), null, 2)}\n`;
        if (out) {
          await writeFile(out, text);
          io.stderr(`Wrote ${out}\n`);
        } else {
          io.stdout(text);
        }
        return 0;
      }
      case "export": {
        const packId = requireId(ctx, 1, "pack");
        const width = flagInteger(ctx.args.flags, "width", { min: 16, max: 1024 });
        const format = flagChoice(ctx.args.flags, "format", ["png", "webp"] as const);
        let result = await client.createPackExport(packId, { color: flagString(ctx.args.flags, "color"), format, width });
        while (flagBoolean(ctx.args.flags, "wait") && (result.data.status === "queued" || result.data.status === "building")) {
          if (!io.json) io.stderr(`Export ${result.data.id}: ${result.data.parts_done}/${result.data.parts} parts built…\n`);
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
          result = await client.getPackExport(packId, result.data.id);
        }
        if (io.json) return asJson(result);
        if (result.data.status === "ready") {
          io.stdout(`Export ${result.data.id} is ready (${result.data.images} images); links valid until ${result.data.expires_at}:\n`);
          for (const file of result.data.files) io.stdout(`  part ${file.part} (${Math.round(file.bytes / 1_048_576)} MB): ${file.url}\n`);
          return 0;
        }
        if (result.data.status === "failed") throw new CliError(`Export ${result.data.id} failed: ${result.data.error ?? "unknown error"}`, 1);
        io.stdout(`Export ${result.data.id} is ${result.data.status}; the pack.export.ready webhook says when it is built, or run with --wait.\n`);
        return 0;
      }
    }
    return 0;
  },
};

function quality(ctx: CommandContext): PackQuality | undefined {
  const value = flagString(ctx.args.flags, "quality");
  if (value === undefined) return undefined;
  const name = value.trim().toLowerCase() === "high" ? "enhanced" : value.trim().toLowerCase();
  if (!(PACK_QUALITIES as readonly string[]).includes(name)) throw new CliError(`Unknown quality "${value}". Use ${PACK_QUALITIES.join(", ")}.`, 2);
  return name as PackQuality;
}

async function readItems(ctx: CommandContext, at: number): Promise<PackBatchItemInput[]> {
  const path = ctx.args.positionals[at];
  if (!path) throw new CliError("Missing vehicle list", 2, "A CSV with make, model and year (or vehicle_id) columns, or a JSON array; the same file `car-image check` reads.");
  const list = parseVehicleList(await readFile(path, "utf8"));
  const views = flagString(ctx.args.flags, "views")?.split(",").map((view) => view.trim()).filter(Boolean);
  return list.entries.map((entry) => ({
    ...(entry.vehicle ? { vehicle: entry.vehicle } : { make: entry.make === undefined ? undefined : String(entry.make), model: entry.model === undefined ? undefined : String(entry.model), year: entry.year === undefined ? undefined : Number(entry.year) }),
    ...(views?.length ? { views } : {}),
    ...(entry.ref !== undefined ? { ref: entry.ref } : {}),
  }));
}

function printRefused(ctx: CommandContext, refused: readonly PackRefusedEntry[]): void {
  if (!refused.length) return;
  ctx.io.stdout(`${refused.length} entries could not be matched to a catalog vehicle.\n`);
  for (const entry of refused.slice(0, 20)) {
    const near = entry.suggestions?.length ? ` — did you mean ${entry.suggestions.map((s) => `${s.make} ${s.model ?? ""} ${s.year}`.trim()).join(", ")}?` : "";
    ctx.io.stdout(`  row ${entry.index + 1}${entry.ref !== undefined ? ` (${entry.ref})` : ""}: ${entry.error ?? `unknown ${entry.reason ?? "vehicle"}`}${near}\n`);
  }
}

async function follow(ctx: CommandContext, packId: string, batchId: string, refused?: PackRefusedEntry[]): Promise<number> {
  const { io } = ctx;
  for (;;) {
    const result = await ctx.clientContext.client.getPackBatch(packId, batchId, { limit: 1 });
    const { counts, items, status } = result.data;
    if (!io.json) io.stderr(`${batchId}: ${counts.ready}/${items} ready, ${counts.failed} failed\n`);
    if (status === "completed") {
      if (io.json) {
        printJson(io, refused ? { ...result, refused } : result);
        return 0;
      }
      io.stdout(`Batch ${batchId} is complete: ${counts.ready} ready, ${counts.failed} failed. Manifest: car-image packs manifest ${packId}\n`);
      return counts.failed > 0 ? 2 : 0;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

function requireId(ctx: CommandContext, at: number, what: "pack" | "batch"): string {
  const id = ctx.args.positionals[at]?.trim();
  if (!id) throw new CliError(`Missing ${what} id`, 2, what === "pack" ? "Pack ids (pck_…) come from `car-image packs list`." : "Batch ids (pbt_…) come from `car-image packs batch` or `packs show`.");
  return id;
}

function minutes(seconds: number): string {
  return seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

function describe(pack: ImagePack): string {
  const window = pack.window_open ? `updates until ${pack.window_ends_at}` : "window closed (archive: downloads and exports)";
  return `${pack.id}  ${pack.images_included} ${pack.quality} images, ${pack.images_remaining} left  ${window}\n`;
}
