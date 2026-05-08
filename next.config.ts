import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      /** Fotos en FormData (captura, inventario, etc.); el valor por defecto 1 MB devolvía 413. */
      bodySizeLimit: "10mb",
    },
  },
  /** pdfjs-dist usa `import("./pdf.worker.mjs")`; si se bundlea, la ruta cae en `.next/.../chunks/` y falla el fake worker. */
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;