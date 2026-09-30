import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Without this, sharp's native binary doesn't get traced into the deployed
  // functions — the dynamic import throws, and every image "optimization"
  // silently falls back to the original bytes (heroes shipped as full jpegs,
  // thumbs impossible). External = bundler leaves it alone, tracing includes it.
  serverExternalPackages: ["sharp"],
};

export default nextConfig;
