import type { ArtifactItem, PipelineRunStepRow, TimelineEventItem } from "@/lib/db";

export type IncidentReportIncident = {
  id: string;
  created_at: string | Date;
  title: string | null;
  severity: string | null;
  category: string | null;
  routing_team: string | null;
  customer_impact: boolean | null;
  summary_md: string | null;
  next_actions_md: string | null;
  comms_internal: string | null;
  comms_external: string | null;
  entities_json: unknown;
  enrichment_json: unknown;
};

export type ArtifactExcerpt = {
  id: string;
  kind: string;
  mime: string | null;
  created_at: string;
  chars_total: number;
  excerpt: string;
};

function toIsoDate(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(value).toISOString();
}

function textOrFallback(value: string | null | undefined): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : "(none)";
}

export function toExcerpt(content: string, maxChars = 700): string {
  const normalized = content.trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars)}...`;
}

export function buildArtifactExcerpts(artifacts: ArtifactItem[], maxChars = 700): ArtifactExcerpt[] {
  return artifacts.map((item) => ({
    id: item.id,
    kind: item.kind,
    mime: item.mime,
    created_at: toIsoDate(item.created_at),
    chars_total: item.content.length,
    excerpt: toExcerpt(item.content, maxChars),
  }));
}

function artifactCounts(artifacts: ArtifactItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of artifacts) {
    const key = item.kind.trim().toLowerCase() || "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function timelineSection(events: TimelineEventItem[]): string {
  if (events.length === 0) {
    return "No timeline events.";
  }
  return events
    .map((event) => `- ${toIsoDate(event.created_at)} | ${event.type} | ${event.message}`)
    .join("\n");
}

function pipelineSection(steps: PipelineRunStepRow[]): string {
  if (steps.length === 0) {
    return "No pipeline logs.";
  }
  return steps
    .map(
      (step) =>
        `- ${toIsoDate(step.run_created_at)} | ${step.name} | ${Math.round(step.ms)} ms | ok=${step.ok ? "true" : "false"}`
    )
    .join("\n");
}

function artifactsSection(excerpts: ArtifactExcerpt[], artifacts: ArtifactItem[]): string {
  const counts = artifactCounts(artifacts);
  const countLines = Object.keys(counts)
    .sort()
    .map((key) => `- ${key}: ${counts[key]}`)
    .join("\n");

  const excerptLines =
    excerpts.length === 0
      ? "No artifacts."
      : excerpts
          .map((entry) =>
            [
              `- ${entry.kind.toUpperCase()} (${entry.mime ?? "unknown mime"})`,
              `  created_at: ${entry.created_at}`,
              `  chars_total: ${entry.chars_total}`,
              "  excerpt:",
              `  ${entry.excerpt.replace(/\n/g, "\n  ")}`,
            ].join("\n")
          )
          .join("\n\n");

  return [`Counts:`, countLines || "- none", "", "Excerpts:", excerptLines].join("\n");
}

export function buildIncidentMarkdownReport(input: {
  incident: IncidentReportIncident;
  artifacts: ArtifactItem[];
  timeline: TimelineEventItem[];
  pipelineRuns: PipelineRunStepRow[];
}) {
  const incident = input.incident;
  const artifacts = input.artifacts;
  const excerpts = buildArtifactExcerpts(artifacts, 700);

  return [
    `# Incident: ${incident.title ?? "Untitled incident"}`,
    "",
    `- ID: ${incident.id}`,
    `- Created at: ${toIsoDate(incident.created_at)}`,
    `- Severity: ${incident.severity ?? "unknown"}`,
    `- Category: ${incident.category ?? "unknown"}`,
    `- Routing team: ${incident.routing_team ?? "unknown"}`,
    `- Customer impact: ${incident.customer_impact === true ? "Yes" : "No/Unknown"}`,
    "",
    "## Summary",
    "",
    textOrFallback(incident.summary_md),
    "",
    "## Timeline",
    "",
    timelineSection(input.timeline),
    "",
    "## Next actions",
    "",
    textOrFallback(incident.next_actions_md),
    "",
    "## Internal update",
    "",
    textOrFallback(incident.comms_internal),
    "",
    "## External update",
    "",
    textOrFallback(incident.comms_external),
    "",
    "## Entities",
    "",
    "```json",
    JSON.stringify(incident.entities_json ?? {}, null, 2),
    "```",
    "",
    "## Enrichment / Evidence",
    "",
    "```json",
    JSON.stringify(incident.enrichment_json ?? {}, null, 2),
    "```",
    "",
    "## Artifacts (OCR / Transcript / Logs)",
    "",
    artifactsSection(excerpts, artifacts),
    "",
    "## Pipeline logs",
    "",
    pipelineSection(input.pipelineRuns),
    "",
  ].join("\n");
}
