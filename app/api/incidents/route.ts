import { NextResponse } from "next/server";
import { createRequestId } from "@/lib/api/request-id";
import { errorResponse } from "@/lib/api/error";
import { insertArtifact, insertIncident, insertRun, listIncidents } from "@/lib/db";
import { buildCreationTimelineEvents, insertTimelineEvents } from "@/lib/incidents/timeline";
import { runPipeline } from "@/lib/pipeline/run";
import { IncidentInputSchema } from "@/lib/schema";

function getDataUrlMime(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const match = /^data:([^;]+);base64,/i.exec(value.trim());
  if (!match) {
    return null;
  }
  return match[1].trim().toLowerCase() || null;
}

export async function GET() {
  const requestId = createRequestId();
  try {
    const items = await listIncidents(50);
    return NextResponse.json({ items });
  } catch (error: unknown) {
    return errorResponse(error, 500, "list_incidents", requestId);
  }
}

export async function POST(req: Request) {
  const requestId = createRequestId();
  try {
    const body = IncidentInputSchema.parse(await req.json());
    const { result, embedding, logs, artifacts, telemetry, request_id } = await runPipeline(body, {
      requestId,
    });

    const enrichmentWithTelemetry = {
      ...(result.enrichment ?? {}),
      ai_rationale: result.classification.rationale,
      telemetry: {
        request_id,
        model_calls: telemetry.model_calls,
      },
    };

    const id = await insertIncident({
      title: result.classification.title,
      severity: result.classification.severity,
      category: result.classification.category,
      routing_team: result.classification.routing_team,
      customer_impact: result.classification.customer_impact,
      summary_md: result.generated.summary_md,
      next_actions_md: result.generated.next_actions_md,
      comms_internal: result.generated.comms_internal,
      comms_external: result.generated.comms_external,
      entities_json: result.entities,
      enrichment_json: enrichmentWithTelemetry,
      raw_text: result.raw_text,
      embedding,
    });

    await insertRun(id, logs);
    const artifactKinds = [
      ...(artifacts.logText.trim() ? ["log"] : []),
      ...(body.screenshotBase64 && artifacts.ocrText.trim() ? ["ocr"] : []),
      ...(body.audioBase64 && artifacts.transcript.trim() ? ["transcript"] : []),
    ];
    const artifactWrites: Array<Promise<string | null>> = [];
    if (artifacts.logText.trim()) {
      artifactWrites.push(insertArtifact(id, "log", "text/plain", artifacts.logText));
    }
    if (body.screenshotBase64 && artifacts.ocrText.trim()) {
      artifactWrites.push(
        insertArtifact(id, "ocr", getDataUrlMime(body.screenshotBase64), artifacts.ocrText)
      );
    }
    if (body.audioBase64 && artifacts.transcript.trim()) {
      artifactWrites.push(
        insertArtifact(id, "transcript", getDataUrlMime(body.audioBase64), artifacts.transcript)
      );
    }
    if (artifactWrites.length > 0) {
      await Promise.all(artifactWrites);
    }

    const timelineEvents = buildCreationTimelineEvents({
      classification: result.classification,
      entities: result.entities,
      enrichment: result.enrichment,
      logs,
      rawTextLength: result.raw_text.length,
      artifactKinds,
    });
    await insertTimelineEvents(id, timelineEvents);

    return NextResponse.json({ id, request_id }, { status: 201 });
  } catch (error: unknown) {
    return errorResponse(error, 500, "create_incident", requestId);
  }
}
