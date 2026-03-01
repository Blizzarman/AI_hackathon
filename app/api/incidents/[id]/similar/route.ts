import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api/error";
import { createRequestId } from "@/lib/api/request-id";
import { getIncident, similarIncidents } from "@/lib/db";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function parseStoredVector(value: unknown): number[] {
  if (typeof value !== "string") {
    return [];
  }
  return value
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry));
}

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

    const embedding = parseStoredVector(incident.embedding);
    if (embedding.length === 0) {
      return NextResponse.json({ items: [] });
    }

    const items = await similarIncidents(embedding, 5);
    return NextResponse.json({ items });
  } catch (error: unknown) {
    return errorResponse(error, 500, "find_similar_incidents", requestId);
  }
}
