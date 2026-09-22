import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Genera .next/standalone con solo lo necesario para correr en producción:
  // la imagen de Cloud Run queda chica y sin node_modules completo.
  output: "standalone",
};

export default nextConfig;
