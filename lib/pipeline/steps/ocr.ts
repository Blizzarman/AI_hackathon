const MODEL = process.env.HF_OCR_MODEL;
const TOKEN = process.env.HF_TOKEN;

const HF_OCR_ROUTER_BASE = "https://router.huggingface.co/hf-inference/models";
const OCR_MODEL_FALLBACKS = [
  "microsoft/trocr-base-stage1",
  "microsoft/trocr-large-printed",
  "naver-clova-ix/donut-base",
];

type DecodedDataUrl = {
  mime: string;
  bytes: Uint8Array;
};

export type OcrStepResult = {
  text: string;
  debug: {
    ocr_http_status: number | null;
    ocr_model: string;
    ocr_raw_preview: string;
    ocr_error?: string;
  };
};

function getModelCandidates(configuredModel: string | undefined): string[] {
  const configured = configuredModel?.trim() ?? "";
  return Array.from(
    new Set([OCR_MODEL_FALLBACKS[0], configured, OCR_MODEL_FALLBACKS[1], OCR_MODEL_FALLBACKS[2]]).values()
  ).filter(Boolean);
}

function decodeBase64DataUrl(value: string, expectedMimePrefix: string): DecodedDataUrl {
  const trimmed = value.trim();
  const match = /^data:([^;]+);base64,([\s\S]+)$/i.exec(trimmed);
  if (!match) {
    throw new Error("OCR input must be a valid image data URL with base64 payload.");
  }

  const mime = match[1].trim().toLowerCase();
  if (!mime.startsWith(expectedMimePrefix)) {
    throw new Error(`OCR input must use mime type starting with "${expectedMimePrefix}".`);
  }

  const rawBase64 = match[2].replace(/\s+/g, "");
  if (!rawBase64) {
    throw new Error("OCR input base64 payload is empty.");
  }

  const bytes = Buffer.from(rawBase64, "base64");
  if (bytes.length === 0) {
    throw new Error("OCR input base64 payload could not be decoded.");
  }

  return { mime, bytes };
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message || "Unknown OCR error";
  }
  if (typeof error === "string") {
    const message = error.trim();
    return message || "Unknown OCR error";
  }
  return "Unknown OCR error";
}

function truncateForDebug(value: string, maxChars: number): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars)}...`;
}

function stringifyPreview(payload: unknown): string {
  if (typeof payload === "string") {
    return truncateForDebug(payload, 300);
  }
  try {
    return truncateForDebug(JSON.stringify(payload), 300);
  } catch {
    return "";
  }
}

function parseMaybeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function looksLikeHtml(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith("<!doctype html") ||
    normalized.startsWith("<html") ||
    (normalized.includes("<html") && normalized.includes("</html>"))
  );
}

function cleanOutputText(value: string): string {
  return value.replace(/<\s*\/?\s*s\s*>/gi, "").trim();
}

function extractTextFromPayload(payload: unknown): string {
  if (typeof payload === "string") {
    return cleanOutputText(payload);
  }

  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      return "";
    }

    const first = payload[0];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      const row = first as Record<string, unknown>;
      if (typeof row.generated_text === "string" && row.generated_text.trim()) {
        return cleanOutputText(row.generated_text);
      }
      if (typeof row.text === "string" && row.text.trim()) {
        return cleanOutputText(row.text);
      }
    }

    for (const item of payload) {
      const extracted = extractTextFromPayload(item).trim();
      if (extracted) {
        return extracted;
      }
    }
    return "";
  }

  if (payload && typeof payload === "object") {
    const item = payload as Record<string, unknown>;
    if (typeof item.generated_text === "string" && item.generated_text.trim()) {
      return cleanOutputText(item.generated_text);
    }
    if (typeof item.text === "string" && item.text.trim()) {
      return cleanOutputText(item.text);
    }

    const predictions = item.predictions;
    if (Array.isArray(predictions) && predictions.length > 0) {
      const first = predictions[0];
      if (first && typeof first === "object" && !Array.isArray(first)) {
        const row = first as Record<string, unknown>;
        if (typeof row.text === "string" && row.text.trim()) {
          return cleanOutputText(row.text);
        }
      }
      const fromPredictions = extractTextFromPayload(predictions).trim();
      if (fromPredictions) {
        return fromPredictions;
      }
    }
  }

  return "";
}

function makeResult(
  text: string,
  debug: OcrStepResult["debug"],
  logError = false
): OcrStepResult {
  if (logError && debug.ocr_error) {
    console.warn("[stepOCR] OCR failed; returning empty text.", debug.ocr_error);
  }
  return { text, debug };
}

export async function stepOCR(imageBase64: string): Promise<OcrStepResult> {
  const token = TOKEN?.trim() ?? "";
  if (!token) {
    return makeResult(
      "",
      {
        ocr_http_status: null,
        ocr_model: MODEL?.trim() ?? "",
        ocr_raw_preview: "",
        ocr_error: "Missing required environment variable: HF_TOKEN",
      },
      true
    );
  }

  try {
    const { bytes } = decodeBase64DataUrl(imageBase64, "image/");
    const models = getModelCandidates(MODEL);
    if (models.length === 0) {
      return makeResult(
        "",
        {
          ocr_http_status: null,
          ocr_model: "",
          ocr_raw_preview: "",
          ocr_error: "No OCR model configured.",
        },
        true
      );
    }

    const attemptedErrors: string[] = [];
    let lastDebug: OcrStepResult["debug"] = {
      ocr_http_status: null,
      ocr_model: models[0],
      ocr_raw_preview: "",
    };

    for (const model of models) {
      const endpoint = `${HF_OCR_ROUTER_BASE}/${encodeURIComponent(model)}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          Accept: "application/json",
        },
        body: Buffer.from(bytes),
      });

      const rawBody = await res.text();
      const payload = parseMaybeJson(rawBody);
      const ocrRawPreview = stringifyPreview(payload) || truncateForDebug(rawBody, 300);

      lastDebug = {
        ocr_http_status: res.status,
        ocr_model: model,
        ocr_raw_preview: ocrRawPreview,
      };

      if (!res.ok) {
        let errorMessage = `HF OCR error: HTTP ${res.status}`;
        if (payload && typeof payload === "object" && !Array.isArray(payload)) {
          const parsed = payload as Record<string, unknown>;
          if (typeof parsed.error === "string" && parsed.error.trim()) {
            errorMessage = parsed.error.trim();
          } else if (typeof parsed.message === "string" && parsed.message.trim()) {
            errorMessage = parsed.message.trim();
          }
        }
        attemptedErrors.push(`${model}: ${errorMessage}`);
        continue;
      }

      if (typeof payload === "string") {
        if (looksLikeHtml(payload)) {
          attemptedErrors.push(`${model}: Non-JSON HTML response from OCR endpoint.`);
        } else {
          attemptedErrors.push(`${model}: Non-JSON OCR response.`);
        }
        continue;
      }

      const extracted = extractTextFromPayload(payload).trim();
      if (!extracted) {
        attemptedErrors.push(`${model}: HF OCR response did not contain text.`);
        continue;
      }

      return makeResult(extracted, lastDebug);
    }

    return makeResult(
      "",
      {
        ...lastDebug,
        ocr_error: attemptedErrors.join(" | ") || "All OCR model attempts failed.",
      },
      true
    );
  } catch (error: unknown) {
    return makeResult(
      "",
      {
        ocr_http_status: null,
        ocr_model: MODEL?.trim() ?? OCR_MODEL_FALLBACKS[0],
        ocr_raw_preview: "",
        ocr_error: normalizeErrorMessage(error),
      },
      true
    );
  }
}
