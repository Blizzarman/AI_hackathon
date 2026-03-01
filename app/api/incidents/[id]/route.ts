import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/error";
import { createRequestId } from "@/lib/api/request-id";
import { deleteIncidentById, getArtifacts, getIncident } from "@/lib/db";

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
        { error: "Not found", step: "get_incident", request_id: requestId },
        { status: 404 }
      );
    }
    const artifacts = await getArtifacts(id);
    return NextResponse.json({ incident, artifacts });
  } catch (error: unknown) {
    return errorResponse(error, 500, "get_incident", requestId);
  }
}

export async function DELETE(_: Request, context: RouteContext) {
  const requestId = createRequestId();
  try {
    const { id } = await context.params;
    const deleted = await deleteIncidentById(id);
    if (!deleted) {
      return NextResponse.json(
        { error: "Not found", step: "delete_incident", request_id: requestId },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return errorResponse(error, 500, "delete_incident", requestId);
  }
}
