import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { CarImage } from "./react.js";

const KEY_ID = "0b7c5c1e-4f7a-4b55-9d4e-2a1f3c6d8e90";
const SECRET = `imgsig_${"a".repeat(43)}`;

afterEach(() => vi.unstubAllEnvs());

it("renders an img whose src is a signed URL, without the secret", async () => {
  const element = await CarImage({ vehicle: "veh_395yw8tn73ff8", view: "side", color: "red", width: 600, format: "auto", alt: "2024 Toyota Camry", className: "car", signing: { keyId: KEY_ID, signingSecret: SECRET } });
  const html = renderToStaticMarkup(element);
  expect(html).toMatch(/^<img /);
  expect(html).toContain('src="https://carimage.dev/i/veh_395yw8tn73ff8/side.auto?color=red&amp;k=');
  expect(html).toMatch(/sig=[0-9a-f]{64}"/);
  expect(html).toContain('alt="2024 Toyota Camry"');
  expect(html).toContain('width="600"');
  expect(html).toContain('loading="lazy"');
  expect(html).toContain('class="car"');
  expect(html).not.toContain(SECRET);
});

it("reads the key id and secret from the environment by default", async () => {
  vi.stubEnv("CAR_IMAGE_KEY_ID", KEY_ID);
  vi.stubEnv("CAR_IMAGE_SIGNING_SECRET", SECRET);
  const html = renderToStaticMarkup(await CarImage({ vehicle: "veh_395yw8tn73ff8", alt: "car" }));
  expect(html).toContain(`k=${KEY_ID}`);
});

it("refuses to render without credentials", async () => {
  await expect(CarImage({ vehicle: "veh_395yw8tn73ff8", alt: "car" })).rejects.toThrow(/keyId/);
});
