import { hfEmbed } from "@/lib/hf/client";
import { getIncidentEmbeddingDimension, validateEmbeddingLength } from "@/lib/db";

const MODEL = process.env.HF_EMBED_MODEL;
const TOKEN = process.env.HF_TOKEN;
const EMBED_WARN_THROTTLE_MS = 30000;

let lastEmbedWarnAt = 0;
let lastEmbedWarnMessage = "";

function requireEnv(value: string | undefined, key: string): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function deterministicEmbedding(text: string, dimension: number): number[] {
  const vector = new Array<number>(dimension).fill(0);
  if (dimension <= 0) {
    return vector;
  }

  let state = 2166136261 >>> 0;
  const normalizedText = text.trim() || "empty incident text";
  for (let i = 0; i < normalizedText.length; i += 1) {
    const code = normalizedText.charCodeAt(i);
    state ^= code;
    state = Math.imul(state, 16777619) >>> 0;

    const primaryIndex = state % dimension;
    const secondaryIndex = ((state >>> 8) + i) % dimension;
    vector[primaryIndex] += ((code % 31) + 1) / 31;
    vector[secondaryIndex] -= ((code % 17) + 1) / 17;
  }

  let norm = 0;
  for (const value of vector) {
    norm += value * value;
  }
  norm = Math.sqrt(norm);

  if (!Number.isFinite(norm) || norm === 0) {
    vector[0] = 1;
    return vector;
  }

  return vector.map((value) => value / norm);
}

type StepEmbedInput = {
  rawText: string;
  classification?: {
    title?: string;
    severity?: string;
    category?: string;
  };
  entities?: unknown;
  generated?: {
    summary_md?: string;
  };
};

export async function stepEmbed(payload: StepEmbedInput) {
  const model = requireEnv(MODEL, "HF_EMBED_MODEL");
  const token = requireEnv(TOKEN, "HF_TOKEN");
  const expectedDimension = await getIncidentEmbeddingDimension();
  const entitiesText = JSON.stringify(payload.entities ?? {}).slice(0, 1600);
  const summaryText = String(payload.generated?.summary_md ?? "").slice(0, 1000);
  const rawText = String(payload.rawText ?? "").slice(0, 1800);

  const text =
    `Title: ${payload.classification?.title ?? ""}\n` +
    `Severity: ${payload.classification?.severity ?? ""} Category: ${payload.classification?.category ?? ""}\n` +
    `Entities: ${entitiesText}\n` +
    `Summary: ${summaryText}\n` +
    `Raw: ${rawText}`;

  try {
    const vector = await hfEmbed(model, token, text);
    validateEmbeddingLength(vector, expectedDimension);
    return vector;
  } catch (error: unknown) {
    const fallback = deterministicEmbedding(text, expectedDimension);
    const message = `[stepEmbed] HF embedding failed; using deterministic fallback (${expectedDimension} dims): ${getErrorMessage(error)}`;
    const now = Date.now();
    const isSameAsLast = message === lastEmbedWarnMessage;
    const withinThrottleWindow = now - lastEmbedWarnAt < EMBED_WARN_THROTTLE_MS;

    if (!isSameAsLast || !withinThrottleWindow) {
      console.warn(message);
      lastEmbedWarnAt = now;
      lastEmbedWarnMessage = message;
    }
    return fallback;
  }
}
