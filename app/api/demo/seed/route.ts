import { NextResponse } from "next/server";
import { createRequestId } from "@/lib/api/request-id";
import { errorResponse } from "@/lib/api/error";
import {
  clearDemoIncidents,
  insertArtifact,
  insertIncident,
  insertRun,
  type PipelineStepLog,
} from "@/lib/db";
import { DEMO_INCIDENTS } from "@/lib/demo/incidents";
import { validateHackathonModelPolicy } from "@/lib/hackathon/model-validation";
import { buildCreationTimelineEvents, insertTimelineEvents } from "@/lib/incidents/timeline";
import { stepEmbed } from "@/lib/pipeline/steps/embed";

export async function POST() {
  const requestId = createRequestId();
  try {
    validateHackathonModelPolicy();
    const cleared = await clearDemoIncidents();
    let seeded = 0;

    for (const seed of DEMO_INCIDENTS) {
      const seedClassification = {
        ...seed.classification,
        rationale: {
          signals: [
            `Seed severity: "${seed.classification.severity}"`,
            `Seed category: "${seed.classification.category}"`,
            ...(seed.entities.error_codes[0]
              ? [`Seed error/code: "${seed.entities.error_codes[0]}"`]
              : []),
            ...(seed.entities.regions[0]
              ? [`Seed region: "${seed.entities.regions[0]}"`]
              : []),
            ...(seed.entities.cves[0] ? [`Seed CVE: "${seed.entities.cves[0]}"`] : []),
          ].slice(0, 6),
          reasoning: "Demo seed rationale derived from curated scenario metadata.",
          missing_info: [],
          confidence: "medium" as const,
        },
      };

      const seedEntities = {
        ...seed.entities,
        security_signal:
          seed.classification.category === "SECURITY" || seed.entities.cves.length > 0,
      };

      const seedEnrichment = {
        ...seed.enrichment,
        ai_rationale: seedClassification.rationale,
      };

      const startedAt = Date.now();
      const embedding = await stepEmbed({
        rawText: seed.raw_text,
        classification: {
          title: seedClassification.title,
          severity: seedClassification.severity,
          category: seedClassification.category,
        },
        entities: seedEntities,
        generated: {
          summary_md: seed.generated.summary_md,
        },
      });

      const incidentId = await insertIncident({
        title: seedClassification.title,
        severity: seedClassification.severity,
        category: seedClassification.category,
        routing_team: seedClassification.routing_team,
        customer_impact: seedClassification.customer_impact,
        summary_md: seed.generated.summary_md,
        next_actions_md: seed.generated.next_actions_md,
        comms_internal: seed.generated.comms_internal,
        comms_external: seed.generated.comms_external,
        entities_json: seedEntities,
        enrichment_json: seedEnrichment,
        raw_text: seed.raw_text,
        embedding,
      });

      await insertArtifact(incidentId, "log", "text/plain", seed.raw_text);

      const steps: PipelineStepLog[] = [
        {
          name: "demo_seed",
          ms: Date.now() - startedAt,
          ok: true,
          meta: { demo: true, scenario: seed.enrichment.scenario ?? "unknown" },
        },
      ];
      await insertRun(incidentId, steps);
      const timelineEvents = buildCreationTimelineEvents({
        classification: seedClassification,
        entities: seedEntities,
        enrichment: seedEnrichment,
        logs: steps,
        rawTextLength: seed.raw_text.length,
        artifactKinds: ["log"],
      });
      await insertTimelineEvents(incidentId, timelineEvents);
      seeded += 1;
    }

    return NextResponse.json({ seeded, cleared });
  } catch (error: unknown) {
    return errorResponse(error, 500, "demo_seed_incidents", requestId);
  }
}

export async function DELETE() {
  const requestId = createRequestId();
  try {
    const cleared = await clearDemoIncidents();
    return NextResponse.json({ cleared });
  } catch (error: unknown) {
    return errorResponse(error, 500, "demo_clear_incidents", requestId);
  }
}
