import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "家計簿",
    short_name: "家計簿",
    description: "シンプルな共有家計簿 OSS",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#eef2ff",
    theme_color: "#2563eb",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  };
}
