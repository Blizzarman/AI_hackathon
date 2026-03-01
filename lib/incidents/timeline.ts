import {
  insertTimelineEvent,
  type TimelineEventItem,
  type TimelineEventType,
} from "@/lib/db";
import type { Classification, Entities } from "@/lib/schema";
import type { StepLog } from "@/lib/pipeline/run";

type CreationTimelineInput = {
  classification: Classification;
  entities: Entities;
  enrichment: Record<string, unknown>;
  logs: StepLog[];
  rawTextLength: number;
  artifactKinds: string[];
};

export type TimelineInsertSeed = {
  type: TimelineEventType;
  message: string;
  meta?: Record<string, unknown>;
};

function countObjectKeys(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return 0;
  }
  return Object.keys(value as Record<string, unknown>).length;
}

function summarizeEntities(entities: Entities): string {
  const systems = entities.systems.length;
  const regions = entities.regions.length;
  const errorCodes = entities.error_codes.length;
  const cves = entities.cves.length ? entities.cves.join(", ") : "none";
  const issueRefs = entities.issue_refs.length ? entities.issue_refs.join(", ") : "none";
  return `Entities extracted: ${systems} systems, ${regions} regions, ${errorCodes} error codes, CVEs: ${cves}, issue refs: ${issueRefs}.`;
}

function enrichmentMessage(enrichment: Record<string, unknown>, logs: StepLog[]): string {
  const cveLookups = countObjectKeys(enrichment.cves);
  const githubLookups = countObjectKeys(enrichment.github);
  const ranEnrichStep = logs.some((log) => log.name === "enrich" && log.ok);

  if (!ranEnrichStep) {
    return "Enrichment skipped or failed before external lookups completed.";
  }

  if (cveLookups === 0 && githubLookups === 0) {
    return "Enrichment completed with no CVE or GitHub references detected.";
  }

  return `Enrichment completed: CVE lookups=${cveLookups}, GitHub issue lookups=${githubLookups}.`;
}

export function buildCreationTimelineEvents(input: CreationTimelineInput): TimelineInsertSeed[] {
  const triageMessage = `Triage completed: ${input.classification.severity} ${input.classification.category}; routed to ${input.classification.routing_team}; customer impact=${input.classification.customer_impact ? "yes" : "no"}.`;

  return [
    {
      type: "INGEST",
      message: "Incident created.",
      meta: {
        raw_text_chars: input.rawTextLength,
        artifact_kinds: input.artifactKinds,
      },
    },
    {
      type: "TRIAGE",
      message: triageMessage,
      meta: {
        severity: input.classification.severity,
        category: input.classification.category,
        routing_team: input.classification.routing_team,
        customer_impact: input.classification.customer_impact,
        title: input.classification.title,
      },
    },
    {
      type: "ENRICH",
      message: enrichmentMessage(input.enrichment, input.logs),
      meta: {
        enrichment_keys: Object.keys(input.enrichment),
        cve_lookups: countObjectKeys(input.enrichment.cves),
        github_lookups: countObjectKeys(input.enrichment.github),
      },
    },
    {
      type: "NOTE",
      message: summarizeEntities(input.entities),
      meta: {
        entities: input.entities,
      },
    },
  ];
}

export async function insertTimelineEvents(
  incidentId: string,
  events: TimelineInsertSeed[]
): Promise<Array<TimelineEventItem["id"] | null>> {
  const out: Array<TimelineEventItem["id"] | null> = [];
  for (const event of events) {
    const id = await insertTimelineEvent({
      incidentId,
      type: event.type,
      message: event.message,
      meta: event.meta,
    });
    out.push(id);
  }
  return out;
}
