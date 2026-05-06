import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      /** Fotos en FormData (captura, inventario, etc.); el valor por defecto 1 MB devolvía 413. */
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;