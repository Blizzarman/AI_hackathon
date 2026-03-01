import { AsyncLocalStorage } from "async_hooks";

export type ModelCallTelemetry = {
  request_id: string;
  provider: "huggingface";
  kind: "text_generate" | "embedding";
  route?: "chat" | "text-generation" | "primary" | "fallback";
  model: string;
  latency_ms: number;
  input_chars: number;
  output_chars: number;
  ok: boolean;
  error?: string;
  at: string;
};

type ModelTelemetryContext = {
  requestId: string;
  modelCalls: ModelCallTelemetry[];
};

const telemetryStorage = new AsyncLocalStorage<ModelTelemetryContext>();

export async function withModelTelemetryContext<T>(requestId: string, fn: () => Promise<T>): Promise<T> {
  return telemetryStorage.run({ requestId, modelCalls: [] }, fn);
}

export function currentModelTelemetryRequestId(): string | null {
  return telemetryStorage.getStore()?.requestId ?? null;
}

export function recordModelCall(
  entry: Omit<ModelCallTelemetry, "request_id" | "at"> & { at?: string }
): void {
  const ctx = telemetryStorage.getStore();
  if (!ctx) {
    return;
  }
  ctx.modelCalls.push({
    ...entry,
    request_id: ctx.requestId,
    at: entry.at ?? new Date().toISOString(),
  });
}

export function getRecordedModelCalls(): ModelCallTelemetry[] {
  const ctx = telemetryStorage.getStore();
  if (!ctx) {
    return [];
  }
  return [...ctx.modelCalls];
}
