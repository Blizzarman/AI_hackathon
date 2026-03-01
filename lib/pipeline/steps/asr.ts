import { hfModelInferenceBinary } from "@/lib/hf/client";

const MODEL = process.env.HF_ASR_MODEL;
const TOKEN = process.env.HF_TOKEN;

function requireEnv(value: string | undefined, key: string): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

type DecodedDataUrl = {
  mime: string;
  bytes: Uint8Array;
};

function decodeBase64DataUrl(value: string, expectedMimePrefix: string): DecodedDataUrl {
  const trimmed = value.trim();
  const match = /^data:([^;]+);base64,([\s\S]+)$/i.exec(trimmed);
  if (!match) {
    throw new Error("ASR input must be a valid data URL with base64 payload.");
  }

  const mime = match[1].trim().toLowerCase();
  if (!mime.startsWith(expectedMimePrefix)) {
    throw new Error(`ASR input must use mime type starting with "${expectedMimePrefix}".`);
  }

  const rawBase64 = match[2].replace(/\s+/g, "");
  if (!rawBase64) {
    throw new Error("ASR input base64 payload is empty.");
  }

  const bytes = Buffer.from(rawBase64, "base64");
  if (bytes.length === 0) {
    throw new Error("ASR input base64 payload could not be decoded.");
  }

  return { mime, bytes };
}

function extractTextFromPayload(payload: unknown): string {
  if (typeof payload === "string") {
    return payload;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const text = extractTextFromPayload(item).trim();
      if (text) {
        return text;
      }
    }
    return "";
  }

  if (payload && typeof payload === "object") {
    const item = payload as Record<string, unknown>;
    const directKeys = ["text", "generated_text", "transcription", "transcript"];
    for (const key of directKeys) {
      const value = item[key];
      if (typeof value === "string" && value.trim()) {
        return value;
      }
    }

    const chunkContainers = ["chunks", "segments", "words", "data"];
    for (const key of chunkContainers) {
      const container = item[key];
      if (!Array.isArray(container)) {
        continue;
      }
      const joined = container
        .map((entry) => extractTextFromPayload(entry).trim())
        .filter(Boolean)
        .join(" ")
        .trim();
      if (joined) {
        return joined;
      }
    }
  }

  return "";
}

export async function stepASR(audioBase64: string): Promise<string> {
  const model = requireEnv(MODEL, "HF_ASR_MODEL");
  const token = requireEnv(TOKEN, "HF_TOKEN");
  const { mime, bytes } = decodeBase64DataUrl(audioBase64, "audio/");

  const response = await hfModelInferenceBinary(model, token, bytes, mime);
  const text = extractTextFromPayload(response).trim();
  if (!text) {
    throw new Error("HF ASR response did not contain transcript text.");
  }
  return text;
}
