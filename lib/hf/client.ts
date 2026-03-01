import { recordModelCall } from "@/lib/telemetry/model-calls";

const HF_ROUTER_MODEL_BASE = "https://router.huggingface.co/hf-inference/models";
const HF_ROUTER_CHAT_URL = "https://router.huggingface.co/v1/chat/completions";
const HF_API_INFERENCE_MODEL_BASE = "https://api-inference.huggingface.co/models";
const HF_TEXT_MAX_NEW_TOKENS = 700;
const HF_TEXT_TEMPERATURE = 0;
const HF_DEFAULT_EMBED_FALLBACK_MODEL = "sentence-transformers/all-MiniLM-L6-v2";
const HF_EMBED_FALLBACK_DIM = 1024;
const HF_EMBED_RETRY_ATTEMPTS = 3;
const HF_EMBED_RETRY_BASE_DELAY_MS = 600;

type HFErrorPayload = {
  error?:
    | string
    | {
        message?: string;
        type?: string;
        code?: string;
        param?: string;
      };
  message?: string;
  estimated_time?: number;
  warnings?: string[];
};

function isHtmlPayload(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return (
    trimmed.startsWith("<!doctype html") ||
    trimmed.startsWith("<html") ||
    (trimmed.includes("<html") && trimmed.includes("</html>"))
  );
}

function summarizeHtmlError(status: number, payload: string): string {
  if (/gateway timeout/i.test(payload)) {
    return `HF API error: HTTP ${status} Gateway Timeout`;
  }
  if (/bad gateway/i.test(payload)) {
    return `HF API error: HTTP ${status} Bad Gateway`;
  }
  if (/service unavailable/i.test(payload)) {
    return `HF API error: HTTP ${status} Service Unavailable`;
  }
  if (/unauthorized|authentication/i.test(payload)) {
    return `HF API error: HTTP ${status} Unauthorized`;
  }
  return `HF API error: HTTP ${status} (HTML error page returned)`;
}

export class HfApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "HfApiError";
    this.status = status;
    this.details = details;
  }
}

function requireEnv(value: string | undefined, key: string): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return trimmed;
}

function getUnknownErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function parseErrorPayload(res: Response): Promise<HFErrorPayload | null> {
  const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
  try {
    if (contentType.includes("application/json")) {
      return (await res.json()) as HFErrorPayload;
    }
    const text = await res.text();
    if (!text.trim()) {
      return null;
    }
    try {
      return JSON.parse(text) as HFErrorPayload;
    } catch {
      return { error: text };
    }
  } catch {
    return null;
  }
}

function getErrorMessage(payload: HFErrorPayload | null, status: number): string {
  if (!payload) {
    return `HF API error: HTTP ${status}`;
  }

  if (typeof payload.error === "string" && payload.error.trim()) {
    const message = payload.error.trim();
    if (isHtmlPayload(message)) {
      return summarizeHtmlError(status, message);
    }
    return message;
  }

  if (typeof payload.error === "object" && payload.error?.message) {
    const message = payload.error.message.trim();
    if (isHtmlPayload(message)) {
      return summarizeHtmlError(status, message);
    }
    return message;
  }

  if (typeof payload.message === "string" && payload.message.trim()) {
    const message = payload.message.trim();
    if (isHtmlPayload(message)) {
      return summarizeHtmlError(status, message);
    }
    return message;
  }

  return `HF API error: HTTP ${status}`;
}

function normalizeNumberArray(values: unknown[]): number[] {
  return values
    .map((entry) => (typeof entry === "number" ? entry : Number(entry)))
    .filter((entry) => Number.isFinite(entry));
}

function meanPool(matrix: number[][]): number[] {
  const dimension = matrix[0].length;
  const pooled = new Array<number>(dimension).fill(0);
  for (const row of matrix) {
    for (let i = 0; i < dimension; i += 1) {
      pooled[i] += row[i];
    }
  }
  for (let i = 0; i < dimension; i += 1) {
    pooled[i] /= matrix.length;
  }
  return pooled;
}

const HF_SENTENCE_ANCHORS: string[] = Array.from(
  { length: HF_EMBED_FALLBACK_DIM },
  (_, i) => `anchor token ${i}`
);

async function parseSuccessPayload(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    return (await res.json()) as unknown;
  }

  const text = await res.text();
  if (!text.trim()) {
    return "";
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function hfJsonRequest<T>(
  url: string,
  token: string,
  body: Record<string, unknown>
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const parsed = await parseErrorPayload(res);
    const message = getErrorMessage(parsed, res.status);
    throw new HfApiError(message, res.status, parsed);
  }

  return (await parseSuccessPayload(res)) as T;
}

function shouldRetryEmbedRequest(error: unknown): boolean {
  if (!(error instanceof HfApiError)) {
    return false;
  }
  return [408, 429, 500, 502, 503, 504].includes(error.status);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function hfJsonRequestWithRetry<T>(
  url: string,
  token: string,
  body: Record<string, unknown>,
  attempts: number
): Promise<T> {
  let lastError: unknown = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await hfJsonRequest<T>(url, token, body);
    } catch (error: unknown) {
      lastError = error;
      const retryable = shouldRetryEmbedRequest(error);
      const isLastAttempt = i >= attempts - 1;
      if (!retryable || isLastAttempt) {
        throw error;
      }
      const delayMs = HF_EMBED_RETRY_BASE_DELAY_MS * (i + 1);
      await wait(delayMs);
    }
  }
  throw lastError;
}

async function hfBinaryRequest(
  url: string,
  token: string,
  bytes: Uint8Array,
  mimeType: string
): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": mimeType,
    },
    body: Buffer.from(bytes),
  });

  if (!res.ok) {
    const parsed = await parseErrorPayload(res);
    const message = getErrorMessage(parsed, res.status);
    throw new HfApiError(message, res.status, parsed);
  }

  return parseSuccessPayload(res);
}

function extractChatContent(content: unknown): string | null {
  if (typeof content === "string") {
    const value = content.trim();
    return value || null;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const joined = content
    .map((chunk) => {
      if (typeof chunk === "string") {
        return chunk;
      }
      if (!chunk || typeof chunk !== "object") {
        return "";
      }
      const text = (chunk as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .join("")
    .trim();

  return joined || null;
}

function extractGeneratedText(data: unknown): string | null {
  if (typeof data === "string") {
    const value = data.trim();
    return value || null;
  }

  if (Array.isArray(data)) {
    for (const row of data) {
      const value = extractGeneratedText(row);
      if (value) {
        return value;
      }
    }
    return null;
  }

  if (!data || typeof data !== "object") {
    return null;
  }

  const payload = data as Record<string, unknown>;
  const choices = payload.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const firstChoice = choices[0];
    if (firstChoice && typeof firstChoice === "object") {
      const message = (firstChoice as { message?: { content?: unknown } }).message;
      const value = extractChatContent(message?.content);
      if (value) {
        return value;
      }
    }
  }

  if (typeof payload.generated_text === "string" && payload.generated_text.trim()) {
    return payload.generated_text.trim();
  }

  if (typeof payload.text === "string" && payload.text.trim()) {
    return payload.text.trim();
  }

  return null;
}

function isNotChatModelError(error: unknown): boolean {
  const message = getUnknownErrorMessage(error);
  return /not a chat model/i.test(message);
}

function isModelNotFoundError(error: unknown): boolean {
  if (error instanceof HfApiError && error.status === 404) {
    return true;
  }
  return /not found/i.test(getUnknownErrorMessage(error));
}

function isMistralModelId(value: string): boolean {
  return value.trim().toLowerCase().startsWith("mistralai/");
}

function resolveEmbedFallbackModel(): string {
  return process.env.HF_EMBED_FALLBACK_MODEL?.trim() || HF_DEFAULT_EMBED_FALLBACK_MODEL;
}

async function embedWithModel(model: string, token: string, text: string): Promise<number[]> {
  const normalizedModel = encodeURIComponent(model);
  const url = `${HF_ROUTER_MODEL_BASE}/${normalizedModel}`;
  let vector: number[] | null = null;

  try {
    const data = await hfJsonRequestWithRetry<unknown>(
      url,
      token,
      { inputs: text },
      HF_EMBED_RETRY_ATTEMPTS
    );

    if (Array.isArray(data) && data.length > 0 && Array.isArray(data[0])) {
      const matrix = (data as unknown[]).map((row) => normalizeNumberArray(row as unknown[]));
      if (matrix.length === 0 || matrix[0].length === 0) {
        throw new HfApiError("HF embed response matrix was empty.", 500, data);
      }
      vector = meanPool(matrix);
    } else if (Array.isArray(data)) {
      const directVector = normalizeNumberArray(data);
      if (directVector.length === 0) {
        throw new HfApiError("HF embed response vector was empty.", 500, data);
      }
      vector = directVector;
    } else {
      throw new HfApiError("HF embed response had unsupported shape.", 500, data);
    }
  } catch (error: unknown) {
    const hfError = error instanceof HfApiError ? error : null;
    const message = hfError?.message ?? "";
    const shouldTrySentenceSimilarity =
      message.includes("SentenceSimilarityPipeline") || (hfError !== null && hfError.status === 400);

    if (!shouldTrySentenceSimilarity) {
      throw error;
    }

    const similarityData = await hfJsonRequestWithRetry<unknown>(
      url,
      token,
      {
        inputs: {
          source_sentence: text.slice(0, 3000),
          sentences: HF_SENTENCE_ANCHORS,
        },
      },
      HF_EMBED_RETRY_ATTEMPTS
    );

    if (!Array.isArray(similarityData)) {
      throw new HfApiError(
        "HF sentence-similarity embed fallback returned invalid shape.",
        500,
        similarityData
      );
    }

    const fallbackVector = normalizeNumberArray(similarityData);
    if (fallbackVector.length !== HF_EMBED_FALLBACK_DIM) {
      throw new HfApiError(
        `HF sentence-similarity embed fallback returned ${fallbackVector.length} values, expected ${HF_EMBED_FALLBACK_DIM}.`,
        500,
        similarityData
      );
    }

    vector = fallbackVector;
  }

  if (!vector) {
    throw new HfApiError("HF embed returned empty vector.", 500);
  }

  return vector;
}

export async function hfTextGenerate(model: string, token: string, prompt: string): Promise<string> {
  const normalizedModel = requireEnv(model, "HF_TEXT_MODEL");
  const normalizedToken = requireEnv(token, "HF_TOKEN");

  const chatStartedAt = Date.now();
  try {
    const data = await hfJsonRequest<unknown>(HF_ROUTER_CHAT_URL, normalizedToken, {
      model: normalizedModel,
      messages: [{ role: "user", content: prompt }],
      temperature: HF_TEXT_TEMPERATURE,
    });

    const text = extractGeneratedText(data);
    if (!text) {
      throw new HfApiError("HF text response did not contain chat completion content.", 500, data);
    }

    recordModelCall({
      provider: "huggingface",
      kind: "text_generate",
      route: "chat",
      model: normalizedModel,
      latency_ms: Date.now() - chatStartedAt,
      input_chars: prompt.length,
      output_chars: text.length,
      ok: true,
    });

    return text;
  } catch (chatError: unknown) {
    recordModelCall({
      provider: "huggingface",
      kind: "text_generate",
      route: "chat",
      model: normalizedModel,
      latency_ms: Date.now() - chatStartedAt,
      input_chars: prompt.length,
      output_chars: 0,
      ok: false,
      error: getUnknownErrorMessage(chatError),
    });

    if (!isNotChatModelError(chatError)) {
      throw chatError;
    }
  }

  const textGenStartedAt = Date.now();
  try {
    const data = await hfJsonRequest<unknown>(
      `${HF_API_INFERENCE_MODEL_BASE}/${encodeURIComponent(normalizedModel)}`,
      normalizedToken,
      {
        inputs: prompt,
        parameters: {
          max_new_tokens: HF_TEXT_MAX_NEW_TOKENS,
          temperature: HF_TEXT_TEMPERATURE,
          return_full_text: false,
        },
      }
    );

    const text = extractGeneratedText(data);
    if (!text) {
      throw new HfApiError("HF text-generation response did not include generated_text.", 500, data);
    }

    recordModelCall({
      provider: "huggingface",
      kind: "text_generate",
      route: "text-generation",
      model: normalizedModel,
      latency_ms: Date.now() - textGenStartedAt,
      input_chars: prompt.length,
      output_chars: text.length,
      ok: true,
    });

    return text;
  } catch (textGenerationError: unknown) {
    recordModelCall({
      provider: "huggingface",
      kind: "text_generate",
      route: "text-generation",
      model: normalizedModel,
      latency_ms: Date.now() - textGenStartedAt,
      input_chars: prompt.length,
      output_chars: 0,
      ok: false,
      error: getUnknownErrorMessage(textGenerationError),
    });
    throw textGenerationError;
  }
}

export async function hfModelInference(
  model: string,
  token: string,
  inputs: unknown
): Promise<unknown> {
  const normalizedModel = encodeURIComponent(requireEnv(model, "HF model"));
  const normalizedToken = requireEnv(token, "HF_TOKEN");

  return hfJsonRequest<unknown>(`${HF_ROUTER_MODEL_BASE}/${normalizedModel}`, normalizedToken, {
    inputs,
  });
}

export async function hfModelInferenceBinary(
  model: string,
  token: string,
  bytes: Uint8Array,
  mimeType: string
): Promise<unknown> {
  const normalizedModel = encodeURIComponent(requireEnv(model, "HF model"));
  const normalizedToken = requireEnv(token, "HF_TOKEN");
  const normalizedMimeType = requireEnv(mimeType, "HF media mime type");

  return hfBinaryRequest(
    `${HF_ROUTER_MODEL_BASE}/${normalizedModel}`,
    normalizedToken,
    bytes,
    normalizedMimeType
  );
}

export async function hfEmbed(model: string, token: string, text: string): Promise<number[]> {
  const primaryModel = requireEnv(model, "HF_EMBED_MODEL");
  const normalizedToken = requireEnv(token, "HF_TOKEN");
  const fallbackModel = resolveEmbedFallbackModel();
  const startedAt = Date.now();

  let finalModel = primaryModel;
  try {
    let vector: number[];
    try {
      vector = await embedWithModel(primaryModel, normalizedToken, text);
    } catch (primaryError: unknown) {
      const shouldFallback =
        isMistralModelId(primaryModel) &&
        isModelNotFoundError(primaryError) &&
        fallbackModel.toLowerCase() !== primaryModel.toLowerCase();

      if (!shouldFallback) {
        throw primaryError;
      }

      console.warn(`HF embed model not available: ${primaryModel}. Falling back to ${fallbackModel}.`);
      finalModel = fallbackModel;
      vector = await embedWithModel(fallbackModel, normalizedToken, text);
    }

    recordModelCall({
      provider: "huggingface",
      kind: "embedding",
      route: finalModel === primaryModel ? "primary" : "fallback",
      model: finalModel,
      latency_ms: Date.now() - startedAt,
      input_chars: text.length,
      output_chars: JSON.stringify(vector).length,
      ok: true,
    });

    return vector;
  } catch (error: unknown) {
    recordModelCall({
      provider: "huggingface",
      kind: "embedding",
      route: finalModel === primaryModel ? "primary" : "fallback",
      model: finalModel,
      latency_ms: Date.now() - startedAt,
      input_chars: text.length,
      output_chars: 0,
      ok: false,
      error: getUnknownErrorMessage(error),
    });
    throw error;
  }
}
