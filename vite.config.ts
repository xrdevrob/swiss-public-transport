import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    hmr: {
      overlay: false,
      host: process.env.HMR_HOST || "localhost",
      clientPort: Number(process.env.HMR_CLIENT_PORT || 3001),
      port: Number(process.env.HMR_CLIENT_PORT || 3001),
      protocol: process.env.HMR_PROTOCOL || "ws",
    },
  },
});
