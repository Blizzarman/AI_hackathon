import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/error";
import {
  getArtifacts,
  getIncident,
  listPipelineRunSteps,
  listTimelineEvents,
  type PipelineRunStepRow,
  type TimelineEventItem,
} from "@/lib/db";
import { buildIncidentMarkdownReport } from "@/lib/incidents/report";

type RouteContext = {
  params: Promise<{ id: string }>;
};

async function safeTimeline(incidentId: string): Promise<TimelineEventItem[]> {
  try {
    return await listTimelineEvents(incidentId, 500);
  } catch {
    return [];
  }
}

async function safePipelineRuns(incidentId: string): Promise<PipelineRunStepRow[]> {
  try {
    return await listPipelineRunSteps(incidentId, 50);
  } catch {
    return [];
  }
}

export async function GET(_: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const incident = await getIncident(id);
    if (!incident) {
      return NextResponse.json({ error: "Not found", step: "load_incident" }, { status: 404 });
    }

    const [artifacts, timeline, pipelineRuns] = await Promise.all([
      getArtifacts(id),
      safeTimeline(id),
      safePipelineRuns(id),
    ]);

    const content = buildIncidentMarkdownReport({
      incident,
      artifacts,
      timeline,
      pipelineRuns,
    });

    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="incident-${id}.md"`,
      },
    });
  } catch (error: unknown) {
    return errorResponse(error, 500, "export_incident_markdown");
  }
}
