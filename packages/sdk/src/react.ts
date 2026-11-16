import { createElement, type ImgHTMLAttributes, type ReactElement } from "react";
import { carImageUrl, type CarImageUrlOptions, type SignedImageParams } from "./signed-url.js";

/**
 * `<CarImage>` for React Server Components (Next.js App Router, Remix, any
 * RSC host): an `<img>` whose `src` is an account-signed URL, signed on the
 * server while the page renders, so the browser loads the image from the CDN
 * and never sees the signing secret. Import from `@meterapp/car-image-sdk/react`;
 * React 18.3+ is an optional peer dependency of the SDK.
 *
 * ```tsx
 * <CarImage vehicle="veh_395yw8tn73ff8" view="side" color="red" width={600} format="auto" alt="2024 Toyota Camry" />
 * ```
 *
 * The key id and secret default to the CAR_IMAGE_KEY_ID and
 * CAR_IMAGE_SIGNING_SECRET environment variables; pass `signing` to name them
 * yourself. Never render it in a client component: the secret would ship to
 * the browser.
 */
export type CarImageProps = SignedImageParams &
  Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "srcSet" | "width" | "height" | "color"> & {
    alt: string;
    signing?: Partial<CarImageUrlOptions>;
  };

type EnvLike = { env?: Record<string, string | undefined> };

function readEnv(name: string): string | undefined {
  const value = (globalThis as { process?: EnvLike }).process?.env?.[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function CarImage(props: CarImageProps): Promise<ReactElement> {
  const { vehicle, view, color, size, width, height, fit, background, framing, trim, padding, shadow, format, signing, ...img } = props;
  const src = await carImageUrl(
    { vehicle, view, color, size, width, height, fit, background, framing, trim, padding, shadow, format },
    {
      keyId: signing?.keyId ?? readEnv("CAR_IMAGE_KEY_ID") ?? "",
      signingSecret: signing?.signingSecret ?? readEnv("CAR_IMAGE_SIGNING_SECRET") ?? "",
      origin: signing?.origin ?? readEnv("CAR_IMAGE_API_URL"),
      expiresAt: signing?.expiresAt,
    }
  );
  return createElement("img", { loading: "lazy", decoding: "async", ...img, src, width, height });
}
