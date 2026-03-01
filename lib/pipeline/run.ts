import { IncidentInputSchema, PipelineResultSchema } from "@/lib/schema";
import { createRequestId } from "@/lib/api/request-id";
import {
  getRecordedModelCalls,
  withModelTelemetryContext,
} from "@/lib/telemetry/model-calls";
import { stepASR } from "./steps/asr";
import { stepClassify } from "./steps/classify";
import { stepEmbed } from "./steps/embed";
import { stepEnrich } from "./steps/enrich";
import { stepExtract } from "./steps/extract";
import { stepGenerate } from "./steps/generate";
import { stepOCR, type OcrStepResult } from "./steps/ocr";

export type StepLog = {
  name: string;
  ms: number;
  ok: boolean;
  meta?: Record<string, unknown>;
  error?: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function runLoggedStep<T>(
  logs: StepLog[],
  name: string,
  fn: () => Promise<T>,
  requestId: string,
  onSuccessMeta?: (value: T) => Record<string, unknown> | undefined
): Promise<T> {
  const startedAt = Date.now();
  try {
    const value = await fn();
    logs.push({
      name,
      ms: Date.now() - startedAt,
      ok: true,
      meta: {
        request_id: requestId,
        ...(onSuccessMeta ? onSuccessMeta(value) : {}),
      },
    });
    return value;
  } catch (error: unknown) {
    logs.push({
      name,
      ms: Date.now() - startedAt,
      ok: false,
      meta: {
        request_id: requestId,
      },
      error: getErrorMessage(error),
    });
    throw error;
  }
}

async function runLoggedOptionalTextStep(
  logs: StepLog[],
  name: string,
  requestId: string,
  fn: () => Promise<string>
): Promise<string> {
  const startedAt = Date.now();
  try {
    const value = await fn();
    logs.push({
      name,
      ms: Date.now() - startedAt,
      ok: true,
      meta: { request_id: requestId, chars: value.length },
    });
    return value;
  } catch (error: unknown) {
    logs.push({
      name,
      ms: Date.now() - startedAt,
      ok: false,
      meta: {
        request_id: requestId,
      },
      error: getErrorMessage(error),
    });
    return "";
  }
}

export async function runPipeline(input: unknown, options?: { requestId?: string }) {
  const requestId = options?.requestId ?? createRequestId();

  return withModelTelemetryContext(requestId, async () => {
    const parsed = IncidentInputSchema.parse(input);
    const logs: StepLog[] = [];

    const logText = parsed.pastedText?.trim() ?? "";
    let rawText = logText;
    let ocrText = "";
    let transcript = "";

    if (parsed.screenshotBase64) {
      const screenshotBase64 = parsed.screenshotBase64;
      const ocrResult = await runLoggedStep(
        logs,
        "ocr",
        () => stepOCR(screenshotBase64),
        requestId,
        (value: OcrStepResult) => ({
          chars: value.text.length,
          ocr_text_len: value.text.length,
          ocr_preview: value.text.slice(0, 120),
          ocr_http_status: value.debug.ocr_http_status,
          ocr_model: value.debug.ocr_model,
          ocr_raw_preview: value.debug.ocr_raw_preview,
          ...(value.debug.ocr_error ? { ocr_error: value.debug.ocr_error } : {}),
        })
      );

      ocrText = ocrResult.text;
      rawText += `${rawText ? "\n\n" : ""}[OCR]\n${ocrText}`;

      const last = logs[logs.length - 1];
      if (last?.name === "ocr") {
        last.meta = {
          ...(last.meta ?? {}),
          raw_text_len_after_ocr: rawText.length,
        };
        if (ocrResult.debug.ocr_error) {
          last.ok = false;
          last.error = ocrResult.debug.ocr_error;
        }
      }
    }

    if (parsed.audioBase64) {
      const audioBase64 = parsed.audioBase64;
      transcript = await runLoggedOptionalTextStep(logs, "asr", requestId, () => stepASR(audioBase64));
      rawText += (rawText ? "\n\n" : "") + transcript;
    }

    const classification = await runLoggedStep(
      logs,
      "classify",
      () => stepClassify(rawText, parsed.title),
      requestId
    );

    const entities = await runLoggedStep(
      logs,
      "extract",
      () => stepExtract(rawText),
      requestId,
      (value) => ({ cves: value.cves.length })
    );

    const enrichment = await runLoggedStep(
      logs,
      "enrich",
      () => stepEnrich({ entities, githubRepo: parsed.githubRepo }),
      requestId
    );

    const generated = await runLoggedStep(
      logs,
      "generate",
      () => stepGenerate({ rawText, classification, entities, enrichment }),
      requestId
    );

    const embedding = await runLoggedStep(
      logs,
      "embed",
      () => stepEmbed({ rawText, classification, entities, generated }),
      requestId
    );

    const modelCalls = getRecordedModelCalls();
    logs.push({
      name: "telemetry",
      ms: 0,
      ok: true,
      meta: {
        request_id: requestId,
        model_calls: modelCalls,
        model_call_count: modelCalls.length,
      },
    });

    const result = PipelineResultSchema.parse({
      raw_text: rawText,
      classification,
      entities,
      enrichment,
      generated,
    });

    return {
      request_id: requestId,
      result,
      embedding,
      logs,
      telemetry: {
        request_id: requestId,
        model_calls: modelCalls,
      },
      artifacts: {
        logText,
        ocrText,
        transcript,
      },
    };
  });
}
