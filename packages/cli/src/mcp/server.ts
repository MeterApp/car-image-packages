import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { CREDITS_PER_DOLLAR, colorParam, isCarImageError, isHexColor, type CarImageClient, type FiledFeedbackResponse, type ImageParams, type ImageReportInput, type VehicleSelector } from "@meterapp/car-image-sdk";
import {
  DEFAULT_MCP_TOOLSET,
  MCP_SERVER_INFO,
  MAKE_LOGO_NOTICE,
  MCP_TOOLS,
  MCP_TOOLSETS,
  accountSummary,
  membersSummary,
  webhooksSummary,
  checkSummary,
  errorToolResult,
  formatApiReference,
  imageUrlsSummary,
  imageAvailabilitySummary,
  withImageMarkdown,
  inlineImageFormat,
  jsonToolResult,
  mcpInstructions,
  model3dSummary,
  nextStepFor,
  readingTextArguments,
  MAX_MCP_TOOL_INPUT_ELEMENTS,
  resolveSummary,
  searchSummary,
  toImageOptions,
  toVehicleMatch,
  vinNextStepFor,
  vinSummary,
  type ImageInput,
  type McpToolDefinition,
  type McpToolInput,
  type McpToolName,
  type McpToolResult,
  type McpToolset,
} from "@meterapp/car-image-sdk/mcp";
import { votesLabel } from "../commands/request.js";

/** `{ vehicle }` or `{ make, model, year }` from a tool input; the schema guarantees one of the two is complete. */
export function toVehicleSelector(input: { vehicle?: string; make?: string; model?: string; year?: number }): VehicleSelector {
  if (input.vehicle !== undefined) return { vehicle: input.vehicle };
  return { make: input.make ?? "", model: input.model ?? "", year: input.year ?? "" };
}

/** How the REST API echoes a color: the preset name, or a hex paint as `#rrggbb`. */
export function echoColor(color: string): string {
  const wire = colorParam(color);
  if (!isHexColor(wire)) return wire;
  const hex = wire.length === 3 ? wire.split("").map((digit) => digit + digit).join("") : wire;
  return `#${hex}`;
}

/** Converts the zod-parsed tool input into SDK params (drops undefined optionals). */
export function toImageParams(input: ImageInput): ImageParams {
  const params: ImageParams = { ...toVehicleSelector(input), view: input.view, color: input.color, format: input.format };
  if (input.size) params.size = input.size;
  if (input.width !== undefined) params.width = input.width;
  if (input.height !== undefined) params.height = input.height;
  if (input.fit !== undefined) params.fit = input.fit;
  if (input.background !== undefined) params.background = input.background;
  if (input.aspect_ratio !== undefined) params.aspectRatio = input.aspect_ratio;
  if (input.resolution !== undefined) params.resolution = input.resolution;
  if (input.framing !== undefined) params.framing = input.framing;
  if (input.trim !== undefined) params.trim = input.trim;
  if (input.padding !== undefined) params.padding = input.padding;
  if (input.shadow !== undefined) params.shadow = input.shadow;
  if (input.market !== undefined) params.market = input.market;
  return params;
}

/** Maps any thrown value onto an `isError` tool result with guidance for the agent, picked by `nextStep` from the status. */
export function toolErrorResult(error: unknown, nextStep: (status: number) => string = nextStepFor): McpToolResult {
  if (isCarImageError(error)) {
    const problem = (error.problem ?? {}) as Record<string, unknown>;
    const extra: Record<string, unknown> = { status: error.status, request_id: error.requestId };
    // The REST problem's machine-readable fields, as the hosted MCP sends them: agents branch on code and retryable.
    for (const key of [
      "code", "retryable", "parameter", "search", "next_step", "suggestions", "balance", "required_credits",
      "plan", "used", "included", "requested", "resets_at", "scope", "checkout_url", "next_plan", "pack_url",
    ]) {
      if (problem[key] !== undefined) extra[key] = problem[key];
    }
    if (error.retryAfterSeconds !== null) extra.retry_after = error.retryAfterSeconds;
    const checkout = typeof problem.checkout_url === "string" ? `\nCheckout link: ${problem.checkout_url}` : "";
    // A server error may be our bug: point the agent at the report tool with the id that finds it.
    const report = error.status >= 500 && error.requestId ? `\nIf it keeps failing, offer the human report_issue with request_id ${error.requestId}.` : "";
    return errorToolResult(`${error.title}: ${error.detail}${checkout}\n${nextStep(error.status)}${report}`, extra);
  }
  return errorToolResult(error instanceof Error ? error.message : String(error));
}

/** A purchase tool's answer, or its refusal with the code and the checkout link the human can pay through instead. */
export async function purchaseToolResult(run: () => Promise<{ data: { dry_run: boolean } }>): Promise<McpToolResult> {
  try {
    const result = await run();
    return jsonToolResult({ ...(result as unknown as Record<string, unknown>) }, result.data.dry_run ? "Quote only; nothing was charged. Confirm the amount with the human, then call again with dry_run false and the same purchase_id." : "Paid. Tell the human what was bought; the receipt went to the account owner.");
  } catch (error) {
    if (isCarImageError(error)) {
      const problem = (error.problem ?? {}) as Record<string, unknown>;
      const extra: Record<string, unknown> = { status: error.status, request_id: error.requestId };
      for (const key of ["code", "checkout_url", "action_url", "decline_code", "manage_url", "agent_spend"]) if (problem[key] !== undefined) extra[key] = problem[key];
      if (error.retryAfterSeconds !== null) extra.retry_after = error.retryAfterSeconds;
      const link = typeof problem.checkout_url === "string" ? ` Hand the human checkout_url: ${problem.checkout_url}` : "";
      return errorToolResult(`${error.title}: ${error.detail}${link}`, extra);
    }
    return toolErrorResult(error);
  }
}

export function cliCommandFor(params: { make: string; model: string; year: number | string; view?: string; color?: string }): string {
  const quote = (value: string) => (/[^A-Za-z0-9._-]/.test(value) ? JSON.stringify(value) : value);
  const parts = [`car-image get --make ${quote(params.make)} --model ${quote(params.model)} --year ${params.year}`];
  if (params.view) parts.push(`--view ${params.view}`);
  if (params.color) parts.push(`--color ${quote(colorParam(params.color))}`);
  return parts.join(" ");
}

type Handler<N extends McpToolName> = (input: McpToolInput<N>) => Promise<McpToolResult>;

/**
 * Registers a tool when the toolset has it; a tool outside the active toolset
 * is simply not advertised. The toolset is required: when it defaulted to
 * `all`, the twelve registrations that left it out shipped the whole set on
 * `car-image mcp` whatever `--toolset` said.
 */
function registerTool<N extends McpToolName>(server: McpServer, name: N, handler: Handler<N>, toolset: McpToolset): void {
  if (!(MCP_TOOLSETS[toolset] as readonly string[]).includes(name)) return;
  const definition: McpToolDefinition = MCP_TOOLS[name];
  server.registerTool(
    definition.name,
    {
      title: definition.title,
      description: definition.description,
      // A host that sends arguments as text ("true", "960", the JSON of a list) is read as it meant.
      inputSchema: readingTextArguments(definition.inputSchema),
      outputSchema: definition.outputSchema,
      // The Claude directory reads the title from annotations.title.
      annotations: { title: definition.title, ...definition.annotations },
    },
    async (args: unknown) => {
      try {
        return await handler(args as McpToolInput<N>);
      } catch (error) {
        return toolErrorResult(error);
      }
    }
  );
}

type RequestToolName =
  | "list_requests"
  | "request_vehicle"
  | "request_feature"
  | "get_request"
  | "upvote_request"
  | "comment_on_request"
  | "share_building"
  | "share_referral"
  | "report_issue"
  | "list_feedback"
  | "get_feedback"
  | "list_my_feedback"
  | "upvote_feedback"
  | "remove_feedback_vote"
  | "comment_on_feedback"
  | "submit_review"
  | "list_reviews";

/** One line for a create: what was filed, or what to upvote instead. */
export function filedLine(result: FiledFeedbackResponse, kind: "feature" | "issue"): string {
  if (result.created && result.data) {
    return `${kind === "issue" ? "Issue reported (private to the human and the team)" : "Feature request filed"}: "${result.data.title}". A thank-you email is on its way; every status change is emailed. Page: ${result.data.url}`;
  }
  const list = result.similar.map((item) => `${item.id} "${item.title}" (${item.status}, ${votesLabel(item.votes)})`).join("; ");
  return `Nothing filed: ${result.similar.length} similar item(s) exist: ${list}. Upvote the one that matches (upvote_feedback with its id); call again with force: true only if none does.`;
}

/**
 * Handlers for the request board and "about you" tools (definitions come from
 * the SDK like every other tool). Each one calls the REST API through the SDK;
 * list_requests and get_request work without a key.
 */
export function requestToolHandlers(client: CarImageClient): { [N in RequestToolName]: Handler<N> } {
  return {
    async list_requests(input) {
      const result = await client.listRequests({ kind: input.kind, status: input.status, sort: input.sort, limit: input.limit, cursor: input.cursor });
      const summary =
        result.data.length === 0
          ? "No requests match. request_vehicle or request_feature opens a new one."
          : `${result.data.length} request(s), sorted by ${input.sort}${result.next_cursor ? "; more with cursor" : ""}. Upvote with upvote_request(id).`;
      return jsonToolResult({ ...result }, summary);
    },
    async request_vehicle(input) {
      const result = await client.createRequest({ kind: "vehicle", make: input.make, model: input.model, year: input.year, body: input.note, ...(input.market === undefined ? {} : { market: input.market }) });
      const summary = result.deduplicated
        ? `An open request for ${result.data.title} already existed (${votesLabel(result.data.votes)}); the user's vote was added. Track it at ${result.data.url}`
        : `Requested ${result.data.title} (${votesLabel(result.data.votes)}). The team emails the user when it is live. Track it at ${result.data.url}`;
      return jsonToolResult({ ...result }, summary);
    },
    async request_feature(input) {
      const result = await client.requestFeature({ title: input.title, body: input.body, force: input.force });
      return jsonToolResult({ ...result }, filedLine(result, "feature"));
    },
    async report_issue(input) {
      const result = await client.reportIssue({
        title: input.title,
        body: input.body,
        requestId: input.request_id,
        context: { ...(input.context ?? {}), client: input.context?.client ?? "car-image-mcp" },
        force: input.force,
      });
      return jsonToolResult({ ...result }, filedLine(result, "issue"));
    },
    async list_feedback(input) {
      const result = await client.listFeedback({ kind: input.kind, status: input.status, sort: input.sort, q: input.q, limit: input.limit, cursor: input.cursor });
      const summary =
        result.data.length === 0
          ? "Nothing matches. request_feature files a new idea; report_issue reports a problem."
          : `${result.data.length} item(s), sorted by ${input.sort}${result.next_cursor ? "; more with cursor" : ""}. Upvote one with upvote_feedback(id).`;
      return jsonToolResult({ ...result }, summary);
    },
    async list_my_feedback(input) {
      const result = await client.listMyFeedback({ kind: input.kind, status: input.status, sort: "recent_activity", limit: input.limit, cursor: input.cursor });
      const summary = result.data.length === 0 ? "The human has not filed, voted on or commented on anything yet." : result.data.map((item) => `${item.title}: ${item.status}`).join("; ");
      return jsonToolResult({ ...result }, summary);
    },
    async get_feedback(input) {
      const result = await client.getFeedback(input.id);
      return jsonToolResult({ ...result, data: { ...result.data, timeline: result.data.timeline ?? [] } }, `${result.data.title}: ${result.data.status}, ${votesLabel(result.data.votes)}, ${result.data.comment_count} comment(s).`);
    },
    async upvote_feedback(input) {
      const result = await client.upvoteFeedback(input.id);
      return jsonToolResult({ ...result }, `Upvoted "${result.data.title}": ${votesLabel(result.data.votes)}. The human follows it now.`);
    },
    async remove_feedback_vote(input) {
      const result = await client.removeFeedbackVote(input.id);
      return jsonToolResult({ ...result }, `Vote removed from "${result.data.title}": ${votesLabel(result.data.votes)}.`);
    },
    async comment_on_feedback(input) {
      const result = await client.commentOnFeedback(input.id, input.body);
      return jsonToolResult({ ...result }, "Comment posted.");
    },
    async submit_review(input) {
      const result = await client.submitReview(input);
      if (!result.data) throw new Error("The review was not saved");
      const review = result.data;
      return jsonToolResult(
        { ...result, data: review, created: result.created ?? false },
        `${result.created ? "Review posted" : "Review updated"} (${review.rating}/5): ${review.status === "published" ? "it is on the reviews page" : "it shows after a quick check"}. Thank you.`
      );
    },
    async list_reviews(input) {
      const result = await client.listReviews({ sort: input.sort, rating: input.rating, limit: input.limit, cursor: input.cursor });
      return jsonToolResult({ ...result }, result.summary.count === 0 ? "No reviews yet." : `${result.summary.count} review(s), average ${result.summary.average} of 5.`);
    },
    async get_request(input) {
      const result = await client.getRequest(input.id);
      return jsonToolResult({ ...result }, `${result.data.title}: ${result.data.status}, ${votesLabel(result.data.votes)}, ${result.data.comment_count} comment(s).`);
    },
    async upvote_request(input) {
      const result = await client.voteRequest(input.id);
      return jsonToolResult({ ...result }, `Upvoted ${result.data.title}: ${votesLabel(result.data.votes)}.`);
    },
    async comment_on_request(input) {
      const result = await client.commentOnRequest(input.id, input.body);
      return jsonToolResult({ ...result }, `Comment added to ${result.data.request_id}.`);
    },
    async share_building(input) {
      const result = await client.shareBuilding(input.building);
      return jsonToolResult({ ...result }, "Saved. Only the Car Image team sees this.");
    },
    async share_referral(input) {
      const result = await client.shareReferral(input.source, input.detail);
      return jsonToolResult({ ...result }, "Saved. Only the Car Image team sees this.");
    },
  };
}

/**
 * Builds the stdio MCP server. Tools call the REST API through the SDK with
 * the configured key, so this process is the only place the key lives. The
 * `core` toolset is the default (look a vehicle up, render it, watch the
 * balance); `all` adds make logos, 3D models, image options, the API
 * reference, pricing, help and billing links, image feedback, the request
 * board and the two "about you" tools (`car-image mcp --toolset all`).
 */
export function buildStdioMcpServer(client: CarImageClient, toolset: McpToolset = DEFAULT_MCP_TOOLSET): McpServer {
  const server = new McpServer({ ...MCP_SERVER_INFO }, { maxToolInputElements: MAX_MCP_TOOL_INPUT_ELEMENTS, capabilities: { tools: {} }, instructions: mcpInstructions(toolset) });
  const register = <N extends McpToolName>(name: N, handler: Handler<N>): void => registerTool(server, name, handler, toolset);

  register("get_make_logo", async (input) => {
    const image = await client.getMakeLogo({ ...input, format: inlineImageFormat(input.format) });
    const usage = {
      credits_charged: image.creditsCharged, credits_remaining: image.creditsRemaining,
      source: image.source, width: image.width, height: image.height,
      content_type: image.contentType, etag: image.etag, request_id: image.requestId,
      notice: MAKE_LOGO_NOTICE,
    };
    return {
      content: [
        { type: "image", data: Buffer.from(image.bytes).toString("base64"), mimeType: image.contentType.split(";")[0] ?? "image/png" },
        { type: "text", text: JSON.stringify(usage) },
      ],
      structuredContent: usage,
    };
  });

  register("get_car_image", async (input) => {
    // An inline image has no Accept header to negotiate `auto` from; png it is,
    // the same as the hosted server answers.
    const params = { ...toImageParams(input), format: inlineImageFormat(input.format) };
    // The bytes response carries no JSON, so with a vehicle id the descriptor's
    // make, model and year come from the free lookup (an unknown id fails here,
    // before anything is counted). Without one, X-Vehicle-Id names the catalog
    // vehicle served, as the hosted server's descriptor does.
    const identity = input.vehicle !== undefined ? (await client.vehicle(input.vehicle)).data : null;
    const image = await client.getImage(params);
    // What the hosted server returns: the vehicle-image meter's month, or the credit meter's balance.
    const usage = {
      credits_charged: image.creditsCharged,
      ...(image.usage
        ? { vehicle_images: image.usage.vehicleImages }
        : { credits_remaining: image.creditsRemaining }),
      source: image.source,
      width: image.width,
      height: image.height,
      content_type: image.contentType,
      etag: image.etag,
      request_id: image.requestId,
      vehicle: {
        vehicle_id: identity?.id ?? image.vehicleId,
        make: identity ? identity.make.slug : (input.make ?? ""),
        model: identity ? identity.model.slug : (input.model ?? ""),
        year: identity ? identity.year : (input.year ?? 0),
        view: input.view,
        color: echoColor(input.color),
        format: params.format,
      },
      // Which appearance was served (X-Vehicle-Appearance), as the hosted server's result says.
      ...(image.appearance ? { appearance: image.appearance } : {}),
    };
    return {
      content: [
        { type: "image", data: Buffer.from(image.bytes).toString("base64"), mimeType: image.contentType.split(";")[0] ?? "image/png" },
        { type: "text", text: JSON.stringify(usage) },
      ],
      structuredContent: usage,
    };
  });

  register("create_car_image_urls", async (input) => {
    // The agent's idempotency_key travels as the Idempotency-Key header; the SDK
    // generates one when it is absent, so its own retries are safe either way.
    const result = await client.createImageUrls(input.images.map(toImageParams), {
      ttlSeconds: input.ttl_seconds,
      maxUses: input.max_uses,
      renew: input.renew,
      renewDays: input.renew_days,
      idempotencyKey: input.idempotency_key,
      market: input.market,
    });
    return jsonToolResult({ ...withImageMarkdown(result) }, imageUrlsSummary(result));
  });

  register("search_vehicles", async (input) => {
    const result = await client.searchVehicles(input.query, { limit: input.limit, year: input.year });
    // REST spells a hit make_name/model_name and omits the model on a make hit;
    // toVehicleMatch is what the remote server maps its catalog hits through too.
    const results = result.data.results.map((hit) => ({ ...toVehicleMatch(hit), ...(hit.id ? { id: hit.id } : {}), ...(hit.ids ? { ids: hit.ids } : {}) }));
    return jsonToolResult({ ...result, data: { query: input.query, results } }, searchSummary(input.query, results.length));
  });

  register("resolve_vehicle", async (input) => {
    const result = await client.resolve(input.query, input.market === undefined ? {} : { market: input.market });
    const payload = { ...result, cli: cliCommandFor(result.data.params) };
    return jsonToolResult(payload, resolveSummary(result.data));
  });

  register("decode_vin", async (input) => {
    try {
      const result = await client.decodeVin(input.vin, { year: input.year });
      return jsonToolResult({ ...result }, vinSummary(result.data));
    } catch (error) {
      // A refused or unknown VIN needs re-checking, not the catalog search (or another decode_vin) the generic 404 step suggests.
      return toolErrorResult(error, vinNextStepFor);
    }
  });

  register("get_image_availability", async (input) => {
    const result = await client.getImageAvailability({ ...toVehicleSelector(input), view: input.view, color: input.color, ...(input.market === undefined ? {} : { market: input.market }) });
    return jsonToolResult({ ...result }, imageAvailabilitySummary(result.data));
  });
  register("check_vehicles", async (input) => {
    const result = await client.checkVehicles(input.vehicles, { views: input.views === true, ...(input.market === undefined ? {} : { market: input.market }) });
    return jsonToolResult({ ...result }, checkSummary(result.data.summary));
  });

  register("list_image_options", async () => {
    const result = await client.options();
    return jsonToolResult({ ...result, data: toImageOptions(result.data) });
  });

  register("get_account", async () => {
    const result = await client.account();
    const perDollar = result.data.pricing?.credits_per_dollar ?? CREDITS_PER_DOLLAR;
    const payload = { ...result, data: { ...result.data, credits_usd: Number((result.data.credits / perDollar).toFixed(2)) } };
    return jsonToolResult(payload, accountSummary(result.data));
  });

  register("list_members", async () => {
    const result = await client.members();
    return jsonToolResult({ ...result }, membersSummary(result.data));
  });

  register("list_webhooks", async () => {
    const result = await client.listWebhooks();
    return jsonToolResult({ ...result }, webhooksSummary(result));
  });

  register("rate_image", async (input) => {
    const feedback = { rating: input.rating as 1 | 2 | 3 | 4 | 5 | undefined, verdict: input.verdict, reason: input.reason };
    if (input.rating === undefined && input.verdict === undefined) {
      return errorToolResult("Provide verdict (good|bad) or rating (1-5).");
    }
    let result;
    if (input.request_id) {
      result = await client.feedback({ requestId: input.request_id, ...feedback });
    } else if (input.vehicle) {
      result = await client.feedback({ vehicle: input.vehicle, view: input.view, color: input.color, ...feedback });
    } else if (input.make && input.model && input.year !== undefined) {
      result = await client.feedback({ make: input.make, model: input.model, year: input.year, view: input.view, color: input.color, ...feedback });
    } else {
      return errorToolResult("Identify the image with request_id, with a vehicle id, or with make, model and year.");
    }
    return jsonToolResult({ ...result }, "Feedback recorded. Thank you.");
  });

  register("report_image", async (input) => {
    const common = { reason: input.reason, externalRef: input.external_ref };
    const image = { type: input.type as "wrong_image" | "poor_quality" | undefined, category: input.category, ...common };
    let report: ImageReportInput;
    if (input.type === "missing_vehicle") {
      if (!input.make || !input.model || input.year === undefined) return errorToolResult("A missing_vehicle report needs make, model and year (and no image).");
      report = { type: "missing_vehicle", make: input.make, model: input.model, year: input.year, ...common };
    } else if (input.asset_id) {
      report = { ...image, assetId: input.asset_id };
    } else if (input.request_id) {
      report = { ...image, requestId: input.request_id };
    } else if (input.vehicle) {
      report = { ...image, vehicle: input.vehicle, view: input.view, color: input.color };
    } else if (input.make && input.model && input.year !== undefined) {
      report = { ...image, make: input.make, model: input.model, year: input.year, view: input.view, color: input.color };
    } else {
      return errorToolResult("Identify the image with request_id, asset_id, a vehicle id, or make, model and year; or send type missing_vehicle with make, model and year.");
    }
    const result = await client.reportImage(report);
    const filed = result.data;
    return jsonToolResult(
      { ...result },
      `${result.created === false ? "Added to the human's open report" : "Report filed"} (${filed.status}). Show the human its page, private to their account: ${filed.url}`
    );
  });

  register("create_3d_model", async (input) => {
    const result = await client.create3dModel(toVehicleSelector(input), {
      color: input.color,
      webhookUrl: input.webhook_url,
      webhookSecret: input.webhook_secret,
      publish: input.publish,
      idempotencyKey: input.idempotency_key,
    });
    return jsonToolResult({ ...result }, model3dSummary(result.data, result.billing));
  });

  register("get_3d_model", async (input) => {
    const result = await client.get3dModel(input.id);
    return jsonToolResult({ ...result }, model3dSummary(result.data));
  });

  register("publish_3d_model", async (input) => {
    const result = input.unpublish ? await client.unpublish3dModel(input.id) : await client.publish3dModel(input.id);
    return jsonToolResult(
      { ...result },
      input.unpublish ? `3D model ${result.data.id} is unpublished: its public URLs stop working within the hour.` : model3dSummary(result.data)
    );
  });

  register("describe_api", async (input) => {
    const text = formatApiReference(input.endpoint);
    return { content: [{ type: "text", text }] };
  });

  register("get_pricing", async () => jsonToolResult({ ...await client.pricing() }));
  register("search_help", async (input) => jsonToolResult({ ...await client.searchHelp(input.query, { reportGap: input.report_gap }) }));
  register("create_checkout_link", async (input) => jsonToolResult({ ...await client.createCheckoutLink(input) }));
  register("get_billing_link", async () => jsonToolResult({ ...await client.getBillingLink() }));
  register("purchase_plan", async (input) =>
    purchaseToolResult(() => client.purchasePlan({ plan: input.plan, interval: input.interval, paymentToken: input.payment_token, maxAmount: input.max_amount, dryRun: input.dry_run, idempotencyKey: input.purchase_id }))
  );
  register("pay_invoice", async (input) =>
    purchaseToolResult(() => client.payInvoice(input.invoice_id, { paymentToken: input.payment_token, maxAmount: input.max_amount, dryRun: input.dry_run, idempotencyKey: input.purchase_id }))
  );
  register("checkout_status", async (input) => jsonToolResult({ ...await client.checkoutStatus(input.session_id) }));

  const requests = requestToolHandlers(client);
  for (const name of Object.keys(requests) as RequestToolName[]) register(name, requests[name]);

  return server;
}

/** Serves MCP over stdio until the client disconnects or the process is signalled. */
export function serveMcpStdio(
  client: CarImageClient,
  log: (line: string) => void = (line) => process.stderr.write(line),
  toolset: McpToolset = DEFAULT_MCP_TOOLSET
): Promise<void> {
  return new Promise((resolve) => {
    const handle = serveStdio(() => buildStdioMcpServer(client, toolset), {
      onerror: (error) => log(`car-image mcp: ${error.message}\n`),
    });
    let closed = false;
    const shutdown = () => {
      if (closed) return;
      closed = true;
      void handle.close().finally(resolve);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    process.stdin.once("end", shutdown);
    process.stdin.once("close", shutdown);
  });
}
