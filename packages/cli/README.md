# @meterapp/car-image

<p align="center"><a href="https://carimage.dev/cars/toyota/rav4/2025?ref=npm-cli"><img src="https://carimage.dev/images/previews/toyota/rav4/2025/silver/front-3-4-600.webp" width="420" alt="2025 Toyota RAV4, front three-quarter view, transparent background, rendered by the Car Image API"></a></p>

CLI and MCP server for the **Car Image API** by Meter — studio-quality, transparent-background renders of any vehicle in the open [`@meterapp/vehicle-db`](https://github.com/MeterApp/vehicle-db) catalog (1,610 makes, 42,374 models, 1990–2027; [browse them](https://carimage.dev/cars?ref=npm-cli)). Nine camera views, any paint color (fifteen named presets or any hex), PNG/WebP/JPG up to 2560 px (1024 px for renders from before 2026-11), at any width × height, transparent or on a solid background. Plus stable vehicle ids, free VIN decoding and textured 3D models (GLB, USDZ, FBX).

**Pricing:** plans count **vehicle images**: one vehicle in one color from one angle, once a UTC month, delivered as often as you like at any size and format. An angle the catalog has not prepared yet counts the same; we prepare it so it can be shown in any color, which takes a little time the first time. Free: $0, 30 vehicle images per account, not per month (plus 30 more as a one-time courtesy once they run out), 100 credits once at signup (evaluation and personal projects) · Starter $29/mo ($290/yr): 100 vehicle images a month, commercial license while subscribed · Pro $49/mo ($490/yr): 2,500 vehicle images and 1,000 credits a month, commercial license while subscribed · Business $99/mo ($990/yr): 10,000 vehicle images, 4,000 credits, 600 requests a minute per key. No overage: past an allowance, new images answer 402 until the 1st (UTC), or for good on Free; images already received keep serving. Credits are not sold and pay for 3D models (100 credits, once per vehicle and color; hosting is free), make logos (1) and quality upgrades (20). Image Packs and Vehicle Packs (`car-image packs`, any quantity from 100, priced per unit by tier) buy a set of images, or whole vehicles in every view, at the highest quality to self-host for good. On a paid plan, delete stored copies within 30 days after it ends. VIN decoding, catalog lookups, polling and downloads are free.


For vehicle images in chat, resolve the vehicle and call `get_car_image` with its id: the MCP result carries the picture, and chat apps show it inline. Where a tool's image does not reach the person (a terminal such as Claude Code or Codex), call `create_car_image_urls` once instead (7-day TTL, unlimited uses, renewal off unless requested) and link the returned `url`, or paste its `data[].markdown` where inline images render; state expiry and reuse unexpired URLs. Signed URLs are for pages, apps, emails and documents; REST responses are unchanged. Do not call both paid tools for one chat image.

## Install

```bash
npx @meterapp/car-image                      # no install
npm install -g @meterapp/car-image           # or pnpm add -g / bun add -g
curl -fsSL https://carimage.dev/install.sh | sh
```

Node.js 20+. A global install keeps itself up to date (see [Updates](#updates)).

## 60-second quickstart

```bash
car-image login                                                   # browser device flow; key stored with mode 0600
car-image get --make Porsche --model 911 --year 2024 --view side --color red --out porsche.png
car-image get --vehicle veh_395yw8tn73ff8 --color 1a2b3c          # by stable vehicle id, in any hex paint
car-image url --make BMW --model M3 --year 2022 --ttl 86400       # signed, key-free URL for a web page
car-image search porsche 911                                      # find the catalog vehicle and its id (free)
car-image vin 1HGCM82633A004352                                   # decode a VIN (free) → the catalog vehicle and its id
car-image doctor --yes                                            # check the key, the endpoints and the config
```

## Commands

Six commands cover what most people do; the rest are in the next table and behind `car-image help --all`. Every command has `--help`.

| Command | What it does |
| --- | --- |
| `login [--no-browser] [--client-name <name>]` | Device-flow sign-in. Opens the browser, shows the code, polls, stores the key at `$CAR_IMAGE_CONFIG` or `$XDG_CONFIG_HOME/car-image-api/config.json` (default `~/.config/…`) with mode `0600`. The key is printed once. |
| `get (--make --model --year \| --vehicle veh_…) [--view] [--color preset\|<hex>] [--size \| --width [--height] [--fit contain\|cover\|inside]] [--background transparent\|white\|black\|<hex>] [--framing consistent\|tight\|balanced \| --trim [--padding 0-50]] [--shadow] [--format png\|webp\|jpg\|auto] [--out file\|-] [--url] [--json]` | Downloads one image (one vehicle image of the month; the same image again adds nothing). `--url` prints a signed URL instead. `--vehicle` takes a stable id from `search`, `resolve` or `vin`; `--color` takes a preset or any hex (`#1a2b3c`, `1a2b3c`, `#abc`). See [Sizing, backgrounds and trimming](#sizing-backgrounds-and-trimming). |
| `url (--make … \| --vehicle …) [--view] [--color] [--size\|--width\|--height] [--fit] [--background] [--framing\|--trim] [--shadow] [--format] [--ttl 3600] [--max-uses 0] [--renew [--renew-days 365]] [--idempotency-key <key>] [--json]` · `url --batch images.json […]` | Creates one signed delivery URL, or up to 50 from a JSON file; each counts its vehicle image of the month when created, and loads add nothing. `--renew` keeps a URL alive past the TTL, for email and documents. Entries of a batch file name the car by `make`, `model`, `year` or by `vehicle`, and may carry `view`, `color`, `size`, `width`, `height`, `fit`, `background`, `framing`, `trim`, `padding`, `shadow` and `format`. |
| `search <query…> [--limit] [--year]` | Fuzzy catalog search (free, no key). `--json` shows each model hit's vehicle ids per year. |
| `vin <VIN> [--year <year>] [--json]` | Decodes a full or partial VIN (`*` for unknown positions) with NHTSA data: year, make, model, trim, body, engine, transmission, plant, and the catalog vehicle it maps to with a ready `car-image get --vehicle …`. Free, key required. |
| `doctor [--json] [--yes] [--no-image]` | Smoke-tests every endpoint: health, options, vehicles years/makes/models, search, resolve, account, signed-URL mint + HEAD/GET redeem, optional keyed image GET (asks unless `--yes`); both use the same vehicle image of the month. Prints check / status / latency / cache / credits / notes and fix hints; exit 1 on any failure. |

### More commands

| Command | What it does |
| --- | --- |
| `car-image` | Interactive onboarding on a TTY (login if needed → `whoami` → free quick check → next steps). Prints help when not interactive. |
| `whoami` (alias `status`) · `logout` | The plan and what its license allows, this month's vehicle images, credits (for 3D models and logos), payment method, 30-day usage, masked key prefix and scopes, base URL · remove the stored key. |
| `resolve <free text…>` | Free text → exact parameters (with the vehicle id), candidates, confidence (`high`, `medium` or `low`) and a ready-to-run `car-image get …`. |
| `check <file.csv\|file.json\|-> [--out <file>] [--format csv\|json] [--json]` (alias `coverage`) | Checks which vehicles of a list the catalog carries, each read the way `get` reads it; `--out` writes the file back with `status`, `vehicle_id`, the catalog spelling, `match`, `reason` and `suggested_vehicle_id` beside each row. Any length, 2,000 vehicles per request. Free, key required. See [Backfill a catalog](#backfill-a-catalog). |
| `options` · `describe [operationId\|path\|all] [--json]` | Views (with yaw), colors, sizes, fit modes, backgrounds, trim limits, formats, pricing, catalog coverage, vehicle ids · the REST API explained from `/openapi.json`. |
| `logo --make <make> [image options] [--out file]` | Downloads a make logo (1 credit per delivery). Same transforms as `get`; no signed URLs. Third-party trademarks, no license granted. |
| `3d create (--make --model --year \| --vehicle veh_…) [--color] [--webhook-url <https url> [--webhook-secret <s>]] [--idempotency-key <key>] [--publish] [--wait] [--out <dir>] [--json]` | Builds a textured 3D model (GLB, USDZ, FBX, thumbnail) of one vehicle in one paint: 100 credits at creation, cached or new, free once you own that vehicle and color; a failed model is refunded. `--wait` polls until it is ready and `--out` then downloads every file. See [3D models](#3d-models). |
| `3d get <id> [--wait]` · `3d list [--limit 20]` · `3d download <id> [--format glb\|usdz\|fbx\|thumbnail] [--out <file>]` · `3d publish <id> [--unpublish]` | Status and files of one request; your recent requests; one file of a ready model; key-free URLs and a two-line `<car-3d>` embed. Free. |
| `billing [--plan pro\|business [--yearly]] [--portal] [--no-browser]` (alias `upgrade`) | Opens hosted Stripe Checkout for a plan, or with no plan the billing portal (signed in) or the plans (signed out). An account already on a plan reviews the switch in the dashboard. Credits are no longer sold: `--credits` stops with an error and sends nothing. The CLI never touches card data. |
| `pricing` · `support <question> [--report-gap]` | Current plan prices, vehicle images a month, Image Packs and the live 3D model cost · source-linked product help. |
| `mcp [--toolset core\|all]` | Runs the stdio MCP server (see below). `core` (default) is the twelve core tools that look a vehicle up, render it and watch the balance; `all` adds make logos, 3D models, image options, the API reference, pricing, help and billing links. |
| `agent-config [--host claude-code\|claude-desktop\|cursor\|chatgpt\|generic] [--remote] [--json]` | Ready-to-paste MCP configuration. |
| `update [--check] [--no-plugins]` · `config path \| get <key> \| set <key> <value> \| list` · `telemetry on\|off\|status` | Update now: the CLI with the package manager that installed it, and the car-image plugin in Claude Code and Codex (see [Updates](#updates)) · local preferences (`autoUpdate`, `telemetry`, `baseUrl`) · anonymous usage events (see below). |
| `help [command] [--all]` | The six commands above, one command, or every command. |

Global options: `--json`, `--quiet`, `--base-url <url>`, `--api-key <key>`, `--no-color`, `-h/--help`, `-v/--version`.
Environment: `CAR_IMAGE_API_KEY`, `CAR_IMAGE_API_URL`, `CAR_IMAGE_CONFIG`, `CAR_IMAGE_TELEMETRY=0`, `CAR_IMAGE_NO_UPDATE_CHECK=1`.
Exit codes: `0` ok · `1` failure · `2` usage error. API errors are shown as `Title: detail`, a fix hint (`401 → car-image login`, `402 → car-image billing`, `429 → wait Retry-After`) and the `request_id`.

## Sizing, backgrounds and trimming

`get` and `url` (and every entry of a `--batch` file) take the same sizing options. Each image is stored once, a 1024 px square for renders from before 2026-11 and a view-shaped canvas of up to 2560 px for new ones, and nothing is upscaled. `--view` takes the nine angles or an alias the API reads (`left`, `right`, `front-left` and the other corners, `hero`, `back`, `overhead`).

| Option | Values | Effect |
| --- | --- | --- |
| `--color` | `white black gray silver blue red green brown beige tan orange yellow gold burgundy purple` (`grey` is `gray`) · a CSS color name (`navy`) · hex as `#rrggbb`, `rrggbb`, `#rgb` or `rgb` | The paint; default `silver`. Any hex, and a CSS name's hex, is a real paint, not a nearest preset; the API echoes it as `#rrggbb`. Quote a leading `#` in shells that treat it as a comment, or write the hex bare. |
| `--vehicle` | `veh_` + 13 characters | Names the make, model and year by their stable id (from `search --json`, `resolve` or `vin`) instead of `--make/--model/--year`; never both. |
| `--size` | `thumb` 256 · `small` 512 · `medium` 768 · `large` 1024 | Square presets; shorthand for `--width`. |
| `--aspect-ratio`, `--resolution` | `1:1\|4:3\|3:2\|16:9\|natural`; `small\|medium\|hd\|2k` | Presets for the box; `--width` and `--height` win, not with `--size`. |
| `--width`, `--height` | px, delivered up to the stored image's own size | One dimension keeps the aspect ratio. Both together return exactly width × height — `--width 600 --height 400` used to come back 400×400; it is now 600×400. A larger size is clamped by the API, a box keeping its shape (`--width 1920 --height 1080` saves 1024×576). |
| `--fit` | `contain` (default) · `cover` · `inside` | Only matters with both dimensions. `contain` returns exactly the box with the whole car and transparent (or `--background`) padding; `cover` fills the box and centre-crops; `inside` keeps the car within the box and may return a smaller image (the old behaviour). |
| `--background` | `transparent` (default) · a CSS color name (`white`, `whitesmoke`) · hex as `rrggbb`, `#rrggbb`, `rgb` or `#rgb` | A solid background flattens PNG and WebP too. `jpg` cannot be transparent and defaults to white. |
| `--framing consistent\|tight\|balanced` | preset | `tight` = `--trim`, `balanced` = `--trim --padding 6`, `consistent` (the default) keeps one apparent scale across a vehicle's views. Same image as the spelled-out flags; not with `--trim` or `--padding`, not on `logo`. |
| `--trim [--padding 0-50]` | flag; padding in percent | Crops to the car's alpha bounds before sizing so it fills the box — recommended for non-square layouts. `--padding` keeps a margin of 0–50 % of the trimmed car's longer side and, without `--trim`, pads the stored frame. |
| `--shadow` | flag | A soft, neutral ground shadow under the car, drawn from its own cut-out (semi-transparent, or grey on a `--background`). Same image, nothing extra; not on `logo`. |
| `--market` | country code | The market of sale (`AU`, `GB`, `US`: an ISO 3166-1 alpha-2 code), on `get`, `url`, `resolve` and `check`, for model years that look different in different markets. Today every market gets the default appearance, and the answer says which was served (`appearance` with `--json`). Without it the account's default market applies, if it set one; the same image is counted once under any market. Not on `logo`. |
| `--format` | `png` (default) · `webp` · `jpg` · `auto` | `auto` lets each client negotiate WebP or PNG from its `Accept` header (`Vary: Accept`); a signed URL created with `auto` negotiates on every load, so one URL serves every browser. |

```bash
car-image get --make Porsche --model 911 --year 2024 --view side --width 1024 --height 512 --trim --padding 6 --out hero.png
car-image get --make Porsche --model 911 --year 2024 --width 400 --height 400 --fit cover --background f4f4f4 --format jpg
car-image get --vehicle veh_395yw8tn73ff8 --color 1a2b3c --view rear-3-4 --out custom-paint.png
car-image url --make Porsche --model 911 --year 2024 --width 600 --height 338 --trim --format auto --ttl 604800
```

A batch file is an array (or `{"images": [...]}`) of 1–50 entries:

```json
[
  { "make": "Toyota", "model": "RAV4", "year": 2023, "view": "front-3-4", "width": 512, "height": 320, "trim": true, "padding": 5 },
  { "make": "Honda", "model": "CR-V", "year": 2023, "view": "front-3-4", "width": 512, "height": 320, "fit": "cover", "background": "white", "format": "webp" }
]
```

`car-image options` prints the fit modes, the background vocabulary and the padding ceiling the server currently advertises.

## VIN decoding

`car-image vin <VIN>` decodes a full 17-character VIN, or a partial one of at least 5 characters with `*` for each unknown position, with NHTSA vPIC data. It prints the year, make, model, trim, body class, engine, transmission, manufacturer and plant, the decoder's notes (a wrong check digit, a year that disagrees with `--year`), and the catalog vehicle the VIN maps to with a ready `car-image get --vehicle veh_…`. Free; needs a key. `--json` prints the full payload, including every decoded attribute. `Invalid VIN` means the argument is not a VIN (the message says why); `VIN not recognized` means NHTSA has no record of it: re-check it, above all the first three characters (the maker code), or put `*` in each position you are unsure of and add `--year`. NHTSA's data covers vehicles made for the US market, so for any other car search by name with `car-image search`.

```bash
car-image vin 1HGCM82633A004352
car-image vin "1HGCM826*3A" --year 2003 --json
```

## Backfill a catalog

Check a catalog once instead of discovering its gaps one 404 at a time in every view and color:

```bash
car-image check inventory.csv --out inventory-checked.csv
```

`inventory.csv` needs `make`, `model` and `year` columns in any order (`brand` and `model_year` work too, and your other columns ride along), or a `vehicle` column of ids you stored before; a `ref` column is echoed back. Every row is read exactly as `get` would read it. `inventory-checked.csv` is the same file with the answer beside each row:

- `match`: store `vehicle_id` and render by it, in every view and color (`car-image get --vehicle <id> --view side`). `match` names the rule that read your spelling (`exact`, `alias`, `trim`, `fuzzy`…); the loose ones are worth a glance.
- `suggestion`: the catalog lacks the vehicle as named, and `suggested_vehicle_id` is the closest real one, often the same model in its nearest year. It is another vehicle: use it only if it is the car you mean.
- `miss`: nothing close. Skip it in every view and color: the catalog does not carry it.
- `invalid`: the row cannot be read, and `error` says why.

Add `--views` for a manifest of which vehicles have every angle ready: each matched row also gets `views_prepared` (0 to 9), `views_missing` (the views not prepared yet, space-separated) and `views_verified` (the prepared views that are verified; one not listed has not been verified yet, nothing more), and the summary says how many vehicles have all nine (`car-image check inventory.csv --views --out manifest.csv`).

The check is free: up to 2,000 vehicles a request (100 with `--views`; the CLI splits longer files) and 10 checks a minute per account. Matches never change, so check again only the misses and suggestions, after a catalog release. The same check is `client.checkVehicles(list)` in the SDK and `POST /api/v1/vehicles/check` over HTTP ([docs](https://carimage.dev/docs/vehicles?ref=npm-cli#backfill)).

## 3D models

`car-image 3d create` builds a textured 3D model of any catalog vehicle in any paint — GLB, USDZ, FBX, a PNG thumbnail, a browser build (`glb_web`) and a paint mask (`paint_mask`, a grayscale PNG aligned with the GLB's base-colour texture) — from the same renders the images use. It costs 100 credits when the request is made, whether the model is cached, in progress or new, and nothing for a vehicle and color you already own (a failed model is refunded); polling, downloads and publishing are free. The first model of a vehicle takes 10–20 minutes; further colors take 1–2 minutes.

```bash
car-image 3d create --make Toyota --model Camry --year 2025 --color 1a2b3c --wait --out ./models
#   Queued: 3D model 2222…-2222 for 2025 toyota camry in #1a2b3c — charged 100 credits, 4,000 remaining
#   Waiting: processing 40% (geometry) · ~120 s left
#   ✓ Saved models/2025-toyota-camry-1a2b3c.glb (glb, 6.4 MB) … .usdz … .fbx … .png
car-image 3d create --vehicle veh_errc87t1jgata --webhook-url https://example.com/hooks/3d --webhook-secret "$HOOK_SECRET" --json
car-image 3d get <id> --wait
car-image 3d download <id> --format usdz --out camry.usdz
car-image 3d publish <id>          # key-free URLs on our CDN and a two-line <car-3d> embed, printed ready to paste
car-image 3d publish <id> --unpublish
car-image 3d list
```

Without `--wait` the command returns at once with the request id; `3d get <id>` shows status (`queued`, `processing`, `ready`, `failed`), progress, stage and an estimate, and once ready the files with their sizes and URLs. `--webhook-url` (https, public host) gets one POST `{"event": "3d_model.ready" | "3d_model.failed", "data": …, "sent_at": …}` when the model settles, signed as `X-CarImage-Signature: sha256=<hex HMAC of the raw body>` when `--webhook-secret` is set. `3d create --publish` publishes at creation and prints the embed; `3d publish <id>` does it later, `--unpublish` takes it down (the links stop working within the hour). `3d create` sends an `Idempotency-Key` like `url` does (`--idempotency-key` for retries from other processes). A `503` means 3D models are switched off or at the day's capacity: nothing is charged, and the hint says when to retry.

## Idempotent URL creation

`url` sends an `Idempotency-Key` on every call — a generated `sdk_<uuid>` unless you pass `--idempotency-key <key>` (1–255 characters of `A–Z a–z 0–9 . _ : -`). The same key with the same request within 24 hours replays the first response (`Idempotent-Replayed: true`) instead of minting and billing again, so a retried command or a re-run job never pays twice; the same key with a different request is a `422`, and a retry that overtakes the first request still in flight is a `409` with `Retry-After`. Use your own key when a retry may come from another process, such as a job queue:

```bash
car-image url --batch listing-4711.json --ttl 604800 --idempotency-key listing-4711-v1 --json
```

## Agents (MCP)

Two servers expose the same tools, in two sets:

- **Core (default), twelve tools:** `resolve_vehicle`, `search_vehicles`, `decode_vin`, `check_vehicles`, `get_car_image`, `create_car_image_urls`, `get_image_availability`, `get_account`, `request_feature`, `report_issue`, `upvote_feedback`, `submit_review` — look a vehicle up, render it and watch the month's usage. `get_car_image` and `create_car_image_urls` count vehicle images (1 credit per image only on accounts that paid before 2026-10-25); the rest are free.
- **All, forty-one tools:** the core twelve plus twenty-two more with `--toolset all`, for image reports, make logos, 3D models, image options, the API reference, pricing, help and billing links — `report_image` (report a wrong or poor image, or a vehicle the catalog lacks), `list_feedback`, `get_feedback`, `list_my_feedback`, `remove_feedback_vote`, `comment_on_feedback`, `list_reviews`, `get_make_logo` (1 credit per logo), `create_3d_model` (100 credits per model, free once the account owns the vehicle and color), `get_3d_model`, `publish_3d_model`, `list_image_options`, `describe_api`, `get_pricing`, `search_help`, `create_checkout_link`, `get_billing_link`, `checkout_status`, and `purchase_plan` and `pay_invoice` (pay with a payment token, only under the owner's agent spending limit), `list_members` (the organization's members and teams, read only) and `list_webhooks` (the account's webhook endpoints, read only).

`get_car_image`, each `create_car_image_urls` entry and `create_3d_model` name the car by make, model and year or by `vehicle` (a stable id from `search_vehicles`, `resolve_vehicle` or `decode_vin`) and take `color` as one of the presets or any hex such as `#1a2b3c`; the image tools also take `fit`, `background`, `trim`, `padding` and `shadow` alongside view, size and format (`auto` included: a signed URL negotiates per viewer, an inline `get_car_image` delivers PNG for it), and `create_car_image_urls` honors `renew` and `renew_days` and takes `idempotency_key`, forwarded as the `Idempotency-Key` header so a retried tool call replays the first result (`idempotent_replayed: true`) instead of billing again. Agents are told to call `resolve_vehicle` first and render by the `vehicle` id it returns; it reports a confidence of `high`, `medium` or `low` and reads a make and model by the rules the image tools use, so it names the vehicle they would render. `create_3d_model` returns the request at once; agents poll `get_3d_model` until `status` is `ready` and hand over `files.<kind>.url`.

- **Remote (recommended):** `https://carimage.dev/api/mcp`. Hosts that speak OAuth (Claude Code, Codex, Cursor) sign in with the browser and need no key. With a key instead (CI), send `Authorization: Bearer ${CAR_IMAGE_API_KEY}`, or `X-Api-Key: ${CAR_IMAGE_API_KEY}` in Claude Code, where an Authorization header turns browser sign-in off even when empty. The hosted URL serves all forty-one tools; append `?toolset=core` for the twelve core tools.
- **Local stdio:** `car-image mcp` (reads `CAR_IMAGE_API_KEY` or the stored key); `car-image mcp --toolset all` for the same extras. Through npx, name `@meterapp/car-image@latest`: a bare package name lets npx reuse whatever copy it finds, an old global install included.

```bash
# Claude Code: add it, then run /mcp and sign in with your browser (no key)
claude mcp add --transport http car-image https://carimage.dev/api/mcp
claude mcp add --transport http car-image "https://carimage.dev/api/mcp?toolset=core"   # only the twelve core tools
# With an API key instead (CI, no browser)
claude mcp add --transport http car-image https://carimage.dev/api/mcp --header "X-Api-Key: ${CAR_IMAGE_API_KEY}"
claude mcp add car-image-local --env CAR_IMAGE_API_KEY=${CAR_IMAGE_API_KEY} -- npx -y @meterapp/car-image@latest mcp

# Cursor (.cursor/mcp.json), Claude Desktop, ChatGPT, generic:
car-image agent-config --host cursor|claude-desktop|chatgpt|generic
```

The server instructions tell agents what is free (lookups, and a new account's 30 free vehicle images, then a one-time courtesy of 30), to confirm a 3D model with the human first, to keep keys out of URLs, to stop and hand the human the link on `402`, and never to subscribe to, change or cancel a plan on their own.

## Updates

The CLI keeps itself current. At most once an hour a command starts a background check of npm (`update-check.json`, next to the config file); when a newer version is out, the same background process installs it with the package manager that installed this copy (npm into the same global prefix, pnpm, bun, yarn or Volta) and the next command runs it. The command you ran never waits for the network or the install, agents and scripts see nothing on stdout or stderr, and `car-image mcp` updates the same way for the next time the host starts it. At a terminal the CLI says once that it updated itself. The package manager's output is in `update.log` beside the cache.

| `autoUpdate` | What happens when a newer version is out |
| --- | --- |
| `always` (default) | Installed in the background. A failed install is retried after a day and mentioned at a terminal. |
| `ask` | A y/N prompt before the next command at a terminal; elsewhere nothing. |
| `never` | A notice at a terminal, at most once a day. |

Set it with `car-image config set autoUpdate always|ask|never`. `CAR_IMAGE_NO_UPDATE_CHECK=1`, `NO_UPDATE_NOTIFIER=1` or `CI` turn off the check, the install and the notices; `CAR_IMAGE_NPM_REGISTRY` points the check at a mirror. A copy the CLI cannot replace (an npx cache, a project dependency, a global directory your user cannot write) only gets a notice, with the command to run.

`car-image update` does it now, in the foreground, and also refreshes the car-image plugin wherever Claude Code (`claude plugin marketplace update`, `claude plugin update`) or Codex (`codex plugin marketplace upgrade`) has it installed; `--no-plugins` skips that, `--check` only reports. Restart Claude Code (or run `/reload-plugins`) to load a new plugin. To have Claude Code keep the plugin current on its own, turn on auto-update for its marketplace: `/plugin` → **Marketplaces** → the marketplace → **Enable auto-update**.

`npx @meterapp/car-image` runs whatever copy npx finds first, a global install included; `npx @meterapp/car-image@latest` always runs the newest release.

## Telemetry

The CLI sends anonymous usage events (`cli_install`, `cli_login`, `cli_doctor`, `cli_command` with command name, version, OS, Node version and exit code) to `POST /api/v1/events`, fire-and-forget with a 1.5 s timeout — never keys, vehicles, file names or output. A one-line disclosure is printed on first run. Disable with `car-image telemetry off` or `CAR_IMAGE_TELEMETRY=0`.

## Uninstall

```bash
npm uninstall -g @meterapp/car-image        # or pnpm remove -g / bun remove -g
rm -rf ~/.config/car-image-api              # stored key + update cache
```

Revoke keys any time at https://carimage.dev/dashboard?ref=npm-cli#keys.

## License

MIT © Meter

### Request attribution

The CLI identifies requests with `X-CarImage-Integration: cli` (or `mcp-stdio` when running its MCP bridge). Set `CAR_IMAGE_HOST` to `claude`, `claude-code`, `chatgpt`, `codex`, or `cursor` to declare the calling host. This is usage analytics, not authentication; no prompts or conversation text are sent.


## Product help and billing links

Feedback (free): `request_feature`, `report_issue`, `upvote_feedback` and `submit_review` are core tools; `list_feedback`, `get_feedback`, `list_my_feedback`, `remove_feedback_vote`, `comment_on_feedback` and `list_reviews` come with `?toolset=all`. REST: `GET /api/v1/feedback`, `POST /api/v1/feedback/features`, `POST /api/v1/feedback/issues`, `GET /api/v1/feedback/{id}`, `POST`/`DELETE /api/v1/feedback/{id}/votes`, `POST /api/v1/feedback/{id}/comments`, `GET /api/v1/reviews`, `PUT /api/v1/reviews/me`. CLI: `car-image feedback list|show|mine|request|report|report-image|upvote|comment`, `car-image review`, `car-image reviews`. After a failure that looks like a Car Image bug, offer `report_issue` with the failed call's `request_id`; when the human wishes the API did something, `request_feature`. Both return `similar` items first and file nothing until `force: true`: upvote a match instead. Issues are private to the reporter and the team. Every new item, upvote, official response and status change is emailed to the people who follow it. Guide: https://carimage.dev/docs/feedback?ref=npm-cli

Image reports (free): when a picture is the wrong car, generation, angle or paint, is poorly drawn, or a vehicle is missing from the catalog, file one tracked report that starts the fix. SDK: `client.reportImage({ requestId, category: 'identity', reason, externalRef })` (or `assetId`, or a vehicle with `view` and `color`; `{ type: 'missing_vehicle', make, model, year }` for a missing vehicle) and `client.getImageReport(id)`. MCP: `report_image` (with `?toolset=all`). CLI: `car-image feedback report-image --request-id <id> --category identity`, `car-image feedback report-image --type missing_vehicle --make … --model … --year …`, `car-image feedback report-image show <id>`. REST: `POST /api/v1/images/reports`, `GET /api/v1/images/reports/{id}`. A repeat on the same image folds into the open report (`created: false`, same `id`); open reports from 2 accounts take an image out of service while it is redrawn. Keep the `id`: `image.issue_reported`, `image.issue_resolved` and `vehicle.available` webhooks carry it as `report_id` with your `external_ref`, to your account only. `url` is the report's page, private to your account. Guide: https://carimage.dev/docs/feedback?ref=npm-cli#image-reports

Use `search_help` for source-linked product, licensing, policy and Enterprise answers; search each question separately without customer emails or secrets. Use `report_gap: true` when related articles do not answer the question. Queries are recorded privately to improve documentation. `get_pricing` returns current plans and Image Packs. On the human's request, `create_checkout_link` prepares a plan purchase (credits are not sold) and `get_billing_link` opens settings; the human confirms in the browser. Connected apps get a sign-in dashboard link. Never send an owner-account Stripe link to another customer.

CLI: `car-image pricing`, `car-image support "question" [--report-gap]`, `car-image billing --plan pro --no-browser`, `car-image billing --portal`. SDK: `pricing()`, `searchHelp(question)`, `createCheckoutLink({ plan: "pro" })`, `getBillingLink()`. The plugin includes the `car-image-support` skill.

[Help center](https://carimage.dev/help?ref=npm-cli).

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
VehiclesDB indemnity. [Logo docs](https://carimage.dev/docs/logos?ref=npm-cli)
· [API terms](https://carimage.dev/terms?ref=npm-cli#logos).

`get_image_availability` checks prepared/cached status and quality before generating: resolve the vehicle first, then pass its id, view and color (omit view for all nine). Prepared means quick delivery from storage, with no wait for a new render. The check is free and read-only; it reports `standard`, `enhanced`, `premium` or null plus upgrade state and render estimates, and renders, queues and counts nothing.
