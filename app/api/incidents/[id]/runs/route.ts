import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/error";
import { createRequestId } from "@/lib/api/request-id";
import { getIncident, listPipelineRunSteps } from "@/lib/db";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, context: RouteContext) {
  const requestId = createRequestId();
  try {
    const { id } = await context.params;
    const incident = await getIncident(id);
    if (!incident) {
      return NextResponse.json(
        { error: "Not found", step: "load_incident", request_id: requestId },
        { status: 404 }
      );
    }

    const items = await listPipelineRunSteps(id, 20);
    return NextResponse.json({ items });
  } catch (error: unknown) {
    return errorResponse(error, 500, "list_pipeline_runs", requestId);
  }
}
