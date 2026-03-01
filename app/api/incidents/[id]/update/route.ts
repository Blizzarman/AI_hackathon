import { NextResponse } from "next/server";
import { z } from "zod";
import { safeModelJson } from "@/lib/ai/safe-model-json";
import {
  getArtifacts,
  getIncident,
  insertTimelineEvent,
  listTimelineEvents,
  updateIncidentComms,
} from "@/lib/db";
import { hfTextGenerate } from "@/lib/hf/client";

type UpdateTarget = "internal" | "external";

type IncidentForUpdate = {
  id: string;
  title: string | null;
  severity: string | null;
  category: string | null;
  routing_team: string | null;
  customer_impact: boolean | null;
  summary_md: string | null;
  next_actions_md: string | null;
  comms_internal: string | null;
  comms_external: string | null;
  enrichment_json: unknown;
};

type RouteContext = {
  params: Promise<{ id: string }>;
};

const UpdateRequestSchema = z.object({
  target: z.enum(["internal", "external"]),
  note: z.string().max(4000).optional(),
});

const UpdateDraftSchema = z.object({
  update: z.string().min(20),
  changed: z.array(z.string()).default([]),
  unknowns: z.array(z.string()).default([]),
  next_actions: z.array(z.string()).default([]),
});

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown error";
}

function jsonError(status: number, error: string, step?: string) {
  return NextResponse.json(
    {
      error,
      ...(step ? { step } : {}),
    },
    { status }
  );
}

function requireEnv(value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new Error("Missing required model environment configuration.");
  }
  return value.trim();
}

function truncate(value: string, max = 1200): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}...`;
}

function timelineSummary(
  events: Array<{
    type: string;
    message: string;
  }>
): string {
  if (events.length === 0) {
    return "No timeline events yet.";
  }
  return events
    .slice(0, 10)
    .map((event) => `- [${event.type}] ${event.message}`)
    .join("\n");
}

function artifactsSummary(
  artifacts: Array<{
    kind: string;
    content: string;
  }>
): string {
  if (artifacts.length === 0) {
    return "No artifacts attached.";
  }
  return artifacts
    .slice(0, 8)
    .map((item) => `- ${item.kind}: ${truncate(item.content, 220)}`)
    .join("\n");
}

function fallbackUpdate(target: UpdateTarget, note: string): string {
  const heading = target === "internal" ? "Internal update" : "External update";
  const unknownLine =
    "Unknowns: We are still validating scope, timeline, and root-cause signals from logs and enrichment data.";
  const noteLine = note ? `Operator note: ${note}` : "Operator note: none.";

  if (target === "external") {
    return `${heading}\n\nWe are actively investigating this incident and applying mitigation steps. ${unknownLine}\n\n${noteLine}\n\nNext actions:\n- Continue investigation and mitigation\n- Provide the next update as soon as new facts are confirmed`;
  }

  return `${heading}\n\nInvestigation is active. Current known signals are being validated against timeline events and artifacts.\n\n${unknownLine}\n\n${noteLine}\n\nNext actions:\n- Confirm impact scope\n- Track changes since the last update\n- Share next checkpoint with stakeholders`;
}

async function generateIncidentUpdate(params: {
  target: UpdateTarget;
  note?: string;
  incident: IncidentForUpdate;
  artifacts: Array<{ kind: string; content: string }>;
  timeline: Array<{ type: string; message: string }>;
}) {
  const note = params.note?.trim() ?? "";

  try {
    const model = requireEnv(process.env.HF_TEXT_MODEL);
    const token = requireEnv(process.env.HF_TOKEN);

    const targetInstructions =
      params.target === "external"
        ? [
            "Audience: external customers.",
            "Use cautious, trust-preserving language.",
            "Do NOT blame vendors, third parties, or individuals.",
            "Do not speculate; clearly separate known vs unknown.",
          ].join("\n")
        : [
            "Audience: internal stakeholders.",
            "Be concise and operationally specific.",
            "Include what changed since the last update and what still needs investigation.",
          ].join("\n");

    const prompt = `
You are drafting an incident status update.
Return ONLY valid JSON:
{
  "update": "string",
  "changed": ["string"],
  "unknowns": ["string"],
  "next_actions": ["string"]
}

${targetInstructions}

Incident:
- id: ${params.incident.id}
- title: ${params.incident.title ?? "Untitled incident"}
- severity: ${params.incident.severity ?? "unknown"}
- category: ${params.incident.category ?? "unknown"}
- routing_team: ${params.incident.routing_team ?? "unknown"}
- customer_impact: ${params.incident.customer_impact === true ? "yes" : "no/unknown"}
- summary: ${truncate(params.incident.summary_md ?? "", 1800)}
- previous_internal_update: ${truncate(params.incident.comms_internal ?? "", 1200)}
- previous_external_update: ${truncate(params.incident.comms_external ?? "", 1200)}

Recent timeline (newest first):
${timelineSummary(params.timeline)}

Artifacts:
${artifactsSummary(params.artifacts)}

Enrichment JSON:
${truncate(JSON.stringify(params.incident.enrichment_json ?? {}), 6000)}

Optional operator note:
${note || "(none)"}

Requirements:
- Mention what is known.
- If information is incomplete, explicitly list what remains unknown and being investigated.
- Include concrete next actions.
- Keep response factual and concise.
`;

    const raw = await hfTextGenerate(model, token, prompt);
    const draft = await safeModelJson(raw, {
      retry: (repairPrompt) => hfTextGenerate(model, token, repairPrompt),
      parse: (value) => UpdateDraftSchema.parse(value),
    });

    const content = [
      draft.update.trim(),
      draft.changed.length ? `What changed:\n- ${draft.changed.join("\n- ")}` : "",
      draft.unknowns.length ? `Unknown / investigating:\n- ${draft.unknowns.join("\n- ")}` : "",
      draft.next_actions.length ? `Next actions:\n- ${draft.next_actions.join("\n- ")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    return {
      content,
      meta: {
        changed: draft.changed,
        unknowns: draft.unknowns,
        next_actions: draft.next_actions,
        note: note || null,
      },
    };
  } catch {
    return {
      content: fallbackUpdate(params.target, note),
      meta: {
        changed: [],
        unknowns: ["Scope and root cause still under investigation."],
        next_actions: ["Continue mitigation and publish next update with verified facts."],
        note: note || null,
        fallback: true,
      },
    };
  }
}

export async function POST(req: Request, context: RouteContext) {
  const { id } = await context.params;
  console.info("[api/incidents/[id]/update] hit", {
    incident_id: id,
    method: req.method,
    at: new Date().toISOString(),
  });

  let bodyRaw: unknown;
  try {
    bodyRaw = await req.json();
  } catch {
    return jsonError(400, "Invalid JSON body.", "parse_request_body");
  }

  const bodyParse = UpdateRequestSchema.safeParse(bodyRaw);
  if (!bodyParse.success) {
    return jsonError(400, "Invalid request payload.", "parse_request_payload");
  }
  const body = bodyParse.data;

  try {
    const incident = await getIncident(id);
    if (!incident) {
      return jsonError(404, "Not found", "load_incident");
    }

    const [artifacts, timeline] = await Promise.all([getArtifacts(id), listTimelineEvents(id, 40)]);

    const generated = await generateIncidentUpdate({
      target: body.target,
      note: body.note,
      incident,
      artifacts,
      timeline,
    });

    await updateIncidentComms(id, body.target, generated.content);
    await insertTimelineEvent({
      incidentId: id,
      type: body.target === "internal" ? "UPDATE_INTERNAL" : "UPDATE_EXTERNAL",
      message:
        body.target === "internal"
          ? "Generated internal stakeholder update."
          : "Generated external customer update.",
      meta: generated.meta,
    });

    return NextResponse.json({
      ok: true,
      type: body.target,
      content: generated.content,
    });
  } catch (error: unknown) {
    console.error("[api/incidents/[id]/update] error", {
      incident_id: id,
      error: getErrorMessage(error),
      at: new Date().toISOString(),
    });
    return jsonError(500, getErrorMessage(error), "generate_incident_update");
  }
}
