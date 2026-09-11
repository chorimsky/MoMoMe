/* ============================================================
   Audio — a WhatsApp voice note (Ogg/Opus, 48 kHz) → the WAV Muse Voice Transcribe wants
   (RIFF, mono, 16-bit PCM, 16 kHz). Pure WASM decoder, no ffmpeg on the host.
   ============================================================ */
import { OggOpusDecoder } from "ogg-opus-decoder";

/** Interleave/average channels to mono, then box-filter downsample to `outRate`. */
function toMono16k(channels: Float32Array[], inRate: number, outRate = 16_000): Int16Array {
  const n = channels[0]?.length ?? 0;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (const ch of channels) s += ch[i] ?? 0; mono[i] = s / (channels.length || 1); }
  const ratio = inRate / outRate;
  const outN = Math.floor(n / ratio);
  const out = new Int16Array(outN);
  for (let i = 0; i < outN; i++) {
    const a = Math.floor(i * ratio), b = Math.min(n, Math.floor((i + 1) * ratio)) || a + 1;
    let s = 0; for (let j = a; j < b; j++) s += mono[j];
    const v = Math.max(-1, Math.min(1, s / (b - a)));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

/** Wrap 16-bit mono PCM in a RIFF/WAVE header. Exported for tests. */
export function wav16(pcm: Int16Array, rate = 16_000): Buffer {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Ogg/Opus bytes → WAV 16 kHz mono. Throws on undecodable input. */
export async function oggOpusToWav(ogg: Buffer): Promise<{ wav: Buffer; seconds: number }> {
  const dec = new OggOpusDecoder();
  await dec.ready;
  try {
    const { channelData, samplesDecoded, sampleRate } = await dec.decodeFile(new Uint8Array(ogg));
    const pcm = toMono16k(channelData, sampleRate);
    return { wav: wav16(pcm), seconds: samplesDecoded / sampleRate };
  } finally { dec.free(); }
}
