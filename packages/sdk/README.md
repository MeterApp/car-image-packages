# @meterapp/car-image-sdk

TypeScript SDK for the **Car Image API** by Meter — studio-quality, transparent-background renders of any vehicle in the open [`@meterapp/vehicle-db`](https://github.com/MeterApp/vehicle-db) catalog (1,610 makes, 42,374 models, model years 1990–2027, each with a page at [carimage.dev/cars](https://carimage.dev/cars?ref=npm-sdk)), in nine camera views and any paint color; plus stable vehicle ids, free VIN decoding and textured 3D models.

- Zero runtime dependencies. Works in Node 20+, Vercel/Cloudflare edge runtimes, Deno, Bun and browsers.
- Typed parameters and responses for every endpoint.
- `CarImageError` carries `status`, `title`, `detail`, `requestId` and the raw RFC 9457 problem.
- Automatic retries with full jitter on `429`/`503` (honoring `Retry-After`; a wait longer than `maxRetryDelayMs` is not retried, it throws with `retryAfterSeconds`); never retries `402`.
- Signed-URL and 3D-model creation carry an `Idempotency-Key`, so a retried `POST` replays instead of billing twice.
- Shared MCP tool definitions (`@meterapp/car-image-sdk/mcp`) used by both the stdio and the remote MCP servers.

```bash
npm install @meterapp/car-image-sdk
```


For vehicle images in chat, resolve the vehicle and call `get_car_image` with its id: the MCP result carries the picture, and chat apps show it inline. Where a tool's image does not reach the person (a terminal such as Claude Code or Codex), call `create_car_image_urls` once instead (7-day TTL, unlimited uses, renewal off unless requested) and link the returned `url`, or paste its `data[].markdown` where inline images render; state expiry and reuse unexpired URLs. Signed URLs are for pages, apps, emails and documents; REST responses are unchanged. Do not call both paid tools for one chat image.

## Pricing in one line

Plans meter **vehicle images**: one vehicle (make, model, year) in one color from one angle, counted once per UTC month and delivered as often as you like, at any size and in any format (bytes, signed URLs, their renewals and every load included). An angle the catalog has not prepared yet counts the same: we prepare it so it can be shown in any color, which takes a little time the first time. **Free**: $0, no card, 30 vehicle images per account, not per month (plus 30 more as a one-time courtesy once they run out), 100 credits once at signup, evaluation and personal projects. **Pro**: $49/month ($490/year), 2,500 vehicle images a month, 1,000 credits a month, commercial license while subscribed. **Business**: $99/month ($990/year), 10,000 vehicle images a month, 4,000 credits a month, 600 requests a minute per key, 25 keys. **Enterprise**: custom. There is no overage: past an allowance, new images answer `402` (`plan_image_limit`, nothing charged) until the 1st (UTC), or on Free for good (`resets_at: null`), while images already received keep serving. Images cost no credits; credits are no longer sold and pay only for 3D models (**100 credits** once per vehicle and color), make logos (1 credit each) and quality upgrades (20 credits). A one-time [Image Pack](https://carimage.dev/docs/packs?ref=npm-sdk) buys a set of images to keep and self-host for good. VIN decoding, catalog lookups, availability checks, polling and downloads are free. `client.account()` returns the plan in force as `data.plan` (with `meter`) and this month's counts in `data.limits_usage`; `client.pricing()` is the live price list.

License: on Pro and Business, commercial use while subscribed, including copies on your own servers and CDN; within 30 days after the plan ends, delete stored copies. Image Pack images may be self-hosted forever. Accounts that paid before 2026-10-25 keep their old terms and credit meter (1 credit per image) until the cutover date in their notice. Terms: <https://carimage.dev/terms?ref=npm-sdk#license>.

Get a key at <https://carimage.dev/dashboard?ref=npm-sdk> or run `npx @meterapp/car-image login`.

## Quickstart (Node)

```ts
import { CarImageClient } from "@meterapp/car-image-sdk";
import { writeFile } from "node:fs/promises";

const client = new CarImageClient({ apiKey: process.env.CAR_IMAGE_API_KEY });

const image = await client.getImage({
  make: "Porsche",
  model: "911",
  year: 2024,
  view: "front-3-4",  // front | front-3-4 | side | rear-3-4 | rear | rear-3-4-right | side-right | front-3-4-right | top
  color: "red",       // 15 presets (white black gray silver blue red green brown beige tan orange yellow gold burgundy purple) or any hex: "#1a2b3c"
  size: "medium",     // thumb=256 small=512 medium=768 large=1024 — or width/height, delivered up to the stored image's own size
  format: "png",      // png | webp | jpg | auto (auto negotiates WebP or PNG from the Accept header)
});

await writeFile("porsche-911.png", image.bytes);
console.log(image.source, image.usage, image.requestId);
// usage: { vehicleImages: { used, included } } from the
// X-Vehicle-Images-* headers (included null = unlimited); X-Credits-Charged is 0.
// Legacy credit-meter accounts get creditsCharged 1 and creditsRemaining instead.
```

`image.vehicleId` is the stable id of the catalog vehicle served (the `X-Vehicle-Id` header), so a bytes response still names the car it rendered.

`apiKey` and `baseUrl` fall back to `CAR_IMAGE_API_KEY` / `CAR_IMAGE_API_URL` when running on a server.

## Any paint color

`color` is one of the fifteen presets (`grey` is `gray`), any other CSS color name (`navy`, read as its CSS hex `#000080`) or any hex paint — `#1a2b3c`, `1a2b3c`, `#abc` or `abc`. Every image call takes it (`getImage`, `getImageUrl`, `createImageUrls`) and so does `create3dModel`. The SDK spells a hex bare in query strings (`color=1a2b3c`) and sends it as written in JSON bodies; responses echo it as `#1a2b3c`. A hex that matches a preset's own swatch is that preset. The `Color` type keeps the preset names in autocomplete while accepting any string; `isColor(value)` tells the three apart from anything else (`isCssColorName` checks a name alone), `COLORS` is still the list of presets and `CSS_COLOR_NAMES` the CSS names. Views take the aliases the API reads, too: `parseView("front left")` is `"front-3-4"`, and `VIEW_ALIASES` lists them.

```ts
await client.getImage({ make: "Porsche", model: "911", year: 2024, color: "#1a2b3c" });
```

## Stable vehicle ids

Every catalog vehicle (one make, model and year) has a stable id such as `veh_395yw8tn73ff8`. It never changes across catalog releases, so it is what to store instead of three strings. Every catalog response carries them (`searchVehicles` hits get `id` for the year the query named and `ids` for every year; `vehicles({ year, makeId })` models get `id`; `resolve()` params get `vehicle_id`; `decodeVin()` names one), and every image or 3D call accepts `{ vehicle }` in place of `{ make, model, year }`:

```ts
const { data } = await client.searchVehicles("2024 porsche 911");
const id = data.results[0].id;                             // "veh_395yw8tn73ff8"
await client.getImage({ vehicle: id, view: "side" });      // same image as make/model/year
await client.vehicle(id);                                  // { make, model, year, years, image_path, images } — public, no key
```

`ImageParams` is `{ make, model, year } | { vehicle }` plus the options, so TypeScript refuses both at once; at runtime whichever you pass is sent and the server answers `400` to both. Responses echo the id as `vehicle.vehicle_id` (null when the catalog cannot name one).

## Check a whole list

A catalog is checked once, not discovered one 404 at a time in every view and color. `checkVehicles` takes any number of entries, as your data spells them (`{ make, model, year }`, or `{ vehicle }` for a stored id, each with an optional `ref`), sends them to `POST /api/v1/vehicles/check` 2,000 at a time and merges the answers in order. It is free:

```ts
const { data } = await client.checkVehicles(
  rows.map((row) => ({ make: row.make, model: row.model, year: row.year, ref: row.id }))
);
data.summary; // { total, match, suggestion, miss, invalid, distinct_vehicles }
for (const result of data.results) {
  if (result.status === "match") await saveVehicleId(result.ref, result.vehicle!.id); // render by this id from now on
  // "suggestion": result.suggestions are other vehicles (the model in its nearest year, a related one) — decide once, never silently
  // "miss": nothing close; skip it in every view and color. "invalid": result.error says what to fix
}
```

Every entry is read exactly as `getImage` would read it, so a `match` renders and anything else would have been a `404`. `result.vehicle.match` names the rule that read your spelling (`exact`, `alias`, `trim`, `fuzzy`…). Pass `{ batchSize, onProgress }` to report progress on a long list; an account can run 10 checks a minute, and `checkVehicles` waits out the minute when a long list reaches that. Pass `{ views: true }` for a manifest of which vehicles have every angle ready: each match also carries `views` (`prepared`, 0 to 9, the `missing` view names and the `verified` ones) and `summary.views_complete` counts the vehicles with all nine, `summary.views_verified` those whose every prepared view is verified; still free, 100 entries a request. The CLI does the same for a CSV: `car-image check inventory.csv --out inventory-checked.csv` (add `--views` for the view columns).

For an Image Pack, submit the list with `allowPartial` to queue the matched
vehicles and get the rows to review:

```ts
const { data: batch, refused } = await client.createPackBatch(packId, {
  items: rows.map((row) => ({ make: row.make, model: row.model, year: row.year, ref: row.id })),
  allowPartial: true,
});
```

`refused` contains the original row indexes, any supplied `ref` values, and
catalog suggestions when available. If no vehicle matches, the API returns
`422 vehicles_not_found` before using pack units.

## VIN decoding

`decodeVin(vin, { year? })` decodes a full 17-character VIN, or a partial one of at least 5 characters with `*` for unknown positions, with NHTSA vPIC data — free, key required. `data.vehicle` is the catalog vehicle it maps to, with the id that renders it, or null when the catalog does not carry the car.

```ts
const { data } = await client.decodeVin("1HGCM82633A004352");
data.year, data.make, data.model, data.trim;   // 2003, "Honda", "Accord", "EX-V6"
data.engine, data.transmission, data.plant;    // typed sub-objects; unknown values are null
data.attributes;                               // every decoded vPIC variable, verbatim
if (data.vehicle) await client.getImage({ vehicle: data.vehicle.id });
```

`valid`, `errors` and `suggested_vin` carry the decoder's diagnostics (a bad check digit, a model-year mismatch with the `year` hint). A VIN NHTSA has no record of is a `404`; when neither decoder answers it is a `502`.

### Show an image at once, render the rest in the background

`isImageReady(params)` asks, free and without the key, whether an image is already rendered: true when it is, false on `404 not_cached`; anything else, such as an unknown vehicle id, throws a `CarImageError`. A ready image loads at once through a signed URL; a missing one renders on its first load. Coverage is partial, so a `false` means "not yet":

```ts
const { data } = await client.decodeVin(vin);                          // free
if (data.vehicle) {
  const params = { vehicle: data.vehicle.id, view: "front-3-4" } as const;
  const ready = await client.isImageReady(params);                     // free
  const { data: [url] } = await client.createImageUrls(params);           // one vehicle image this month, a signed URL for any <img>
  show(url.url, { instant: ready });                                      // a ready image loads at once
}
```

`getImageAvailability({ vehicle, view, color })` checks one vehicle's prepared/cached views, whether each is verified (`verified`: the image served for the view was compared, at full size and together with the vehicle's other views, with the manufacturer's own material for that model year, and matched; most views are not verified yet, and `false` says only that), quality (`standard`, `enhanced`, `premium`, or null), paint generation (`paint_generation` against `latest_paint_generation`), upgrade state (`upgradable` with `upgrade_reason`: `paint_generation` or `quality`; an upgrade redraws the view with the latest paint generation at enhanced quality and stores the new version) and render estimates through free `GET /api/v1/images/availability`. Omit `view` for all nine. Prepared means ready to serve quickly from storage without waiting for a new render. The equivalent MCP tool is `get_image_availability`, available in both core and all toolsets. Neither call generates, queues or counts image usage.

`checkAvailability(images)` checks up to 200 images at once before you ask for them, free and read-only (`POST /api/v1/images/availability`): whether each vehicle view is prepared and verified, whether it would count a vehicle image this month (a view not prepared yet counts as one like any other), and whether the whole list fits the plan:

```ts
const { data } = await client.checkAvailability(rows.map((row) => ({ vehicle: row.id, view: "front-3-4", color: row.paint })));
data.images[0];          // { index, prepared, counts_image, vehicle, view, color }
data.allowance;          // { vehicle_images: { used, included, would_add, fits } } (null on the credit meter)
```

`cachedImageUrl(params)` builds the keyless `mode=cached` URL behind `isImageReady`. Without a key it loads only a public preview, a render the [/cars pages](https://carimage.dev/cars?ref=npm-sdk) show; any other rendered image answers `401` with `code: "signed_url_required"` and `cached: true` (docs: [image access](https://carimage.dev/docs/images?ref=npm-sdk#cached)).

## Browser

Never ship the API key to a browser. Create signed URLs server-side (above) and use them like any image:

```html
<img src="https://carimage.dev/api/v1/delivery/…" alt="2024 Porsche 911, side view" width="768" height="432" />
```

The SDK itself is browser-safe (no Node APIs), which is useful for public endpoints such as `options()`, `vehicles()` and `searchVehicles()` that need no key.

## Account-signed URLs (available on request)

Sign image URLs on your own server, with no API call per image: `carImageUrl` builds `https://carimage.dev/i/{vehicle}/{view}.{format}?…&k=…&sig=…` and signs it with your key's signing secret (`imgsig_…`, made on the key's card in the [dashboard](https://carimage.dev/dashboard?ref=npm-sdk) or with `POST /api/v1/signing-secrets`). Each image counts one vehicle image for the month the first time our CDN fetches it that month (1 credit per account per calendar month on the legacy credit meter); the URL never expires unless you pass `expiresAt`. Early access: email support@carimage.dev to have it turned on (until then the URLs answer 403 `signed_urls_not_enabled`).

```ts
import { carImageUrl } from "@meterapp/car-image-sdk";

const src = await carImageUrl(
  { vehicle: "veh_395yw8tn73ff8", view: "side", color: "red", width: 600, format: "auto" },
  { keyId: process.env.CAR_IMAGE_KEY_ID!, signingSecret: process.env.CAR_IMAGE_SIGNING_SECRET! }
);
```

Web Crypto only (Node 20+, Bun, Deno, edge runtimes). In React Server Components, `CarImage` signs while the page renders and reads `CAR_IMAGE_KEY_ID` and `CAR_IMAGE_SIGNING_SECRET` (React is an optional peer dependency):

```tsx
import { CarImage } from "@meterapp/car-image-sdk/react";

<CarImage vehicle="veh_395yw8tn73ff8" view="side" color="red" width={600} format="auto" alt="2024 Toyota Camry, side" />
```

The signing secret is as good as the key for images: keep it on the server, never in a client component. Details: [signed URLs](https://carimage.dev/docs/signed-urls?ref=npm-sdk#account-signed).

## Idempotent URL creation

`POST /api/v1/image-urls` accepts an `Idempotency-Key` header (1–255 characters of `A–Z a–z 0–9 . _ : -`). The same key with the same body within 24 hours replays the first response, marked `Idempotent-Replayed: true`, instead of minting and billing a second batch. The same key with a different body is answered `422`; a retry that arrives while the first request is still running gets `409` with `Retry-After`.

The SDK sends a generated key (`sdk_<uuid>`) on every `createImageUrls` call, so its own retries — including a `POST` whose connection dropped — are always safe. Pass your own to make retries across processes safe too:

```ts
await client.createImageUrls(images, { ttlSeconds: 604_800, idempotencyKey: `order-${order.id}` });
```

## Campaign tracking

Tag an image or a URL mint with the campaign or send it is for (`campaign`, one line of at most 100 characters) and how many pieces — emails, mail pieces, impressions — it will appear in (`pieces`, a whole number from 1 to 10,000,000). They are recorded beside the request for your logs, campaign reports and Enterprise usage reporting, and never change the image, its cache entry, its URL or its charge. `getImage` and `getImageUrl` take them with the image; on `createImageUrls` each image may carry its own, and the options' `campaign` and `pieces` are the default for images that name none (`pieces` is per URL):

```ts
const minted = await client.createImageUrls(
  [{ vehicle: camry, view: "side", pieces: 3200 }, { vehicle: f150, view: "side", pieces: 5100 }],
  { campaign: "Owners mailer Nov", ttlSeconds: 604_800, renew: true }
);
minted.pieces; // 8300, the sum over the URLs; each data[] item echoes its own campaign and pieces

const { data } = await client.getCampaignUsage({ from: "2026-11-01" }); // account:read, free
data.by_campaign; // [{ campaign: "Owners mailer Nov", requests, pieces, loads }]
data.by_vehicle;  // [{ vehicle_id, make, model, year, requests, pieces, campaigns }]
```

`ImageResult.campaign` and `.pieces` read the `X-Campaign` and `X-Pieces` echo. The SDK checks both before sending (`normalizeCampaign`, `normalizePieces`: a blank label reads as none). They are not image query parameters (`IMAGE_QUERY_ALIASES` leaves them out), and `utm_campaign` stays an ignored tracking tag. The hosted `/images/car.png`, `cachedImageUrl` and `carImageUrl` URLs do not take them: tag the signed URLs a send uses.

## 3D models

`create3dModel` builds a textured 3D model — GLB, USDZ, FBX, a PNG thumbnail, `glb_web`, a smaller browser build, and `paint_mask`, a grayscale PNG aligned with the GLB's base-colour texture (white where the texel is paint) for recolouring live in your own viewer — of any catalog vehicle in any paint color, from the same renders the images use. It costs 100 credits at creation whether the model is cached, in progress or new, and nothing for a vehicle and color your account already owns (`billing.already_owned`; a failed model is refunded); polling, downloads and publishing are free. The first model of a vehicle takes 10–20 minutes; further colors take 1–2 minutes.

```ts
const { data: model, billing } = await client.create3dModel(
  { make: "Porsche", model: "911", year: 2024 },        // or { vehicle: "veh_…" }
  { color: "red", webhookUrl: "https://example.com/hooks/3d", webhookSecret: process.env.HOOK_SECRET, publish: true }
);
model.status;                                            // "queued" | "processing" | "ready" (cached) | "failed"
billing.already_owned;                                   // true (and credits_charged 0) when you already owned this vehicle in this color
model.public?.embed.html;                                // '<script src="https://carimage.dev/embed/3d.js" async></script>\n<car-3d model="m3d_…"></car-3d>'

const ready = await client.wait3dModel(model.id, {       // polls GET /api/v1/3d/{id}
  intervalMs: 5_000,                                     // default 5 s
  timeoutMs: 1_800_000,                                  // default 30 min; throws a CarImageError with status 408
  onProgress: (state) => console.log(state.status, state.progress, state.stage, state.estimated_seconds_remaining),
});
if (ready.status === "ready") {
  const glb = await client.download3dModel(ready.id, "glb"); // { bytes, contentType } — also "usdz" | "fbx" | "thumbnail"
  await writeFile("porsche-911-2024-red.glb", glb.bytes);
}

await client.get3dModel(model.id);                       // one poll
await client.list3dModels({ limit: 20 });                // your recent requests + pricing.credits_per_model
await client.publish3dModel(model.id);                   // data.public: key-free URLs (glb, usdz, poster) and the embed; works before ready
await client.unpublish3dModel(model.id);                 // the links stop working within the hour
```

`ready.files.<kind>.url` are API URLs that answer `302` to a signed download valid for an hour; `download3dModel` follows that redirect itself and never sends the API key to the storage host. A published model's `data.public.files` need no key at all: `model.glb` (the browser build), `model.usdz` and `poster.png` redirect to immutable copies on the CDN, and `data.public.embed.html` is a two-line `<car-3d>` embed that shows the poster at once, loads Google's `<model-viewer>` when it scrolls into view and takes `view`, `spin`, `backdrop`, `ar`, `static`, `no-zoom` and `alt` (`fetch` only attaches it to the client's own origin). With `webhookUrl` (https, public host) the server POSTs `{ event: "3d_model.ready" | "3d_model.failed", data, sent_at }` once the model settles, signed as `X-CarImage-Signature: sha256=<hex HMAC of the raw body>` when `webhookSecret` is set. `create3dModel` sends an `Idempotency-Key` like `createImageUrls` (pass `idempotencyKey` to make retries across processes safe). A `503` means 3D models are switched off or at the day's capacity; nothing is charged and `retryAfterSeconds` says when to try again.

## Sizing, backgrounds and trimming

Nine views, any paint color, PNG/WebP/JPG up to 2560 px (1024 px for renders from before 2026-11) — delivered at whatever box your layout needs.

```ts
await client.getImage({
  make: "BMW", model: "M3", year: 2022, view: "side",
  width: 600, height: 400,  // exactly 600×400 (it used to come back square)
  fit: "contain",           // contain | cover | inside; default contain
  trim: true,               // crop to the car's own bounds first, so it fills the box
  padding: 8,               // 0–50 % of the trimmed car's longer side; only with trim
  background: "#f4f4f4",    // transparent (default) | white | black | rrggbb | #rrggbb | rgb | #rgb
  format: "webp",
});
```

| Parameter | Values | What it does |
| --- | --- | --- |
| `color` | one of `COLORS` · a CSS color name · hex as `#rrggbb`, `rrggbb`, `#rgb` or `rgb` | The paint. Defaults to `silver`; echoed back as the preset name or `#rrggbb`. |
| `size` | `thumb` 256 · `small` 512 · `medium` 768 · `large` 1024 | Square presets; shorthand for `width`. |
| `aspectRatio` | `1:1` · `4:3` · `3:2` · `16:9` · `natural` | A preset for the box; `natural` is the car's own trimmed shape. With `width` or `height` it completes the other; both together win. Not with `size`. |
| `resolution` | `small` 640 · `medium` 1280 · `hd` 1920 · `2k` 2560 | A preset for the box's longer side, delivered up to the stored image's own size. `width` or `height` win. Not with `size`. |
| `width`, `height` | px, delivered up to the stored image's own size | One dimension keeps the aspect ratio. Both together give exactly `width`×`height` (see `fit`). Nothing is upscaled, and a larger size is clamped by the server, not refused: a box keeps its shape (1920×1080 of a 1024 px image comes back 1024×576) and `ImageResult.width`/`height` report what was served. |
| `fit` | `contain` (default) · `cover` · `inside` | Only matters with both dimensions. `contain` returns exactly the box with the whole car and transparent (or `background`) padding; `cover` fills the box and centre-crops; `inside` keeps the car within the box and may return a smaller image — the old behaviour. |
| `background` | `transparent` (default) · a CSS color name (`white`, `whitesmoke`) · hex as `rrggbb`, `#rrggbb`, `rgb` or `#rgb` | A solid background flattens PNG and WebP too. `jpg` cannot be transparent and defaults to white. |
| `framing` | `consistent` (default), `tight`, `balanced` | A preset in place of `trim`/`padding`: `tight` is `trim: true, padding: 0` (the car fills the box), `balanced` is `trim: true, padding: 6` (even catalog margins), `consistent` keeps the camera scale all nine views of a vehicle share (galleries, spinners, 3D previews). Same image, cache entry and credit as the spelled-out form; never together with `trim` or `padding`. |
| `trim` | `true` | Crops to the car's alpha bounds before sizing so it fills the box instead of floating in the square source frame. Recommended for non-square layouts. |
| `padding` | 0–50 | Margin around a trimmed car, as a percentage of its longer side. Only with `trim`. |
| `shadow` | `true` | A soft, neutral ground shadow under the car, drawn from its own cut-out at delivery: semi-transparent on a transparent image, grey on a `background`. Same vehicle image, nothing extra; car images only, not `getMakeLogo`. |
| `market` | `"AU"`, `"GB"`, `"US"`… | The market of sale, an ISO 3166-1 alpha-2 country code, for model years that look different in different markets. Optional: an account can keep a default (`default_market` on `account()`), and an explicit market always wins. Today every market gets the default appearance, and the answer says which was served: `ImageResult.appearance`, and `appearance` on signed URLs, availability, `resolve` and `checkVehicles` answers (`{ market, scope: "default" }`). Never part of the image: the same vehicle, color and view is one image and one counted vehicle image under any market. |
| `format` | `png` (default) · `webp` · `jpg` · `auto` | `auto` picks WebP for clients whose `Accept` header lists it and PNG otherwise (`Vary: Accept`); a signed URL created with `auto` negotiates on every load. |

The same parameters apply to `getImageUrl` and to every entry of `createImageUrls`; the returned `vehicle` echoes `vehicle_id`, `color`, `fit`, `background`, `trim`, `padding` and `shadow` back. `assertImageParams` (and therefore every call) rejects a `size` beside `aspectRatio` or `resolution`, a `framing` beside `trim` or `padding`, a dimension that is not a whole number of pixels from 1, a color that is neither a preset, a CSS color name nor a hex, and a request that names neither a vehicle id nor all of make, model and year, before anything is sent. A size above 1024 is sent as given, for the server to clamp.

The SDK always sends the documented query names. Code that writes or forwards image URLs itself can read `IMAGE_QUERY_ALIASES`: every name an image URL may carry, each with the other names the server reads it under (`angle` for `view`, `paint` or `hex` for `color`, `bg` for `background`, `width` for `w`). Beyond those, the server ignores only tracking tags and cache busters (`utm_*`, `gclid`, `ref`, `v`, `t`, `_`…, named in `X-Ignored-Parameters`); any other name is a free `400` whose problem names it in `parameter` and lists the names the endpoint reads in `allowed`.

## Next.js route handler

Keep the key on the server; hand the browser signed URLs.

```ts
// app/api/car-image/route.ts
import { CarImageClient, CarImageError } from "@meterapp/car-image-sdk";

const client = new CarImageClient({ apiKey: process.env.CAR_IMAGE_API_KEY });

export async function POST(request: Request) {
  const { make, model, year } = await request.json();
  try {
    const { data } = await client.createImageUrls([{ make, model, year, view: "side", width: 768, height: 432, trim: true }], {
      ttlSeconds: 24 * 60 * 60, // 1 minute to 7 days
      maxUses: 0,               // 0 = unlimited redemptions until expiry
    });
    return Response.json({ url: data[0].url, expiresAt: data[0].expires_at });
  } catch (error) {
    if (error instanceof CarImageError) {
      return Response.json({ error: error.detail, requestId: error.requestId }, { status: error.status });
    }
    throw error;
  }
}
```

## Everything else

```ts
await client.getImageUrl(params);                       // a signed URL instead of bytes; counts the vehicle image like getImage
await client.options();                                 // views, colors (and how hex paint is spelled), sizes, fits, backgrounds, trim limits, formats, pricing, catalog coverage, vehicle ids
await client.resolve("red 2024 porsche 911 side view"); // the lookup before a render: free text -> { vehicle_id, make, model, year, view, color } + candidates + confidence high|medium|low + extracted
await client.vehicles();                                // years
await client.vehicles({ year: 2024 });                  // makes for a year
await client.vehicles({ year: 2024, makeId: 7 });       // models for a year + make, each with its vehicle id
await client.vehicles({ make: "porsche", model: "911" }); // a model's years, each with its vehicle id
await client.vehicle("veh_395yw8tn73ff8");              // one vehicle by stable id (public)
await client.searchVehicles("porshe 911", { limit: 5 }); // fuzzy catalog search; model hits carry ids
await client.checkVehicles(rows);                       // free: which of a list the catalog carries, with ids; any length
await client.decodeVin("1HGCM82633A004352");            // free VIN decode + the catalog vehicle it maps to
client.cachedImageUrl({ vehicle: id });                 // keyless mode=cached URL: a public preview, else 401/404, never a render
await client.isImageReady({ vehicle: id });             // free, no key: whether that image can be shown now
await client.create3dModel({ vehicle: id }, { color });  // 100 credits; then wait3dModel, get3dModel, list3dModels, download3dModel
await client.checkAvailability(images);                 // free: prepared or not, what 1-200 images would count this month
await client.account();                                 // plan (meter, limits), limits_usage (vehicle images), credits, usage_30d, key scopes
await client.createPlanCheckout("pro", "month");        // hosted Checkout for a plan, or an in-place switch (data.changed) for an account already on one
await client.billingPortal();                           // Stripe Customer Portal URL
await client.health();                                  // { status: "ok" | "degraded", checks }
await client.openapi();                                 // the OpenAPI 3.1 document
await client.fetch("/api/v1/account");                  // authenticated raw fetch (same-origin only)
```

`createImageUrls(images, options)` takes 1–50 images and `{ ttlSeconds, maxUses, renew, renewDays, idempotencyKey, market, campaign, pieces }`. With `renew: true` a URL keeps serving past its TTL, renewing in each opened window of `ttlSeconds` (no extra count on a plan; one more credit per window on the legacy credit meter), until `renewDays` (1–365, default 365) — for email, CMS pages and documents that outlive a TTL. `resolve()` returns a `confidence` of `"high"`, `"medium"` or `"low"`; ask the human before making an image on `low`.

## Error handling

All failures throw `CarImageError`:

```ts
import { CarImageError } from "@meterapp/car-image-sdk";

try {
  await client.getImage({ make: "Porsche", model: "911", year: 2024 });
} catch (error) {
  if (error instanceof CarImageError) {
    error.status;           // 400 | 401 | 402 | 404 | 409 | 422 | 429 | 502 | 503 | 408 (wait3dModel timeout) | 0 (network)
    error.title;            // "Plan limit reached"
    error.detail;           // "The Free plan includes 30 free vehicle images per account plus a one-time courtesy of 30 … Nothing was charged."
    error.requestId;        // "0d1e…" — quote this when contacting support
    error.problem;          // the raw application/problem+json body (a 402 carries code "plan_image_limit" with plan, used, included, requested, resets_at, pack_url and checkout_url; "subscription_required_for_credits" with balance and required_credits when a 3D model, logo or upgrade needs more credits than the account holds; "plan_vehicle_limit" on the legacy credit meter; a vehicle 404 includes suggestions: real catalog vehicles with ids to retry with, see /docs/vehicles#missing; a 400 for a query name the endpoint does not read includes parameter and allowed)
    error.retryAfterSeconds; // set on 429, on a 409 (Idempotency-Key conflict, or a 3D file requested before the model is ready) and on a 503
    if (error.isInsufficientCredits) {
      // Any 402: nothing was charged. Show the human error.problem.checkout_url (a higher plan) or
      // error.problem.pack_url (Image Packs); never buy automatically. Images already received keep serving.
    }
  }
}
```

Retries: `429` and `503` are retried up to `maxRetries` (default 2) with full-jitter exponential backoff, honoring `Retry-After`. A `Retry-After` longer than `maxRetryDelayMs` (default 30 s) is not retried: the call throws at once with `retryAfterSeconds` set, so a `503` with `code: "generation_at_capacity"` (new renders resume at the next midnight UTC) costs one request, not `maxRetries + 1`. Network failures are retried for `GET` and for a `POST` sent under an `Idempotency-Key` (which `createImageUrls` always is); any other `POST` is never duplicated. Configure with `new CarImageClient({ maxRetries, retryBaseDelayMs, maxRetryDelayMs, timeoutMs })` or per call via `{ retries }`.

## MCP tool definitions

`@meterapp/car-image-sdk/mcp` exports the tool names, zod input and output schemas, descriptions, annotations and the server instructions shared by the `car-image mcp` stdio server and the remote server at `https://carimage.dev/api/mcp`. It needs `zod` (an optional peer dependency); the main entry point does not.

```ts
import {
  MCP_TOOLS, MCP_TOOL_OUTPUT_SCHEMAS, formatApiReference,
  MCP_TOOLSETS, MCP_DOCUMENTED_EXTRAS, MCP_UNLISTED_TOOLS, DEFAULT_MCP_TOOLSET, isMcpToolset, mcpInstructions, mcpInstructionsHead,
  MCP_INSTRUCTIONS_HEAD_LIMIT, readingTextArguments, type McpToolset,
} from "@meterapp/car-image-sdk/mcp";
```

Register a tool's input as `readingTextArguments(MCP_TOOLS[name].inputSchema)`, as both servers do. A host that holds no typed schema for a tool sends every argument as text, and the wrapper reads `"true"`, `"960"` and the JSON of a list as the type the schema advertises before zod validates them; the JSON Schema it advertises is the zod schema's own. The shared `MAX_MCP_TOOL_INPUT_ELEMENTS` limit bounds combined array elements and object members to 10,000 before validation, including JSON values decoded from text; pass it as the MCP server’s `maxToolInputElements` option too.

Tools come in two sets. `MCP_TOOLSETS.core` (`DEFAULT_MCP_TOOLSET`, `"core"`) is the twelve core tools an agent needs to look a vehicle up, render it and watch the month's usage: `resolve_vehicle`, `search_vehicles`, `decode_vin`, `check_vehicles`, `get_car_image`, `create_car_image_urls`, `get_image_availability`, `get_account`, `request_feature`, `report_issue`, `upvote_feedback`, `submit_review`. `MCP_TOOLSETS.all` (forty-one in total) adds `MCP_DOCUMENTED_EXTRAS`, the twenty-two more with `?toolset=all` that the reference documents, for image reports, make logos, 3D models, image options, the API reference, pricing, help and billing links: `report_image`, `list_feedback`, `get_feedback`, `list_my_feedback`, `remove_feedback_vote`, `comment_on_feedback`, `list_reviews`, `get_make_logo`, `create_3d_model`, `get_3d_model`, `publish_3d_model`, `list_image_options`, `describe_api`, `get_pricing`, `search_help`, `create_checkout_link`, `get_billing_link`, `purchase_plan`, `pay_invoice`, `checkout_status`, `list_members`, `list_webhooks`; and `MCP_UNLISTED_TOOLS`, tools both servers serve on `all` that the public reference leaves out. The hosted server defaults to `all` at `https://carimage.dev/api/mcp` and takes `?toolset=core` for the core set. The stdio server defaults to `core` and takes `car-image mcp --toolset all` for the full set. `mcpInstructions(toolset)` returns the matching server instructions (`MCP_INSTRUCTIONS` is the `all` text) and `isMcpToolset(value)` validates a name from a URL or a flag. The instructions open with `mcpInstructionsHead(toolset)`: what an agent must know to use the tools well and safely (look the vehicle up with `resolve_vehicle`, then render by the `vehicle` id; what it costs; stop on a `402`), kept under `MCP_INSTRUCTIONS_HEAD_LIMIT` (2,048 characters) because some hosts pass a model only that much of a server's instructions. Tool descriptions explain individual operations.

`get_car_image`, each `create_car_image_urls` entry and `create_3d_model` name the vehicle by make, model and year or by `vehicle` (a stable id) and take `color` as a preset, a CSS color name or a hex; the image tools also take `fit`, `background`, `trim`, `padding` and `shadow` alongside view, size and format (`auto` included; `inlineImageFormat` is what both servers deliver an inline image as for it: png), `get_car_image` and each `create_car_image_urls` entry take the campaign tracking labels `campaign` and `pieces` (`create_car_image_urls` also beside `images`, as the default), and `create_car_image_urls` honors `renew` and `renew_days` and takes `idempotency_key` (`IDEMPOTENCY_KEY_PATTERN`), which the stdio server forwards as the `Idempotency-Key` header. `create_3d_model` costs 100 credits, and its description and the server instructions tell the agent to confirm with the human first. Every tool but `describe_api`, whose result is the reference prose itself, advertises an `outputSchema` and returns `structuredContent` that matches it, so a host can hand the model typed data instead of re-parsing the text block. The schemas allow unknown fields: the payloads mirror the REST API and gain fields as it grows. The input bounds are the REST API's: `max_uses` 0–1000 and a search `limit` of 1–25; `width` and `height` have no upper bound in the schema because the server clamps a size above 1024. Numeric inputs are coerced, so a host that sends `"960"` for `960` is understood; the advertised JSON Schema still says integer, and flags such as `trim` stay strict booleans.

The one-line summary above a result leads both the text block and the structured content (`jsonToolResult` puts it first, as `summary`, since some hosts hand a model only the structured content). It comes from the same helpers on both servers, built from the payload they share: `accountSummary` (the balance, the plan and its vehicle cap, and "ask the human" under `LOW_BALANCE_CREDITS`), `resolveSummary` (the vehicle, the call that renders it by id, and a question for the human first when the confidence is low or the year is not the one asked for), `searchSummary` (which keeps an empty search from reading as a missing vehicle), `imageUrlsSummary` (the charge and until when the URLs serve, a replay included), `vinSummary` and `model3dSummary`. So does the step under an error: `nextStepFor(status)` for every tool, and `vinNextStepFor(status)` for `decode_vin`, which sends a refused or unknown VIN back to the human (re-check it, above all the maker code, or send a partial VIN with `*` and a year) instead of to the catalog.

## Types

`View`, `Color` (a `PresetColor` or any hex string), `Size`, `Format`, `RequestFormat`, `Fit`, `VehicleId`, `VehicleSelector`, `ImageParams`, `ImageOptions`, `ImageResult`, `CreateImageUrlsOptions`, `CreateImageUrlsResponse`, `OptionsResponse`, `FitOption`, `ResolveResponse`, `ResolveConfidence` (`"high" | "medium" | "low"`), `VehicleSearchResponse`, `VehicleResponse`, `VinResult`, `VinResponse`, `Model3d`, `Model3dFileKind`, `Model3dStatus`, `CreateModel3dOptions`, `CreateModel3dResponse`, `Model3dListResponse`, `Model3dFileResult`, `WaitModel3dOptions`, `AccountResponse`, … plus the constant arrays `VIEWS`, `COLORS` (the presets), `SIZES`, `FORMATS`, `REQUEST_FORMATS` (the formats plus `auto`), `FITS`, `MODEL_3D_FILE_KINDS`, the patterns `HEX_COLOR_PATTERN` and `VEHICLE_ID_PATTERN`, the helpers `isColor`, `isPresetColor`, `isHexColor`, `colorParam` and `vehicleRequestBody`, and the limits `MAX_DIMENSION` (1024), `MAX_PADDING_PERCENT` (50) and `CREDITS_PER_3D_MODEL` (100).

## License

MIT © Meter


## Product help and billing links

Feedback (free): `request_feature`, `report_issue`, `upvote_feedback` and `submit_review` are core tools; `list_feedback`, `get_feedback`, `list_my_feedback`, `remove_feedback_vote`, `comment_on_feedback` and `list_reviews` come with `?toolset=all`. REST: `GET /api/v1/feedback`, `POST /api/v1/feedback/features`, `POST /api/v1/feedback/issues`, `GET /api/v1/feedback/{id}`, `POST`/`DELETE /api/v1/feedback/{id}/votes`, `POST /api/v1/feedback/{id}/comments`, `GET /api/v1/reviews`, `PUT /api/v1/reviews/me`. CLI: `car-image feedback list|show|mine|request|report|report-image|upvote|comment`, `car-image review`, `car-image reviews`. After a failure that looks like a Car Image bug, offer `report_issue` with the failed call's `request_id`; when the human wishes the API did something, `request_feature`. Both return `similar` items first and file nothing until `force: true`: upvote a match instead. Issues are private to the reporter and the team. Every new item, upvote, official response and status change is emailed to the people who follow it. Guide: https://carimage.dev/docs/feedback?ref=npm-sdk

Image reports (free): when a picture is the wrong car, generation, angle or paint, is poorly drawn, or a vehicle is missing from the catalog, file one tracked report that starts the fix. SDK: `client.reportImage({ requestId, category: 'identity', reason, externalRef })` (or `assetId`, or a vehicle with `view` and `color`; `{ type: 'missing_vehicle', make, model, year }` for a missing vehicle) and `client.getImageReport(id)`. MCP: `report_image` (with `?toolset=all`). CLI: `car-image feedback report-image --request-id <id> --category identity`, `car-image feedback report-image --type missing_vehicle --make … --model … --year …`, `car-image feedback report-image show <id>`. REST: `POST /api/v1/images/reports`, `GET /api/v1/images/reports/{id}`. A repeat on the same image folds into the open report (`created: false`, same `id`); open reports from 2 accounts take an image out of service while it is redrawn. Keep the `id`: `image.issue_reported`, `image.issue_resolved` and `vehicle.available` webhooks carry it as `report_id` with your `external_ref`, to your account only. `url` is the report's page, private to your account. Guide: https://carimage.dev/docs/feedback?ref=npm-sdk#image-reports

Use `search_help` for source-linked product, licensing, policy and Enterprise answers; search each question separately without customer emails or secrets. Use `report_gap: true` when related articles do not answer the question. Queries are recorded privately to improve documentation. `get_pricing` returns current plans and Image Packs. On the human's request, `create_checkout_link` prepares a plan purchase (credits are not sold) and `get_billing_link` opens settings; the human confirms in the browser. Connected apps get a sign-in dashboard link. Never send an owner-account Stripe link to another customer.

CLI: `car-image pricing`, `car-image support "question" [--report-gap]`, `car-image billing --plan pro --no-browser`, `car-image billing --portal`. SDK: `pricing()`, `searchHelp(question)`, `createCheckoutLink({ plan: "pro" })`, `getBillingLink()`. The plugin includes the `car-image-support` skill.

[Help center](https://carimage.dev/help?ref=npm-sdk).

## Make logos

Use MCP `get_make_logo({make: "toyota", width: 256, trim: true})` for an inline
logo, or `car-image logo --make Toyota --width 256 --trim --out toyota-logo.png`
to save it. Both accept the image transforms; MCP `format: "auto"` returns PNG.
Each successful delivery costs 1 credit, including cache hits. There is no signed
logo URL: download and host the file for a site. Do not use the vehicle image URL
tools for logos. On 402, stop and ask the human; credits come with a plan and are not sold.

SDK: `client.getMakeLogo({ make: "toyota", width: 256, trim: true })` returns bytes and billing metadata.

Generated logos can be inaccurate; inspect before use. Logos are third-party trademarks,
for referential display only; no license is granted and they sit outside every
VehiclesDB indemnity. [Logo docs](https://carimage.dev/docs/logos?ref=npm-sdk)
· [API terms](https://carimage.dev/terms?ref=npm-sdk#logos).
