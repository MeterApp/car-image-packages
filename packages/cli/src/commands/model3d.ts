import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CREDITS_PER_3D_MODEL, MODEL_3D_FILE_KINDS, colorParam, type Model3d, type Model3dFile, type Model3dFileKind, type Model3dPublic } from "@meterapp/car-image-sdk";
import { flagBoolean, flagChoice, flagInteger, flagString } from "../args.js";
import type { CommandContext, CommandDefinition } from "../context.js";
import { CliError } from "../errors.js";
import { fail, type Io, keyValues, ok, paint, printJson, table } from "../output.js";
import { flagColor, vehicleFromFlags } from "./images.js";

const SUBCOMMANDS = ["create", "get", "download", "list", "publish"] as const;
const USAGE = [
  "car-image 3d create (--make <make> --model <model> --year <year> | --vehicle <veh_…>) [--color silver|<hex>]",
  "                   [--webhook-url <https url> [--webhook-secret <secret>]] [--idempotency-key <key>] [--publish]",
  "                   [--wait] [--out <dir>] [--json]        --out downloads every file once ready (implies --wait); --publish hosts it at once",
  "car-image 3d get <id> [--wait] [--json]",
  "car-image 3d download <id> [--format glb|glb_web|usdz|fbx|thumbnail|paint_mask] [--out <file> | --out -] [--json]",
  "car-image 3d publish <id> [--unpublish] [--json]          key-free URLs and a two-line <car-3d> embed, hosted by Car Image; free",
  "car-image 3d list [--limit 20] [--json]",
  `  A model costs ${CREDITS_PER_3D_MODEL.toLocaleString("en-US")} credits at creation (cached or new; failures are refunded) and takes ten to twenty minutes the first time, one to two for another color. A vehicle and color you`,
  "  already own is free to order again. Polling, downloads and publishing are free.",
].join("\n");

const SIGN_IN_HINT = "Run `car-image login` or set CAR_IMAGE_API_KEY.";

/** File extension per kind; the thumbnail is a PNG, the web build a `.web.glb`, the paint mask a `.paint-mask.png`. */
export const MODEL_FILE_EXTENSIONS: Record<Model3dFileKind, string> = { glb: "glb", glb_web: "web.glb", usdz: "usdz", fbx: "fbx", thumbnail: "png", paint_mask: "paint-mask.png" };

function requireSignIn(ctx: CommandContext): void {
  if (!ctx.clientContext.apiKey) throw new CliError("Not signed in.", 1, SIGN_IN_HINT);
}

function requireId(ctx: CommandContext, action: string): string {
  const id = ctx.args.positionals[1]?.trim();
  if (!id) throw new CliError("Missing 3D model id", 2, `Example: car-image 3d ${action} <id> — ids come from \`car-image 3d create\` and \`car-image 3d list\`.`);
  return id;
}

/** `2025-toyota-camry-1a2b3c`: the model's vehicle and paint, safe as a file name. */
export function modelFileStem(model: Model3d): string {
  const slug = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return [String(model.vehicle.year), slug(model.vehicle.make), slug(model.vehicle.model), colorParam(model.color)].filter(Boolean).join("-");
}

/** "processing 40% (geometry) · ~120 s left", "ready", "failed". */
export function progressLine(model: Model3d): string {
  if (model.status === "ready" || model.status === "failed") return model.status;
  const eta = model.estimated_seconds_remaining === null ? "" : ` · ~${model.estimated_seconds_remaining} s left`;
  return `${model.status} ${model.progress}%${model.stage ? ` (${model.stage})` : ""}${eta}`;
}

function vehicleLabel(model: Model3d): string {
  return `${model.vehicle.year} ${model.vehicle.make} ${model.vehicle.model}`;
}

function megabytes(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/** The files a ready model offers, in the documented order. */
export function modelFiles(model: Model3d): Array<[Model3dFileKind, Model3dFile]> {
  const out: Array<[Model3dFileKind, Model3dFile]> = [];
  for (const kind of MODEL_3D_FILE_KINDS) {
    const file = model.files?.[kind];
    if (file) out.push([kind, file]);
  }
  return out;
}

/** The model for humans: state, vehicle, paint, timestamps and, once ready, a table of files. */
export function renderModel(io: Pick<Io, "color">, model: Model3d): string {
  const rows: Array<[string, string]> = [
    ["id", model.id],
    ["status", progressLine(model)],
    ["vehicle", `${vehicleLabel(model)}${model.vehicle.id ? ` · ${model.vehicle.id}` : ""}`],
    ["color", model.color],
    ["generator", model.generator],
    ["created", model.created_at],
    ["updated", model.updated_at],
  ];
  if (model.polycount !== null) rows.push(["polycount", model.polycount.toLocaleString("en-US")]);
  if (model.ready_at) rows.push(["ready", model.ready_at]);
  if (model.error) {
    // A free order (the account already owned the model) has refunded true and nothing to give back.
    const free = model.error.refunded === true && model.error.credits_refunded === 0 && !model.error.refunded_at;
    const refund = model.error.refunded === false ? "refund pending" : free ? "nothing charged" : "credits refunded";
    rows.push(["error", `${model.error.code}: ${model.error.message} (${refund})`]);
    if (model.error.retry) rows.push(["retry", model.error.retry]);
  }
  const imageUrl = model.error?.image_url;
  if (imageUrl) rows.push(["instead", `an image of this vehicle: ${imageUrl}`]);
  if (model.webhook) {
    rows.push(["webhook", `${model.webhook.url} · ${model.webhook.status ?? "pending"}${model.webhook.last_status === null ? "" : ` (HTTP ${model.webhook.last_status})`}`]);
  }
  const files = modelFiles(model);
  const sections = [keyValues(io, rows)];
  if (files.length) {
    sections.push(
      `${paint(io, "bold", "Files")}\n${table(
        files.map(([kind, file]) => [kind, megabytes(file.bytes), file.content_type, file.url]),
        ["kind", "size", "type", "url"]
      )}`
    );
  }
  if (model.public) sections.push(renderHosted(io, model.public));
  return sections.join("\n\n");
}

/** The hosted side of a published model: the key-free URLs and the embed to paste. */
export function renderHosted(io: Pick<Io, "color">, hosted: Model3dPublic): string {
  const pending = "(live once the model is ready)";
  const rows: Array<[string, string]> = [
    ["id", hosted.id],
    ["json", hosted.url],
    ["glb", hosted.files?.glb.url ?? pending],
    ["usdz", hosted.files?.usdz?.url ?? pending],
    ["poster", hosted.files?.poster?.url ?? pending],
    ["published", hosted.published_at],
  ];
  return `${paint(io, "bold", "Hosted (no key needed)")}\n${keyValues(io, rows)}\n\n${paint(io, "bold", "Embed")}\n${hosted.embed.html}`;
}

/** Polls until the model settles, printing one progress line per change (rewritten in place on a TTY). */
async function waitFor(ctx: CommandContext, id: string): Promise<Model3d> {
  const { io } = ctx;
  const silent = io.json || io.quiet;
  let last = "";
  const model = await ctx.clientContext.client.wait3dModel(id, {
    onProgress: (state) => {
      if (silent) return;
      const line = progressLine(state);
      if (line === last) return;
      last = line;
      const text = paint(io, "dim", `Waiting: ${line}`);
      io.stderr(io.isTTY ? `\r[2K${text}` : `${text}\n`);
    },
  });
  if (!silent && io.isTTY && last) io.stderr("\n");
  return model;
}

/** Downloads every file of a ready model into `dir`, named after the vehicle and paint. */
async function saveFiles(ctx: CommandContext, model: Model3d, dir: string): Promise<Array<{ kind: Model3dFileKind; file: string; bytes: number }>> {
  const { io } = ctx;
  await mkdir(dir, { recursive: true });
  const saved: Array<{ kind: Model3dFileKind; file: string; bytes: number }> = [];
  for (const [kind] of modelFiles(model)) {
    const file = await ctx.clientContext.client.download3dModel(model.id, kind);
    const path = join(dir, `${modelFileStem(model)}.${MODEL_FILE_EXTENSIONS[kind]}`);
    await writeFile(path, Buffer.from(file.bytes));
    saved.push({ kind, file: path, bytes: file.bytes.byteLength });
    if (!io.json && !io.quiet) io.stdout(`${ok(io, `Saved ${path} (${kind}, ${megabytes(file.bytes.byteLength)})`)}\n`);
  }
  return saved;
}

async function create(ctx: CommandContext): Promise<number> {
  requireSignIn(ctx);
  const { io, clientContext } = ctx;
  const { flags } = ctx.args;
  const vehicle = vehicleFromFlags(flags);
  const color = flagColor(flags);
  const webhookUrl = flagString(flags, "webhook-url");
  const webhookSecret = flagString(flags, "webhook-secret");
  if (webhookSecret && !webhookUrl) throw new CliError("--webhook-secret needs --webhook-url", 2);
  const idempotencyKey = flagString(flags, "idempotency-key");
  const publish = flagBoolean(flags, "publish");
  const out = flagString(flags, "out");
  const wait = flagBoolean(flags, "wait") || out !== undefined;

  const created = await clientContext.client.create3dModel(vehicle, { color, webhookUrl, webhookSecret, publish: publish || undefined, idempotencyKey });
  let model = created.data;
  if (!io.json) {
    const verb = model.status === "ready" ? "Ready" : model.status === "failed" ? "Failed" : "Queued";
    const charge = created.billing.already_owned
      ? `already owned, nothing charged, ${created.billing.credits_remaining.toLocaleString("en-US")} remaining`
      : `charged ${created.billing.credits_charged.toLocaleString("en-US")} credits, ${created.billing.credits_remaining.toLocaleString("en-US")} remaining`;
    io.stdout(`${ok(io, `${verb}: 3D model ${model.id} for ${vehicleLabel(model)} in ${model.color} — ${charge} · request ${created.request_id}`)}\n`);
  }
  if (wait && model.status !== "ready" && model.status !== "failed") model = await waitFor(ctx, model.id);
  const downloads = out !== undefined && model.status === "ready" ? await saveFiles(ctx, model, out) : [];
  if (io.json) {
    printJson(io, { ...created, data: model, ...(out !== undefined ? { downloads } : {}) });
    return model.status === "failed" ? 1 : 0;
  }
  if (wait) io.stdout(`\n${renderModel(io, model)}\n`);
  else {
    if (model.public) io.stdout(`\n${renderHosted(io, model.public)}\n`);
    if (!io.quiet) io.stdout(`${paint(io, "dim", `Poll it: car-image 3d get ${model.id} --wait`)}\n`);
  }
  if (model.status === "failed") {
    io.stderr(`${fail(io, `The model failed: ${model.error?.message ?? "unknown error"}. The ${created.billing.credits_charged.toLocaleString("en-US")} credits were refunded.`)}\n`);
    return 1;
  }
  return 0;
}

async function get(ctx: CommandContext): Promise<number> {
  requireSignIn(ctx);
  const { io } = ctx;
  const id = requireId(ctx, "get");
  const wait = flagBoolean(ctx.args.flags, "wait");
  const result = await ctx.clientContext.client.get3dModel(id);
  let model = result.data;
  if (wait && model.status !== "ready" && model.status !== "failed") model = await waitFor(ctx, id);
  if (io.json) {
    printJson(io, { ...result, data: model });
    return 0;
  }
  io.stdout(`${renderModel(io, model)}\n`);
  if (!io.quiet) {
    if (model.status === "ready") io.stdout(`\n${paint(io, "dim", `Download: car-image 3d download ${model.id} --format glb --out model.glb`)}\n`);
    else if (model.status !== "failed") io.stdout(`\n${paint(io, "dim", `Wait for it: car-image 3d get ${model.id} --wait`)}\n`);
  }
  return 0;
}

async function download(ctx: CommandContext): Promise<number> {
  requireSignIn(ctx);
  const { io, clientContext } = ctx;
  const id = requireId(ctx, "download");
  const kind = flagChoice(ctx.args.flags, "format", MODEL_3D_FILE_KINDS) ?? "glb";
  // One free GET first: it names the file after the vehicle and says plainly
  // when the model is not ready, instead of a bare 409.
  const { data: model } = await clientContext.client.get3dModel(id);
  if (model.status !== "ready") {
    throw new CliError(
      `The model is ${progressLine(model)}${model.error ? `: ${model.error.message}` : ""}; there is nothing to download yet.`,
      1,
      model.status === "failed" ? undefined : `Wait for it: car-image 3d get ${id} --wait`
    );
  }
  if (!model.files?.[kind]) throw new CliError(`The model has no ${kind} file`, 1, `Available: ${modelFiles(model).map(([name]) => name).join(", ") || "none"}`);
  const out = flagString(ctx.args.flags, "out") ?? `${modelFileStem(model)}.${MODEL_FILE_EXTENSIONS[kind]}`;
  const file = await clientContext.client.download3dModel(id, kind);
  if (out === "-") {
    process.stdout.write(Buffer.from(file.bytes));
  } else {
    await writeFile(out, Buffer.from(file.bytes));
  }
  const meta = { file: out === "-" ? null : out, kind, bytes: file.bytes.byteLength, content_type: file.contentType, request_id: file.requestId };
  if (io.json) {
    if (out === "-") io.stderr(`${JSON.stringify(meta)}\n`);
    else printJson(io, meta);
    return 0;
  }
  const line = `${out === "-" ? "Wrote the file to stdout" : `Saved ${out}`} (${kind}, ${megabytes(file.bytes.byteLength)}, ${file.contentType})`;
  (out === "-" ? io.stderr : io.stdout)(`${ok(io, line)}\n`);
  return 0;
}

async function publish(ctx: CommandContext): Promise<number> {
  requireSignIn(ctx);
  const { io, clientContext } = ctx;
  const id = requireId(ctx, "publish");
  const unpublish = flagBoolean(ctx.args.flags, "unpublish");
  const result = unpublish ? await clientContext.client.unpublish3dModel(id) : await clientContext.client.publish3dModel(id);
  if (io.json) {
    printJson(io, result);
    return 0;
  }
  const model = result.data;
  if (unpublish) {
    io.stdout(`${ok(io, `3D model ${model.id} is unpublished: its public URLs stop working within the hour.`)}\n`);
    return 0;
  }
  if (!model.public) throw new CliError("The model was not published.", 1, "Ask again in a moment; a failed model cannot be published.");
  io.stdout(`${ok(io, `Published: 3D model ${model.id} for ${vehicleLabel(model)} in ${model.color} is ${model.public.id}`)}\n\n${renderHosted(io, model.public)}\n`);
  if (!io.quiet && model.status !== "ready") io.stdout(`\n${paint(io, "dim", `The files go live when the model is ready (${progressLine(model)}); the embed shows progress until then.`)}\n`);
  return 0;
}

async function list(ctx: CommandContext): Promise<number> {
  requireSignIn(ctx);
  const { io } = ctx;
  const limit = flagInteger(ctx.args.flags, "limit", { min: 1, max: 50 });
  const result = await ctx.clientContext.client.list3dModels({ limit });
  if (io.json) {
    printJson(io, result);
    return 0;
  }
  const price = result.pricing.credits_per_model.toLocaleString("en-US");
  if (result.data.length === 0) {
    io.stdout(`No 3D models yet. Create one (${price} credits): car-image 3d create --make Toyota --model Camry --year 2025 --wait --out ./models\n`);
    return 0;
  }
  const rows = result.data.map((model) => [model.id, progressLine(model), vehicleLabel(model), model.color, model.created_at]);
  io.stdout(`${table(rows, ["id", "status", "vehicle", "color", "created"])}\n`);
  if (!io.quiet) io.stdout(`\n${paint(io, "dim", `${price} credits per model · car-image 3d get <id> · car-image 3d download <id> --format glb`)}\n`);
  return 0;
}

export const model3dCommand: CommandDefinition = {
  name: "3d",
  aliases: ["model3d"],
  summary: `Build a textured 3D model (GLB/USDZ/FBX, ${CREDITS_PER_3D_MODEL.toLocaleString("en-US")} credits, free once you own the vehicle and color) of any vehicle in any paint; poll, list, download, publish an embed`,
  usage: USAGE,
  async run(ctx: CommandContext): Promise<number> {
    const action = (ctx.args.positionals[0] ?? "").toLowerCase();
    switch (action) {
      case "create":
        return create(ctx);
      case "get":
        return get(ctx);
      case "download":
        return download(ctx);
      case "list":
        return list(ctx);
      case "publish":
        return publish(ctx);
      default:
        throw new CliError(action ? `Unknown 3d action "${action}"` : "Missing 3d action", 2, `Use one of: ${SUBCOMMANDS.join(", ")}. Run \`car-image 3d --help\` for usage.`);
    }
  },
};
