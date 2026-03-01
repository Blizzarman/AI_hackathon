import { z } from "zod";
import { safeModelJson } from "@/lib/ai/safe-model-json";
import { hfTextGenerate } from "@/lib/hf/client";
import type { ArtifactItem, TimelineEventItem } from "@/lib/db";
import { fetchGithubIssue, searchGithubIssues } from "@/lib/tools/github";
import { fetchCve } from "@/lib/tools/nvd";
import { fetchVendorStatus, supportedStatusVendors } from "@/lib/tools/statuspage";

const CHECK_TOOL_VALUES = ["STATUSPAGE", "GITHUB_ISSUE", "NVD_CVE", "GITHUB_SEARCH"] as const;
type InvestigationTool = (typeof CHECK_TOOL_VALUES)[number];

const InvestigationPlanSchema = z.object({
  hypotheses: z.array(z.string()).default([]),
  checks: z
    .array(
      z.object({
        tool: z.enum(CHECK_TOOL_VALUES),
        args: z.record(z.string(), z.unknown()).default({}),
        why: z.string().default(""),
      })
    )
    .default([]),
  updated_next_actions_md: z.string().default(""),
});

export type InvestigationToolResult = {
  name: string;
  ok: boolean;
  summary: string;
  data?: unknown;
};

type InvestigationCheck = z.infer<typeof InvestigationPlanSchema>["checks"][number];

type IncidentForInvestigation = {
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
  entities_json: unknown;
  enrichment_json: unknown;
  raw_text: string | null;
  created_at: string | Date;
};

type InvestigationPlan = z.infer<typeof InvestigationPlanSchema>;

function truncate(value: string, max = 1200): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}...`;
}

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function uniqueStrings(values: string[], max = 10): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(value.trim());
    if (out.length >= max) {
      break;
    }
  }
  return out;
}

function extractCves(incident: IncidentForInvestigation): string[] {
  const entities = toObject(incident.entities_json);
  const enrichment = toObject(incident.enrichment_json);
  const fromEntities = toStringArray(entities.cves);
  const fromEnrichment = Object.keys(toObject(toObject(enrichment).cves));
  const fromRaw = Array.from(new Set((incident.raw_text ?? "").match(/\bCVE-\d{4}-\d{4,}\b/gi) ?? []));
  return uniqueStrings(
    [...fromEntities, ...fromEnrichment, ...fromRaw].map((value) => value.toUpperCase()),
    3
  );
}

function extractIssueRefs(incident: IncidentForInvestigation): string[] {
  const entities = toObject(incident.entities_json);
  const fromEntities = toStringArray(entities.issue_refs);
  const fromRaw = Array.from(
    new Set((incident.raw_text ?? "").match(/\b(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#\d+|#\d+)\b/g) ?? [])
  );
  return uniqueStrings([...fromEntities, ...fromRaw], 5);
}

function parseIssueRef(value: string, fallbackRepo?: string): { repo: string | null; issueNumber: number | null } {
  const scopedMatch = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)$/.exec(value.trim());
  if (scopedMatch) {
    return {
      repo: scopedMatch[1],
      issueNumber: Number(scopedMatch[2]),
    };
  }

  const shortMatch = /^#(\d+)$/.exec(value.trim());
  if (shortMatch && fallbackRepo) {
    return {
      repo: fallbackRepo,
      issueNumber: Number(shortMatch[1]),
    };
  }

  return { repo: null, issueNumber: null };
}

function detectGithubRepo(incident: IncidentForInvestigation, issueRefs: string[]): string | null {
  for (const ref of issueRefs) {
    const parsed = parseIssueRef(ref);
    if (parsed.repo) {
      return parsed.repo;
    }
  }

  const enrichment = toObject(incident.enrichment_json);
  const githubObj = toObject(enrichment.github);
  for (const key of Object.keys(githubObj)) {
    const parsed = parseIssueRef(key);
    if (parsed.repo) {
      return parsed.repo;
    }
  }

  return null;
}

function artifactsSummary(artifacts: ArtifactItem[]): string {
  if (artifacts.length === 0) {
    return "No artifacts attached.";
  }

  return artifacts
    .slice(0, 8)
    .map((artifact) => `- ${artifact.kind}: ${truncate(artifact.content, 260)}`)
    .join("\n");
}

function timelineSummary(timeline: TimelineEventItem[]): string {
  if (timeline.length === 0) {
    return "No timeline events yet.";
  }
  return timeline
    .slice(0, 12)
    .map((event) => `- [${event.type}] ${event.message}`)
    .join("\n");
}

function buildFallbackPlan(params: {
  cves: string[];
  issueRefs: string[];
  githubRepo: string | null;
}): InvestigationPlan {
  const checks: InvestigationCheck[] = [];

  for (const cve of params.cves.slice(0, 3)) {
    checks.push({
      tool: "NVD_CVE",
      args: { cve },
      why: "Validate CVE severity and affected scope.",
    });
  }

  for (const vendor of supportedStatusVendors()) {
    checks.push({
      tool: "STATUSPAGE",
      args: { vendor },
      why: "Check for correlated vendor incidents.",
    });
  }

  if (params.githubRepo) {
    for (const ref of params.issueRefs.slice(0, 3)) {
      const parsed = parseIssueRef(ref, params.githubRepo);
      if (parsed.repo && parsed.issueNumber) {
        checks.push({
          tool: "GITHUB_ISSUE",
          args: { repo: parsed.repo, issue_number: parsed.issueNumber },
          why: "Validate linked engineering issue state.",
        });
      }
    }
  }

  return {
    hypotheses: [
      "A dependency or upstream provider issue is impacting service behavior.",
      "The issue may be localized to a subset of systems, regions, or deployments.",
    ],
    checks,
    updated_next_actions_md: [
      "- [ ] Validate high-confidence signals from timeline, logs, and artifacts",
      "- [ ] Confirm current customer impact scope and affected regions/systems",
      "- [ ] Track external provider status pages for correlated incidents",
      "- [ ] Publish the next update with confirmed knowns/unknowns",
    ].join("\n"),
  };
}

async function buildModelPlan(params: {
  incident: IncidentForInvestigation;
  artifacts: ArtifactItem[];
  timeline: TimelineEventItem[];
  cves: string[];
  issueRefs: string[];
  githubRepo: string | null;
  note: string;
}): Promise<InvestigationPlan | null> {
  const model = process.env.HF_TEXT_MODEL?.trim();
  const token = process.env.HF_TOKEN?.trim();
  if (!model || !token) {
    return null;
  }

  const prompt = `
You are an incident investigation copilot.
Return ONLY valid JSON:
{
  "hypotheses": ["string"],
  "checks": [
    {
      "tool": "STATUSPAGE" | "GITHUB_ISSUE" | "NVD_CVE" | "GITHUB_SEARCH",
      "args": {},
      "why": "string"
    }
  ],
  "updated_next_actions_md": "markdown checklist"
}

Constraints:
- Checks must be safe read-only HTTP lookups only.
- Prefer concrete checks tied to current evidence.
- Keep hypotheses concise and testable.
- Do not include destructive steps.

Incident context:
- id: ${params.incident.id}
- title: ${params.incident.title ?? "Untitled incident"}
- severity: ${params.incident.severity ?? "unknown"}
- category: ${params.incident.category ?? "unknown"}
- routing_team: ${params.incident.routing_team ?? "unknown"}
- customer_impact: ${params.incident.customer_impact === true ? "yes" : "no/unknown"}
- summary: ${truncate(params.incident.summary_md ?? "", 2400)}
- current_next_actions: ${truncate(params.incident.next_actions_md ?? "", 1600)}

Known CVEs: ${params.cves.join(", ") || "none"}
Known issue refs: ${params.issueRefs.join(", ") || "none"}
Known repo: ${params.githubRepo ?? "none"}

Artifacts:
${artifactsSummary(params.artifacts)}

Timeline (newest first):
${timelineSummary(params.timeline)}

Optional operator note:
${params.note || "(none)"}
`;

  const raw = await hfTextGenerate(model, token, prompt);
  return safeModelJson(raw, {
    retry: (repairPrompt) => hfTextGenerate(model, token, repairPrompt),
    parse: (value) => InvestigationPlanSchema.parse(value),
    retryTimeoutMs: 10000,
  });
}

function normalizedTool(value: unknown): InvestigationTool | null {
  if (typeof value !== "string") {
    return null;
  }
  const upper = value.toUpperCase();
  if (CHECK_TOOL_VALUES.includes(upper as InvestigationTool)) {
    return upper as InvestigationTool;
  }
  return null;
}

function sanitizeChecks(rawChecks: InvestigationCheck[]): InvestigationCheck[] {
  const out: InvestigationCheck[] = [];
  for (const check of rawChecks) {
    const tool = normalizedTool(check.tool);
    if (!tool) {
      continue;
    }
    const args = toObject(check.args);
    const why = typeof check.why === "string" ? check.why.trim() : "";
    out.push({ tool, args, why });
    if (out.length >= 12) {
      break;
    }
  }
  return out;
}

function signature(check: InvestigationCheck): string {
  const tool = check.tool;
  const args = JSON.stringify(check.args ?? {});
  return `${tool}:${args}`;
}

function addCheck(checks: InvestigationCheck[], check: InvestigationCheck) {
  const nextSig = signature(check);
  if (!checks.some((item) => signature(item) === nextSig)) {
    checks.push(check);
  }
}

function mergeNextActions(existing: string | null, updated: string, toolResults: InvestigationToolResult[]): string {
  const values: string[] = [];

  const capture = (source: string) => {
    for (const line of source.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const matched = trimmed.match(/^[-*]\s*(?:\[[ xX]\]\s*)?(.*)$/);
      if (matched?.[1]) {
        values.push(matched[1].trim());
      }
    }
  };

  if (existing) {
    capture(existing);
  }
  if (updated) {
    capture(updated);
  }

  if (toolResults.some((item) => !item.ok)) {
    values.push("Re-run failed investigation checks or gather equivalent evidence manually");
  }
  values.push("Publish a follow-up update with verified knowns, unknowns, and owner actions");

  const deduped = uniqueStrings(values, 16);
  return deduped.map((item) => `- [ ] ${item}`).join("\n");
}

function formatPlanMarkdown(checks: InvestigationCheck[]): string {
  if (checks.length === 0) {
    return "- [ ] No additional checks planned.";
  }
  return checks
    .map((check) => {
      const why = check.why?.trim() ? ` - ${check.why.trim()}` : "";
      return `- [ ] ${check.tool}${why}`;
    })
    .join("\n");
}

function summarizeCvePayload(cve: string, payload: unknown): string {
  const root = toObject(payload);
  const vulnerabilities = Array.isArray(root.vulnerabilities) ? root.vulnerabilities : [];
  if (vulnerabilities.length === 0) {
    return `${cve}: no vulnerability records returned.`;
  }
  const first = toObject(vulnerabilities[0]);
  const cveObj = toObject(first.cve);
  const published = typeof cveObj.published === "string" ? cveObj.published : "unknown";
  return `${cve}: record found (published ${published}).`;
}

function summarizeGithubIssue(repo: string, issueNumber: number, payload: unknown): string {
  const data = toObject(payload);
  const title = typeof data.title === "string" ? data.title : "untitled";
  const state = typeof data.state === "string" ? data.state : "unknown";
  return `${repo}#${issueNumber}: ${state} - ${truncate(title, 100)}`;
}

function summarizeGithubSearch(payload: unknown): string {
  const data = toObject(payload);
  const total = typeof data.total_count === "number" ? data.total_count : 0;
  const items = Array.isArray(data.items) ? data.items : [];
  const top = items[0] && typeof items[0] === "object" ? (items[0] as Record<string, unknown>) : null;
  const title = top && typeof top.title === "string" ? top.title : "";
  if (title) {
    return `GitHub search found ${total} results. Top hit: ${truncate(title, 110)}`;
  }
  return `GitHub search found ${total} results.`;
}

async function executeCheck(
  check: InvestigationCheck,
  context: { cves: string[]; issueRefs: string[]; githubRepo: string | null }
): Promise<InvestigationToolResult> {
  const githubToken = process.env.GITHUB_TOKEN?.trim() || undefined;

  try {
    if (check.tool === "NVD_CVE") {
      const argCve = typeof check.args.cve === "string" ? check.args.cve : context.cves[0];
      if (!argCve) {
        throw new Error("No CVE available for NVD lookup.");
      }
      const cve = argCve.toUpperCase();
      const data = await fetchCve(cve, 7000);
      return {
        name: `NVD_CVE:${cve}`,
        ok: true,
        summary: summarizeCvePayload(cve, data),
        data,
      };
    }

    if (check.tool === "GITHUB_ISSUE") {
      const repoFromArgs = typeof check.args.repo === "string" ? check.args.repo.trim() : "";
      const issueFromArgs =
        typeof check.args.issue_number === "number"
          ? check.args.issue_number
          : Number(check.args.issue_number ?? NaN);
      let repo = repoFromArgs || context.githubRepo || "";
      let issueNumber = Number.isFinite(issueFromArgs) ? issueFromArgs : NaN;

      if (!repo || !Number.isFinite(issueNumber)) {
        const ref = typeof check.args.issue_ref === "string" ? check.args.issue_ref : context.issueRefs[0];
        if (ref) {
          const parsed = parseIssueRef(ref, context.githubRepo ?? undefined);
          repo = repo || parsed.repo || "";
          issueNumber = Number.isFinite(issueNumber) ? issueNumber : Number(parsed.issueNumber);
        }
      }

      if (!repo || !Number.isFinite(issueNumber)) {
        throw new Error("Missing repo/issue number for GitHub issue lookup.");
      }

      const issue = await fetchGithubIssue(repo, issueNumber, githubToken, { timeoutMs: 7000 });
      return {
        name: `GITHUB_ISSUE:${repo}#${issueNumber}`,
        ok: true,
        summary: summarizeGithubIssue(repo, issueNumber, issue),
        data: issue,
      };
    }

    if (check.tool === "STATUSPAGE") {
      const vendor = typeof check.args.vendor === "string" ? check.args.vendor : "Cloudflare";
      const data = await fetchVendorStatus(vendor, 7000);
      return {
        name: `STATUSPAGE:${data.vendor}`,
        ok: true,
        summary: `${data.vendor} status: ${data.status} (${data.indicator})`,
        data: {
          vendor: data.vendor,
          status: data.status,
          indicator: data.indicator,
        },
      };
    }

    const queryRaw = typeof check.args.query === "string" ? check.args.query.trim() : "";
    if (!queryRaw) {
      throw new Error("Missing query for GitHub search.");
    }
    const scopedQuery =
      typeof check.args.repo === "string" && check.args.repo.trim()
        ? `${queryRaw} repo:${check.args.repo.trim()}`
        : queryRaw;
    const data = await searchGithubIssues(scopedQuery, githubToken, { timeoutMs: 7000 });
    return {
      name: `GITHUB_SEARCH:${truncate(scopedQuery, 80)}`,
      ok: true,
      summary: summarizeGithubSearch(data),
      data,
    };
  } catch (error: unknown) {
    return {
      name: `${check.tool}`,
      ok: false,
      summary: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runInvestigationCopilot(params: {
  incident: IncidentForInvestigation;
  artifacts: ArtifactItem[];
  timeline: TimelineEventItem[];
  note?: string;
}) {
  const note = params.note?.trim() ?? "";
  const cves = extractCves(params.incident);
  const issueRefs = extractIssueRefs(params.incident);
  const githubRepo = detectGithubRepo(params.incident, issueRefs);

  let modelPlan: InvestigationPlan | null = null;
  try {
    modelPlan = await buildModelPlan({
      incident: params.incident,
      artifacts: params.artifacts,
      timeline: params.timeline,
      cves,
      issueRefs,
      githubRepo,
      note,
    });
  } catch {
    modelPlan = null;
  }

  const fallbackPlan = buildFallbackPlan({ cves, issueRefs, githubRepo });
  const basePlan = modelPlan ?? fallbackPlan;
  const checks = sanitizeChecks(basePlan.checks);

  for (const cve of cves.slice(0, 3)) {
    addCheck(checks, {
      tool: "NVD_CVE",
      args: { cve },
      why: "Validate known CVE context.",
    });
  }
  for (const vendor of supportedStatusVendors()) {
    addCheck(checks, {
      tool: "STATUSPAGE",
      args: { vendor },
      why: "Detect correlated external platform incidents.",
    });
  }
  if (githubRepo) {
    for (const ref of issueRefs.slice(0, 3)) {
      const parsed = parseIssueRef(ref, githubRepo);
      if (parsed.repo && parsed.issueNumber) {
        addCheck(checks, {
          tool: "GITHUB_ISSUE",
          args: { repo: parsed.repo, issue_number: parsed.issueNumber, issue_ref: ref },
          why: "Check linked issue execution status.",
        });
      }
    }
  }

  if (!checks.some((item) => item.tool === "GITHUB_SEARCH")) {
    const queryTerms = uniqueStrings(
      [
        params.incident.title ?? "",
        params.incident.category ?? "",
        params.incident.severity ?? "",
        ...cves,
      ].filter(Boolean),
      5
    );
    if (queryTerms.length) {
      addCheck(checks, {
        tool: "GITHUB_SEARCH",
        args: {
          query: queryTerms.join(" "),
          ...(githubRepo ? { repo: githubRepo } : {}),
        },
        why: "Find recent related engineering reports.",
      });
    }
  }

  const limitedChecks = checks.slice(0, 14);
  const toolResults: InvestigationToolResult[] = [];
  for (const check of limitedChecks) {
    toolResults.push(await executeCheck(check, { cves, issueRefs, githubRepo }));
  }

  const hypotheses = uniqueStrings(
    basePlan.hypotheses.length
      ? basePlan.hypotheses
      : [
          "A dependency, upstream, or provider issue is causing observed failures.",
          "Impact may be concentrated in specific systems or regions.",
        ],
    8
  );

  const updatedNextActions = mergeNextActions(
    params.incident.next_actions_md,
    basePlan.updated_next_actions_md,
    toolResults
  );

  return {
    hypotheses,
    plan_md: formatPlanMarkdown(limitedChecks),
    tool_results: toolResults,
    updated_next_actions_md: updatedNextActions,
    meta: {
      note: note || null,
      checks_planned: limitedChecks,
      cves,
      issue_refs: issueRefs,
      github_repo: githubRepo,
      fallback_plan_used: modelPlan === null,
      tool_failures: toolResults.filter((result) => !result.ok).length,
    },
  };
}
