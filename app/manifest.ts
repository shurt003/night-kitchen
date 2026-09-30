import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Night Kitchen",
    short_name: "Kitchen",
    description: "Personal recipe library and grocery list.",
    start_url: "/",
    display: "standalone",
    // Honoured by Android when installed. iOS Safari ignores it and has no
    // orientation-lock API at all, so the real block is the CSS in globals.css.
    orientation: "portrait",
    background_color: "#f2f1ec",
    theme_color: "#f2f1ec",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      // Android crops maskable icons to a circle, so this one has the art pulled
      // into the safe zone rather than reusing the full-bleed square.
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
