/* ============================================================
   Peex base client — thin fetch wrapper with bearer auth + timeout.
   Never imported by business logic directly; only the Peex service
   (facade) uses it. Real endpoint shapes are unverified, so callers
   mark "CONFIRM against Peex docs".
   ============================================================ */
import { config } from "../../config.js";

export class PeexClient {
  constructor(
    private apiKey: string = config.peex.apiKey,
    private baseUrl: string = config.peex.baseUrl,
  ) {}

  private async req(method: string, path: string, body?: unknown): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method,
        signal: ctrl.signal,
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  get(path: string) {
    return this.req("GET", path);
  }
  post(path: string, body: unknown) {
    return this.req("POST", path, body);
  }
}
