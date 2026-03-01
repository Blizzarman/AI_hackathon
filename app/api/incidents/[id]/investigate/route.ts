import { NextResponse } from "next/server";
import { z } from "zod";
import { createRequestId } from "@/lib/api/request-id";
import {
  appendIncidentInvestigation,
  getArtifacts,
  getIncident,
  insertTimelineEvent,
  listTimelineEvents,
} from "@/lib/db";
import { runInvestigationCopilot } from "@/lib/incidents/investigation";

const InvestigateBodySchema = z.object({
  note: z.string().max(4000).optional(),
});

type RouteContext = {
  params: Promise<{ id: string }>;
};

function sanitizeStringForJsonb(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);

    // Remove NUL char, invalid in PostgreSQL text/jsonb.
    if (code === 0x0000) {
      continue;
    }

    // Keep only valid surrogate pairs.
    if (code >= 0xd800 && code <= 0xdbff) {
      const nextCode = i + 1 < value.length ? value.charCodeAt(i + 1) : -1;
      if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
        out += value[i] + value[i + 1];
        i += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      continue;
    }

    out += value[i];
  }
  return out;
}

function sanitizeForJsonb(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeStringForJsonb(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForJsonb(item));
  }
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input)) {
      out[sanitizeStringForJsonb(k)] = sanitizeForJsonb(v);
    }
    return out;
  }
  return value;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}

function jsonError(status: number, error: string, step?: string, requestId?: string) {
  return NextResponse.json(
    {
      error,
      ...(step ? { step } : {}),
      ...(requestId ? { request_id: requestId } : {}),
    },
    { status }
  );
}

export async function POST(req: Request, context: RouteContext) {
  const requestId = createRequestId();
  const { id } = await context.params;
  console.info("[api/incidents/[id]/investigate] hit", {
    incident_id: id,
    request_id: requestId,
    method: req.method,
    at: new Date().toISOString(),
  });

  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON body.", "parse_request_body", requestId);
  }

  const bodyParse = InvestigateBodySchema.safeParse(bodyRaw);
  if (!bodyParse.success) {
    return jsonError(400, "Invalid request payload.", "parse_request_payload", requestId);
  }
  const body = bodyParse.data;

  try {
    const incident = await getIncident(id);
    if (!incident) {
      return jsonError(404, "Not found", "load_incident", requestId);
    }

    const [artifacts, timeline] = await Promise.all([getArtifacts(id), listTimelineEvents(id, 80)]);

    const investigation = await runInvestigationCopilot({
      incident,
      artifacts,
      timeline,
      note: body.note,
    });

    const safeInvestigation = sanitizeForJsonb(investigation) as typeof investigation;
    const investigationEntry = {
      at: new Date().toISOString(),
      note: body.note?.trim() || null,
      hypotheses: safeInvestigation.hypotheses,
      plan_md: safeInvestigation.plan_md,
      tool_results: safeInvestigation.tool_results,
      updated_next_actions_md: safeInvestigation.updated_next_actions_md,
      meta: safeInvestigation.meta,
    };

    await appendIncidentInvestigation({
      incidentId: id,
      updatedNextActionsMd: safeInvestigation.updated_next_actions_md,
      investigationEntry,
    });

    const okCount = safeInvestigation.tool_results.filter((item) => item.ok).length;
    const failCount = safeInvestigation.tool_results.length - okCount;
    await insertTimelineEvent({
      incidentId: id,
      type: "ENRICH",
      message: `Investigation Copilot executed ${safeInvestigation.tool_results.length} checks (${okCount} ok, ${failCount} failed).`,
      meta: {
        note: body.note?.trim() || null,
        tool_results_count: safeInvestigation.tool_results.length,
        ok_count: okCount,
        fail_count: failCount,
      },
    });

    return NextResponse.json({
      hypotheses: safeInvestigation.hypotheses,
      plan_md: safeInvestigation.plan_md,
      tool_results: safeInvestigation.tool_results,
      updated_next_actions_md: safeInvestigation.updated_next_actions_md,
    });
  } catch (error: unknown) {
    console.error("[api/incidents/[id]/investigate] error", {
      incident_id: id,
      request_id: requestId,
      error: getErrorMessage(error),
      at: new Date().toISOString(),
    });
    return jsonError(500, getErrorMessage(error), "investigate_incident", requestId);
  }
}
