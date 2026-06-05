import express from "express";
import cors from "cors";
import { api } from "./routes/api.js";
import { webhooks } from "./routes/webhooks.js";
import { seed } from "./seed.js";
import { config } from "./config.js";
import { listPayments } from "./core/store.js";
import { seedAdminUsers } from "./core/adminUsers.js";

/** Build the Express app (no listen). Used by the server bootstrap and tests. */
export function createApp() {
  const app = express();
  app.use(cors());

  // Webhooks need the raw body for signature verification — mount BEFORE express.json().
  app.use("/webhooks", webhooks);

  app.use(express.json({ limit: "1mb" })); // headroom for a base64 logo data URL in settings
  app.get("/health", (_req, res) => res.json({ ok: true, service: "momome-settlement", railsMode: config.railsMode }));
  app.use("/api", api);

  // Seed only a fresh database — on restart, state is restored from SQLite.
  if (listPayments().length === 0) seed();
  // Ensure at least the initial Super Admin account exists (idempotent).
  seedAdminUsers();
  return app;
}
