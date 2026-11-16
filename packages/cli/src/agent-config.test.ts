import { describe, expect, it } from "vitest";
import { MCP_UNLISTED_TOOLS } from "@meterapp/car-image-sdk/mcp";
import { AGENT_HOSTS, remoteServerConfig, remoteSignInServerConfig, renderAgentConfig, stdioServerConfig } from "./agent-config.js";

describe("agent-config", () => {
  const baseUrl = "https://carimage.dev";

  it("prints the exact claude mcp add commands: browser sign-in first, the key form second", () => {
    const text = renderAgentConfig({ host: "claude-code", remoteOnly: false, baseUrl });
    const signIn = 'claude mcp add --transport http car-image https://carimage.dev/api/mcp --header "X-CarImage-Host: claude-code"';
    const withKey = 'claude mcp add --transport http car-image https://carimage.dev/api/mcp --header "X-Api-Key: ${CAR_IMAGE_API_KEY}" --header "X-CarImage-Host: claude-code"';
    expect(text).toContain(`${signIn}\n`);
    expect(text).toContain(withKey);
    expect(text.indexOf(signIn)).toBeLessThan(text.indexOf(withKey));
    expect(text).toContain("claude mcp add car-image-local --env CAR_IMAGE_API_KEY=${CAR_IMAGE_API_KEY} --env CAR_IMAGE_HOST=claude-code -- npx -y @meterapp/car-image@latest mcp");
  });

  it("never gives Claude Code an Authorization header, which turns its browser sign-in off", () => {
    for (const remoteOnly of [false, true]) {
      const text = renderAgentConfig({ host: "claude-code", remoteOnly, baseUrl });
      expect(text).not.toMatch(/--header "Authorization/);
      expect(text).not.toContain('"Authorization"');
      const block = text.split("# Project-scoped alternative")[1]?.match(/\{[\s\S]*?\n\}/)?.[0] ?? "";
      const parsed = JSON.parse(block) as { mcpServers: Record<string, { url?: string; headers?: Record<string, string> }> };
      expect(parsed.mcpServers["car-image"]).toEqual({ type: "http", url: "https://carimage.dev/api/mcp", headers: { "X-CarImage-Host": "claude-code" } });
    }
    expect(remoteSignInServerConfig(baseUrl)).toEqual({ type: "http", url: "https://carimage.dev/api/mcp" });
    // Other hosts keep the Bearer form.
    expect(renderAgentConfig({ host: "cursor", remoteOnly: true, baseUrl })).toContain('"Authorization": "Bearer ${CAR_IMAGE_API_KEY}"');
  });

  it("never points users at a repository they cannot clone", () => {
    for (const host of AGENT_HOSTS) {
      const text = renderAgentConfig({ host, remoteOnly: false, baseUrl });
      expect(text).not.toContain("github.com");
      expect(text).not.toContain("/plugin marketplace add");
    }
  });

  it("describes hosted core and stdio all without adding query parameters to the config", () => {
    for (const host of AGENT_HOSTS) {
      for (const remoteOnly of [false, true]) {
        const text = renderAgentConfig({ host, remoteOnly, baseUrl });
        // Only the explanatory note includes the optional query.
        expect(text).toContain("https://carimage.dev/api/mcp?toolset=core");
        expect(text).not.toMatch(/"url": "[^"]*toolset/);
        expect(text).not.toMatch(/claude mcp add [^\n]*toolset/);
        expect(text).not.toMatch(/URL: \S*toolset/);
        expect(text).toContain("car-image mcp --toolset all");
        expect(text).toContain("Tools (core): resolve_vehicle, search_vehicles, decode_vin, check_vehicles, get_image_availability, get_car_image, create_car_image_urls, get_account, request_feature, report_issue, upvote_feedback, submit_review");
        expect(text).toContain("The full hosted toolset includes list_feedback, get_feedback, list_my_feedback, remove_feedback_vote, comment_on_feedback, list_reviews, get_make_logo, create_3d_model, get_3d_model, publish_3d_model, list_image_options, describe_api, get_pricing, search_help, create_checkout_link, get_billing_link, purchase_plan, pay_invoice, checkout_status, list_members, list_webhooks.");
        // Served on `all`, out of the public reference: the config never advertises them.
        for (const tool of MCP_UNLISTED_TOOLS) expect(text).not.toContain(tool);
      }
    }
    // A custom base URL is reflected in the opt-in hint too.
    expect(renderAgentConfig({ host: "generic", remoteOnly: true, baseUrl: "http://localhost:3002" })).toContain("http://localhost:3002/api/mcp?toolset=core");
    expect(remoteServerConfig(baseUrl).url).toBe("https://carimage.dev/api/mcp");
  });

  it("keeps keys out of URLs and uses placeholders only", () => {
    for (const host of AGENT_HOSTS) {
      const text = renderAgentConfig({ host, remoteOnly: false, baseUrl });
      expect(text).not.toMatch(/cimg_[A-Za-z0-9_-]{10,}/);
      expect(text).not.toMatch(/api_key=/);
      expect(text).toContain("${CAR_IMAGE_API_KEY}");
    }
  });

  it("produces http and stdio server entries", () => {
    expect(remoteServerConfig(baseUrl)).toEqual({ type: "http", url: "https://carimage.dev/api/mcp", headers: { Authorization: "Bearer ${CAR_IMAGE_API_KEY}" } });
    expect(stdioServerConfig(baseUrl)).toEqual({ command: "npx", args: ["-y", "@meterapp/car-image@latest", "mcp"], env: { CAR_IMAGE_API_KEY: "${CAR_IMAGE_API_KEY}" } });
    expect(stdioServerConfig("http://localhost:3002").env).toEqual({ CAR_IMAGE_API_KEY: "${CAR_IMAGE_API_KEY}", CAR_IMAGE_API_URL: "http://localhost:3002" });
  });

  it("honours --remote and renders valid JSON blocks for cursor", () => {
    const remote = renderAgentConfig({ host: "cursor", remoteOnly: true, baseUrl });
    expect(remote).not.toContain("npx");
    const block = remote.match(/\{[\s\S]*?\n\}/)?.[0] ?? "";
    const parsed = JSON.parse(block) as { mcpServers: Record<string, unknown> };
    expect(Object.keys(parsed.mcpServers)).toEqual(["car-image"]);
    const both = renderAgentConfig({ host: "cursor", remoteOnly: false, baseUrl });
    expect(both).toContain("car-image-local");
    expect(renderAgentConfig({ host: "chatgpt", remoteOnly: false, baseUrl })).toContain("openapi.json");
    expect(renderAgentConfig({ host: "chatgpt", remoteOnly: false, baseUrl })).toContain("Privacy policy URL: https://carimage.dev/privacy?ref=cli");
    expect(renderAgentConfig({ host: "claude-desktop", remoteOnly: false, baseUrl })).toContain("claude_desktop_config.json");
  });
});
