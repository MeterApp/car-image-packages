import { DEFAULT_BASE_URL } from "@meterapp/car-image-sdk";
import { describe, expect, it } from "vitest";
import { createClientContext, resolveBaseUrl } from "./client.js";

describe("resolveBaseUrl", () => {
  it("takes --base-url, then CAR_IMAGE_API_URL, then the config, then the default", () => {
    const config = { baseUrl: "http://config.test" };
    const env = { CAR_IMAGE_API_URL: "http://env.test/" };
    expect(resolveBaseUrl({ "base-url": "http://flag.test" }, env, config)).toBe("http://flag.test");
    expect(resolveBaseUrl({}, env, config)).toBe("http://env.test");
    expect(resolveBaseUrl({}, {}, config)).toBe("http://config.test");
    expect(resolveBaseUrl({}, {}, {})).toBe(DEFAULT_BASE_URL);
  });

  it("reads the legacy car-imgs.vercel.app alias as the default, wherever it comes from", () => {
    expect(resolveBaseUrl({ "base-url": "https://car-imgs.vercel.app" }, {}, {})).toBe(DEFAULT_BASE_URL);
    expect(resolveBaseUrl({}, { CAR_IMAGE_API_URL: "https://car-imgs.vercel.app/" }, {})).toBe(DEFAULT_BASE_URL);
    expect(resolveBaseUrl({}, {}, { baseUrl: "https://car-imgs.vercel.app" })).toBe(DEFAULT_BASE_URL);
  });

  it("keeps a preview deployment, which is a different host", () => {
    expect(resolveBaseUrl({}, { CAR_IMAGE_API_URL: "https://car-imgs-git-main-meterapp.vercel.app" }, {})).toBe(
      "https://car-imgs-git-main-meterapp.vercel.app"
    );
  });
});

it("sends explicit bridge and host markers on real SDK requests", async () => {
  let headers: Headers | undefined;
  const context = createClientContext({}, { CAR_IMAGE_API_KEY: "test", CAR_IMAGE_HOST: "codex" }, {}, {
    kind: "mcp", fetch: async (_input, init) => {
      headers = new Headers(init?.headers);
      return Response.json({});
    },
  });
  await context.client.fetch("/api/v1/account");
  expect(headers?.get("X-CarImage-Integration")).toBe("mcp-stdio");
  expect(headers?.get("X-CarImage-Host")).toBe("codex");
  expect(headers?.get("Authorization")).toBe("Bearer test");
});
