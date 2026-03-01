const MISTRAL_BASE_URL = "https://api.mistral.ai/v1";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type MistralChatChoice = {
  message?: {
    role?: string;
    content?: string;
  };
};

type MistralChatResponse = {
  id: string;
  choices: MistralChatChoice[];
};

type MistralEmbeddingItem = {
  embedding: number[];
};

type MistralEmbeddingResponse = {
  data: MistralEmbeddingItem[];
};

type MistralErrorPayload = {
  error?: {
    message?: string;
    code?: string;
    type?: string;
  };
  message?: string;
};

export class MistralApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = "MistralApiError";
    this.status = status;
    this.code = code;
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

async function parseErrorPayload(res: Response): Promise<MistralErrorPayload | null> {
  try {
    return (await res.json()) as MistralErrorPayload;
  } catch {
    return null;
  }
}

async function mistralRequest<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const apiKey = requireEnv(process.env.MISTRAL_API_KEY, "MISTRAL_API_KEY");

  const res = await fetch(`${MISTRAL_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const parsed = await parseErrorPayload(res);
    let message =
      parsed?.error?.message ??
      parsed?.message ??
      `Mistral API error: HTTP ${res.status}`;
    if (res.status === 401) {
      message =
        "Mistral API unauthorized (401). Verify MISTRAL_API_KEY is a valid Mistral API key and that your Mistral project billing/access is enabled.";
    }
    const code = parsed?.error?.code ?? parsed?.error?.type;
    throw new MistralApiError(message, res.status, code, parsed);
  }

  return (await res.json()) as T;
}

export async function mistralChat(prompt: string): Promise<string> {
  const model = requireEnv(process.env.MISTRAL_TEXT_MODEL, "MISTRAL_TEXT_MODEL");
  const messages: ChatMessage[] = [{ role: "user", content: prompt }];

  const response = await mistralRequest<MistralChatResponse>("/chat/completions", {
    model,
    messages,
    temperature: 0,
  });

  const content = response.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new MistralApiError("Mistral chat response did not contain text content.", 500);
  }

  return content;
}

export async function mistralEmbed(text: string): Promise<number[]> {
  const model = requireEnv(process.env.MISTRAL_EMBED_MODEL, "MISTRAL_EMBED_MODEL");

  const response = await mistralRequest<MistralEmbeddingResponse>("/embeddings", {
    model,
    input: [text],
  });

  const embedding = response.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new MistralApiError("Mistral embedding response did not contain a valid vector.", 500);
  }

  const normalized = embedding
    .map((value) => (typeof value === "number" ? value : Number(value)))
    .filter((value) => Number.isFinite(value));

  if (normalized.length === 0) {
    throw new MistralApiError("Mistral embedding vector was empty after normalization.", 500);
  }

  return normalized;
}
