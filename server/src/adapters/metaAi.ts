/* ============================================================
   Meta Model API (Muse) — two narrow uses, both OUTSIDE the money path:
     • transcribe a voice note  (POST /v1/asr/transcribe, WAV in → text out)
     • read an intent out of free text (POST /v1/chat/completions, constrained JSON)
   The model proposes; shared/domain checks and the confirm screen dispose. Every call has
   a short timeout and a null return: the regex bot is the fallback, never a dead end.
   Key: META_AI_API_KEY (Railway). Unset → both functions return null immediately.
   ============================================================ */
import { fetchT } from "./http.js";
import { config } from "../config.js";

export const metaAiConfigured = (): boolean => !!config.metaAi.apiKey;

const auth = () => ({ authorization: `Bearer ${config.metaAi.apiKey}` });

/** Voice note → text. `keywords` bias the recogniser toward our vocabulary (MTN, Orange,
 *  MoMo, XAF, "envoyer", digits) so numbers survive a noisy road. null = unavailable. */
export async function transcribe(wav: Buffer, opts: { keywords?: string[] } = {}): Promise<{ text: string; ms: number } | null> {
  if (!metaAiConfigured()) return null;
  try {
    const form = new FormData();
    form.append("request", new Blob([JSON.stringify({
      mode: "PUSH_TO_TALK", model: config.metaAi.asrModel, audioEncoding: "WAV",
      languageBias: ["French", "English"], keywords: opts.keywords ?? [],
    })], { type: "application/json" }));
    form.append("audio", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "note.wav");
    const res = await fetchT(`${config.metaAi.apiUrl}/asr/transcribe`, { method: "POST", headers: auth(), body: form }, 20_000);
    if (!res.ok) { console.warn(`[meta-ai] transcribe ${res.status}: ${(await res.text()).slice(0, 160)}`); return null; }
    const j = (await res.json()) as { transcript?: string; audioDurationMs?: number };
    const text = (j.transcript ?? "").trim();
    return text ? { text, ms: j.audioDurationMs ?? 0 } : null;
  } catch (e) {
    console.warn("[meta-ai] transcribe failed", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Free text → JSON matching `schema` (decoding is constrained server-side). null = unavailable. */
export async function structured<T>(system: string, user: string, name: string, schema: Record<string, unknown>): Promise<T | null> {
  if (!metaAiConfigured()) return null;
  try {
    const res = await fetchT(`${config.metaAi.apiUrl}/chat/completions`, {
      method: "POST", headers: { ...auth(), "content-type": "application/json" },
      body: JSON.stringify({
        // Muse Spark reasons before it answers and the reasoning counts against max_tokens:
        // a 300-token budget returned content:null on a 40-token answer (measured 442
        // reasoning tokens). Low effort + a roomy budget keeps intents under ~3 s.
        model: config.metaAi.model, temperature: 0, max_tokens: 1500, reasoning_effort: "low",
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
      }),
    }, 12_000);
    if (!res.ok) { console.warn(`[meta-ai] chat ${res.status}: ${(await res.text()).slice(0, 160)}`); return null; }
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = j.choices?.[0]?.message?.content;
    return content ? (JSON.parse(content) as T) : null;
  } catch (e) {
    console.warn("[meta-ai] chat failed", e instanceof Error ? e.message : e);
    return null;
  }
}
