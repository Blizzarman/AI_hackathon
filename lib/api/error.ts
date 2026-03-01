import { NextResponse } from "next/server";
import { currentModelTelemetryRequestId } from "@/lib/telemetry/model-calls";

export type ApiErrorPayload = {
  error: string;
  step?: string;
  request_id?: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}

function getErrorRequestId(error: unknown): string | null {
  if (error && typeof error === "object") {
    const maybe = error as Record<string, unknown>;
    if (typeof maybe.request_id === "string" && maybe.request_id.trim()) {
      return maybe.request_id.trim();
    }
  }
  return null;
}

export function errorResponse(error: unknown, status = 500, step?: string, requestId?: string) {
  const payload: ApiErrorPayload = {
    error: getErrorMessage(error),
  };
  if (step) {
    payload.step = step;
  }
  const resolvedRequestId =
    requestId?.trim() || getErrorRequestId(error) || currentModelTelemetryRequestId() || undefined;
  if (resolvedRequestId) {
    payload.request_id = resolvedRequestId;
  }
  return NextResponse.json(payload, { status });
}
