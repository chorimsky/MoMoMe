/* ============================================================
   /v1 assembly: import every handler module (each registers its routes on v1Public),
   then the envelope 404. Mounted at the top level in app.ts.
   ============================================================ */
import { v1Public, mountFallback } from "./index.js";
import "./quotes.js";
import "./payments.js";
import "./recipients.js";
import "./webhooks.js";
import "./account.js";
import { installPlatformHooks } from "../core/platform/hooks.js";
import { openApiV1 } from "./openapi.js";
import { config } from "../config.js";

installPlatformHooks();
// The contract, public: the portal renders it and the SDKs are generated from it.
v1Public.get("/openapi.json", (_req, res) => { res.setHeader("cache-control", "public, max-age=300"); res.json(openApiV1(config.publicUrl)); });
mountFallback();
export const publicV1 = v1Public;
