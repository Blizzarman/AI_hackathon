"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Accordion from "@/components/Accordion";
import AccordionGroup from "@/components/AccordionGroup";
import Badge from "@/components/Badge";
import Button from "@/components/Button";
import Card from "@/components/Card";
import Layout from "@/components/Layout";

type Incident = {
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
  created_at: string;
};

type SimilarIncident = {
  id: string;
  title: string | null;
  score: number;
};

type Artifact = {
  id: string;
  incident_id: string;
  kind: string;
  mime: string | null;
  content: string;
  created_at: string;
};

type PipelineStepRow = {
  run_id: string;
  run_created_at: string;
  name: string;
  ms: number;
  ok: boolean;
  error: string | null;
  meta?: Record<string, unknown>;
};

type TimelineEvent = {
  id: string;
  incident_id: string;
  created_at: string;
  type: "INGEST" | "TRIAGE" | "ENRICH" | "UPDATE_INTERNAL" | "UPDATE_EXTERNAL" | "NOTE";
  message: string;
  meta: Record<string, unknown>;
};

type SimilarResponse = { items: SimilarIncident[] };
type RunStepsResponse = { items: PipelineStepRow[] };
type TimelineResponse = { items: TimelineEvent[] };
type IncidentResponse = { incident: Incident; artifacts: Artifact[] };
type UpdateResponseOk = { ok: true; type: "internal" | "external"; content: string };
type UpdateResponseError = { error: string; step?: string };
type UpdateResponse = UpdateResponseOk | UpdateResponseError;

type InvestigationToolResult = {
  name: string;
  ok: boolean;
  summary: string;
  data?: unknown;
};

type InvestigationResponse = {
  hypotheses: string[];
  plan_md: string;
  tool_results: InvestigationToolResult[];
  updated_next_actions_md: string;
  error?: string;
};
type InvestigationErrorResponse = { error: string; step?: string };

type DiagnosticModelCall = {
  request_id: string;
  provider: string;
  kind: string;
  model: string;
  latency_ms: number;
  input_chars: number;
  output_chars: number;
  ok: boolean;
  error?: string;
  at?: string;
};

type AiTransparencyConfidence = "low" | "medium" | "high";

type AiTransparencyRationale = {
  signals: string[];
  reasoning: string;
  missing_info: string[];
  confidence: AiTransparencyConfidence;
};

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
    .filter((item) => item.length > 0);
}

function toConfidence(value: unknown): AiTransparencyConfidence {
  if (value === "high" || value === "medium" || value === "low") {
    return value;
  }
  return "low";
}

function parseAiRationale(value: unknown): AiTransparencyRationale | null {
  const obj = toObject(value);
  const signals = toStringArray(obj.signals);
  const missingInfo = toStringArray(obj.missing_info);
  const reasoning = typeof obj.reasoning === "string" ? obj.reasoning.trim() : "";
  const confidence = toConfidence(obj.confidence);

  if (signals.length === 0 && missingInfo.length === 0 && !reasoning) {
    return null;
  }

  return {
    signals,
    reasoning,
    missing_info: missingInfo,
    confidence,
  };
}

function deriveLegacyRationale(incident: Incident): AiTransparencyRationale {
  const entities = toObject(incident.entities_json);
  const errorCodes = toStringArray(entities.error_codes);
  const regions = toStringArray(entities.regions);
  const cves = toStringArray(entities.cves);
  const signals: string[] = [];

  if (incident.severity) {
    signals.push(`Severity selected: "${incident.severity}"`);
  }
  if (incident.category) {
    signals.push(`Category selected: "${incident.category}"`);
  }
  if (incident.routing_team) {
    signals.push(`Routing selected: "${incident.routing_team}"`);
  }
  if (errorCodes.length > 0) {
    signals.push(`Error/code signals: "${errorCodes.slice(0, 3).join(", ")}"`);
  }
  if (regions.length > 0) {
    signals.push(`Region signals: "${regions.slice(0, 3).join(", ")}"`);
  }
  if (cves.length > 0) {
    signals.push(`CVE signals: "${cves.slice(0, 3).join(", ")}"`);
  }
  if (incident.customer_impact === true) {
    signals.push('Impact signal: "customer_impact=true"');
  }

  const missingInfo: string[] = [];
  if (regions.length === 0) {
    missingInfo.push("Confirm affected region(s) and blast radius.");
  }
  if (errorCodes.length === 0) {
    missingInfo.push("Collect one representative error code or stack fragment.");
  }
  if ((incident.summary_md ?? "").trim().length === 0) {
    missingInfo.push("Capture a concise symptom summary from logs or screenshots.");
  }

  const confidence: AiTransparencyConfidence =
    signals.length >= 5 ? "high" : signals.length >= 3 ? "medium" : "low";

  return {
    signals,
    reasoning: `Derived from stored incident fields (severity/category/routing/entities) because no explicit ai_rationale payload was found.`,
    missing_info: missingInfo,
    confidence,
  };
}

function extractAiRationale(incident: Incident): AiTransparencyRationale | null {
  const enrichment = toObject(incident.enrichment_json);
  const topLevel = parseAiRationale(enrichment.ai_rationale);
  if (topLevel) {
    return topLevel;
  }

  const nested = parseAiRationale(toObject(enrichment.classification).rationale);
  if (nested) {
    return nested;
  }

  return deriveLegacyRationale(incident);
}

async function parseJsonResponse<T>(res: Response): Promise<T> {
  const raw = await res.text();
  if (!raw.trim()) {
    throw new Error("Empty API response.");
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error("API returned non-JSON payload.");
  }
}

function collectDiagnostics(steps: PipelineStepRow[]) {
  const requestIdSet = new Set<string>();
  const modelCalls: DiagnosticModelCall[] = [];
  const ocrDebugRows: Array<{
    run_created_at: string;
    ocr_text_len: number;
    ocr_preview: string;
    raw_text_len_after_ocr: number;
    ocr_http_status: number | null;
    ocr_model: string;
    ocr_raw_preview: string;
    ocr_error: string;
  }> = [];

  for (const step of steps) {
    const meta = toObject(step.meta);
    if (typeof meta.request_id === "string" && meta.request_id.trim()) {
      requestIdSet.add(meta.request_id.trim());
    }

    const metaModelCalls = Array.isArray(meta.model_calls) ? meta.model_calls : [];
    for (const item of metaModelCalls) {
      const row = toObject(item);
      if (typeof row.request_id === "string" && row.request_id.trim()) {
        requestIdSet.add(row.request_id.trim());
      }

      modelCalls.push({
        request_id: typeof row.request_id === "string" ? row.request_id : "",
        provider: typeof row.provider === "string" ? row.provider : "unknown",
        kind: typeof row.kind === "string" ? row.kind : "unknown",
        model: typeof row.model === "string" ? row.model : "unknown",
        latency_ms: typeof row.latency_ms === "number" ? row.latency_ms : 0,
        input_chars: typeof row.input_chars === "number" ? row.input_chars : 0,
        output_chars: typeof row.output_chars === "number" ? row.output_chars : 0,
        ok: Boolean(row.ok),
        error: typeof row.error === "string" ? row.error : undefined,
        at: typeof row.at === "string" ? row.at : undefined,
      });
    }

    if (step.name === "ocr") {
      const ocrTextLen = typeof meta.ocr_text_len === "number" ? meta.ocr_text_len : 0;
      const ocrPreview = typeof meta.ocr_preview === "string" ? meta.ocr_preview : "";
      const rawTextLenAfterOcr =
        typeof meta.raw_text_len_after_ocr === "number" ? meta.raw_text_len_after_ocr : 0;
      const ocrHttpStatus = typeof meta.ocr_http_status === "number" ? meta.ocr_http_status : null;
      const ocrModel = typeof meta.ocr_model === "string" ? meta.ocr_model : "";
      const ocrRawPreview = typeof meta.ocr_raw_preview === "string" ? meta.ocr_raw_preview : "";
      const ocrError = typeof meta.ocr_error === "string" ? meta.ocr_error : "";

      ocrDebugRows.push({
        run_created_at: step.run_created_at,
        ocr_text_len: ocrTextLen,
        ocr_preview: ocrPreview,
        raw_text_len_after_ocr: rawTextLenAfterOcr,
        ocr_http_status: ocrHttpStatus,
        ocr_model: ocrModel,
        ocr_raw_preview: ocrRawPreview,
        ocr_error: ocrError,
      });
    }
  }

  return {
    requestIds: Array.from(requestIdSet),
    modelCalls,
    ocrDebugRows,
  };
}

function TextBlock({ value }: { value: string | null }) {
  return <div className="text-block">{value?.trim() || "No data available."}</div>;
}

function CopyCodeBlock({ value, codeKey }: { value: unknown; codeKey: string }) {
  const [copied, setCopied] = useState(false);
  const content = JSON.stringify(value, null, 2);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="code-block-wrap" data-code-key={codeKey}>
      <div className="code-block-actions">
        <button type="button" className="btn btn-secondary code-copy-btn" onClick={onCopy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="code-block">{content}</pre>
    </div>
  );
}

function CopyJsonButton({ value }: { value: unknown }) {
  const [copied, setCopied] = useState(false);
  const content = JSON.stringify(value, null, 2);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button type="button" className="btn btn-secondary code-copy-btn" onClick={onCopy}>
      {copied ? "Copied" : "Copy rationale JSON"}
    </button>
  );
}

export default function IncidentPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = typeof params.id === "string" ? params.id : "";

  const [incident, setIncident] = useState<Incident | null>(null);
  const [similar, setSimilar] = useState<SimilarIncident[]>([]);
  const [steps, setSteps] = useState<PipelineStepRow[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [updateNote, setUpdateNote] = useState("");
  const [updateBusy, setUpdateBusy] = useState<"internal" | "external" | null>(null);
  const [updateNotice, setUpdateNotice] = useState<string | null>(null);
  const [updateNoticeKind, setUpdateNoticeKind] = useState<"ok" | "error" | null>(null);
  const [investigationNote, setInvestigationNote] = useState("");
  const [investigationBusy, setInvestigationBusy] = useState(false);
  const [investigationError, setInvestigationError] = useState<string | null>(null);
  const [investigationResult, setInvestigationResult] = useState<InvestigationResponse | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  async function fetchIncidentBundle(incidentId: string) {
    const incidentRes = await fetch(`/api/incidents/${incidentId}`, { cache: "no-store" });
    if (!incidentRes.ok) {
      throw new Error(await incidentRes.text());
    }
    const incidentData = (await incidentRes.json()) as IncidentResponse;

    const [similarRes, runsRes, timelineRes] = await Promise.all([
      fetch(`/api/incidents/${incidentId}/similar`, { cache: "no-store" }),
      fetch(`/api/incidents/${incidentId}/runs`, { cache: "no-store" }),
      fetch(`/api/incidents/${incidentId}/timeline`, { cache: "no-store" }),
    ]);

    let similarData: SimilarResponse = { items: [] };
    if (similarRes.ok) {
      similarData = (await similarRes.json()) as SimilarResponse;
    }

    let runData: RunStepsResponse = { items: [] };
    if (runsRes.ok) {
      runData = (await runsRes.json()) as RunStepsResponse;
    }

    let timelineData: TimelineResponse = { items: [] };
    if (timelineRes.ok) {
      timelineData = (await timelineRes.json()) as TimelineResponse;
    }

    return {
      incidentData,
      similarData,
      runData,
      timelineData,
    };
  }

  useEffect(() => {
    if (!id) {
      return;
    }

    let active = true;
    (async () => {
      setBusy(true);
      setErr(null);
      try {
        const bundle = await fetchIncidentBundle(id);

        if (!active) {
          return;
        }
        setIncident(bundle.incidentData.incident);
        setArtifacts(Array.isArray(bundle.incidentData.artifacts) ? bundle.incidentData.artifacts : []);
        setSimilar(Array.isArray(bundle.similarData.items) ? bundle.similarData.items : []);
        setSteps(Array.isArray(bundle.runData.items) ? bundle.runData.items : []);
        setTimeline(Array.isArray(bundle.timelineData.items) ? bundle.timelineData.items : []);
      } catch (e: unknown) {
        if (!active) {
          return;
        }
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (active) {
          setBusy(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [id]);

  async function refreshIncident() {
    if (!id) {
      return;
    }
    const bundle = await fetchIncidentBundle(id);
    setIncident(bundle.incidentData.incident);
    setArtifacts(Array.isArray(bundle.incidentData.artifacts) ? bundle.incidentData.artifacts : []);
    setSimilar(Array.isArray(bundle.similarData.items) ? bundle.similarData.items : []);
    setSteps(Array.isArray(bundle.runData.items) ? bundle.runData.items : []);
    setTimeline(Array.isArray(bundle.timelineData.items) ? bundle.timelineData.items : []);
  }

  async function generateUpdate(target: "internal" | "external") {
    if (!id) {
      return;
    }

    setUpdateBusy(target);
    setUpdateNotice(null);
    setUpdateNoticeKind(null);
    try {
      const res = await fetch(`/api/incidents/${id}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          note: updateNote.trim() || undefined,
        }),
      });
      const data = await parseJsonResponse<UpdateResponse>(res);
      if (!res.ok) {
        const message =
          "error" in data ? data.error : "Failed to generate incident update.";
        throw new Error(message);
      }
      if (!("ok" in data) || !data.ok || typeof data.content !== "string") {
        throw new Error("Invalid update API response format.");
      }

      setIncident((prev) => {
        if (!prev) {
          return prev;
        }
        if (target === "internal") {
          return { ...prev, comms_internal: data.content };
        }
        return { ...prev, comms_external: data.content };
      });

      setUpdateNotice(target === "internal" ? "Internal update generated." : "External update generated.");
      setUpdateNoticeKind("ok");
      await refreshIncident();
    } catch (error: unknown) {
      setUpdateNotice(error instanceof Error ? error.message : String(error));
      setUpdateNoticeKind("error");
    } finally {
      setUpdateBusy(null);
    }
  }

  async function runInvestigation() {
    if (!id) {
      return;
    }

    setInvestigationBusy(true);
    setInvestigationError(null);
    try {
      const res = await fetch(`/api/incidents/${id}/investigate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: investigationNote.trim() || undefined,
        }),
      });
      const data = await parseJsonResponse<InvestigationResponse | InvestigationErrorResponse>(res);
      if (!res.ok) {
        const message = "error" in data ? data.error : "Investigation request failed.";
        throw new Error(message);
      }
      if (
        !("hypotheses" in data) ||
        !Array.isArray(data.hypotheses) ||
        !("plan_md" in data) ||
        typeof data.plan_md !== "string" ||
        !("tool_results" in data) ||
        !Array.isArray(data.tool_results) ||
        !("updated_next_actions_md" in data) ||
        typeof data.updated_next_actions_md !== "string"
      ) {
        throw new Error("Invalid investigation API response format.");
      }
      setInvestigationResult(data);
      await refreshIncident();
    } catch (error: unknown) {
      setInvestigationError(error instanceof Error ? error.message : String(error));
    } finally {
      setInvestigationBusy(false);
    }
  }

  async function deleteIncident() {
    if (!incident) {
      return;
    }
    const confirmation = window.prompt(
      `Delete incident "${incident.title ?? incident.id}"?\nType DELETE to confirm.`
    );
    if (confirmation !== "DELETE") {
      return;
    }

    setDeleteErr(null);
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/incidents/${incident.id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to delete incident.");
      }
      router.push("/incidents");
    } catch (error: unknown) {
      setDeleteErr(error instanceof Error ? error.message : String(error));
      setDeleteBusy(false);
    }
  }

  if (busy) {
    return (
      <Layout title="Incident" backHref="/incidents" backLabel="Back to incidents">
        <Card>
          <p className="muted">Loading incident...</p>
        </Card>
      </Layout>
    );
  }

  if (err) {
    return (
      <Layout title="Incident" backHref="/incidents" backLabel="Back to incidents">
        <pre className="error-box">{err}</pre>
      </Layout>
    );
  }

  if (!incident) {
    return (
      <Layout title="Incident" backHref="/incidents" backLabel="Back to incidents">
        <Card>
          <p className="muted">Incident not found.</p>
        </Card>
      </Layout>
    );
  }

  const diagnostics = collectDiagnostics(steps);
  const aiRationale = extractAiRationale(incident);
  const aiRationaleJson = aiRationale
    ? {
        confidence: aiRationale.confidence,
        signals: aiRationale.signals,
        reasoning: aiRationale.reasoning,
        missing_info: aiRationale.missing_info,
      }
    : null;
  const confidenceBadgeClass = aiRationale
    ? `badge badge-confidence badge-confidence-${aiRationale.confidence}`
    : "badge badge-muted";
  const confidenceLabel = aiRationale ? aiRationale.confidence.toUpperCase() : "UNKNOWN";

  return (
    <Layout
      title={incident.title ?? "Untitled incident"}
      subtitle={`Created ${new Date(incident.created_at).toLocaleString()}`}
      backHref="/incidents"
      backLabel="Back to incidents"
      actions={
        <>
          <Button href={`/api/incidents/${incident.id}/export.md`} variant="secondary" download>
            Download Markdown
          </Button>
          <Button href={`/api/incidents/${incident.id}/export.json`} variant="secondary" download>
            Download JSON
          </Button>
          <Button href={`/share/${incident.id}`} variant="secondary">
            Share view
          </Button>
          <Button href="/incidents/new" variant="secondary">
            New Incident
          </Button>
          <Button variant="danger" disabled={deleteBusy} onClick={deleteIncident}>
            {deleteBusy ? "Deleting..." : "Delete incident"}
          </Button>
        </>
      }
    >
      <div className="stack">
        {deleteErr ? <p className="inline-error">{deleteErr}</p> : null}
        <Card>
          <div className="meta-row">
            {incident.severity ? <Badge kind="severity" value={incident.severity} /> : null}
            {incident.category ? <Badge kind="category" value={incident.category} /> : null}
            <Badge
              kind="status"
              value={incident.customer_impact ? "Customer Impact: Yes" : "Customer Impact: No"}
            />
          </div>
          <p className="meta-inline">Routing team: {incident.routing_team ?? "-"}</p>
        </Card>

        <Card title="Update Generator" subtitle="Draft iterative updates from current timeline and context.">
          <div className="field">
            <label className="field-label" htmlFor="update-note-input">
              Add note (optional)
            </label>
            <textarea
              id="update-note-input"
              className="textarea update-note-input"
              placeholder="e.g., Mitigation switched to failover cluster at 14:05 UTC"
              value={updateNote}
              onChange={(event) => setUpdateNote(event.target.value)}
            />
          </div>
          <div className="button-row">
            <Button
              variant="primary"
              onClick={() => generateUpdate("internal")}
              disabled={updateBusy !== null}
            >
              {updateBusy === "internal" ? "Generating..." : "Generate internal update"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => generateUpdate("external")}
              disabled={updateBusy !== null}
            >
              {updateBusy === "external" ? "Generating..." : "Generate external update"}
            </Button>
          </div>
          {updateNotice ? (
            <p className={updateNoticeKind === "ok" ? "inline-ok" : "inline-error"}>{updateNotice}</p>
          ) : null}
        </Card>

        <Card>
          <AccordionGroup>
            <Accordion title="Summary" defaultOpen>
              <TextBlock value={incident.summary_md} />
            </Accordion>

            <Accordion title="Next actions" defaultOpen>
              <TextBlock value={incident.next_actions_md} />
            </Accordion>

            <Accordion title="Investigation Copilot">
              <div className="investigation-controls">
                <div className="field">
                  <label className="field-label" htmlFor="investigation-note-input">
                    Investigation note (optional)
                  </label>
                  <textarea
                    id="investigation-note-input"
                    className="textarea investigation-note-input"
                    placeholder="Add context before running checks..."
                    value={investigationNote}
                    onChange={(event) => setInvestigationNote(event.target.value)}
                  />
                </div>
                <div className="button-row">
                  <Button variant="primary" onClick={runInvestigation} disabled={investigationBusy}>
                    {investigationBusy ? "Running investigation..." : "Run investigation"}
                  </Button>
                </div>
              </div>

              {investigationError ? <p className="inline-error">{investigationError}</p> : null}

              {investigationResult ? (
                <div className="investigation-results">
                  <div>
                    <h3 className="section-title">Hypotheses</h3>
                    {investigationResult.hypotheses.length === 0 ? (
                      <p className="muted">No hypotheses generated.</p>
                    ) : (
                      <ul className="list-clean">
                        {investigationResult.hypotheses.map((hypothesis, idx) => (
                          <li key={`${hypothesis}-${idx}`}>{hypothesis}</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <h3 className="section-title">Investigation plan</h3>
                    <div className="content-block">{investigationResult.plan_md || "No plan generated."}</div>
                  </div>

                  <div>
                    <h3 className="section-title">Tool results</h3>
                    {investigationResult.tool_results.length === 0 ? (
                      <p className="muted">No tool checks were executed.</p>
                    ) : (
                      <div className="tool-results-grid">
                        {investigationResult.tool_results.map((result, idx) => (
                          <article className="tool-result-card" key={`${result.name}-${idx}`}>
                            <div className="tool-result-head">
                              <strong>{result.name}</strong>
                              <Badge kind="status" value={result.ok ? "Success" : "Failure"} />
                            </div>
                            <p className="tool-result-summary">{result.summary}</p>
                            {typeof result.data !== "undefined" ? (
                              <pre className="code-block tool-result-data">
                                {JSON.stringify(result.data, null, 2)}
                              </pre>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="section-title">Updated next actions</h3>
                    <div className="content-block">{investigationResult.updated_next_actions_md}</div>
                  </div>
                </div>
              ) : (
                <p className="muted">Run investigation to generate hypotheses, checks, and evidence-backed actions.</p>
              )}
            </Accordion>

            <Accordion title="Internal update">
              <TextBlock value={incident.comms_internal} />
            </Accordion>

            <Accordion title="External update">
              <TextBlock value={incident.comms_external} />
            </Accordion>

            <Accordion title="AI Transparency">
              {aiRationale ? (
                <div className="stack">
                  <div className="meta-row">
                    <span className={confidenceBadgeClass}>Confidence: {confidenceLabel}</span>
                    <CopyJsonButton value={aiRationaleJson} />
                  </div>

                  <div>
                    <h3 className="section-title">Signals used</h3>
                    {aiRationale.signals.length === 0 ? (
                      <p className="muted">No explicit grounded signals were captured.</p>
                    ) : (
                      <ul className="list-clean">
                        {aiRationale.signals.map((signal) => (
                          <li key={signal}>{signal}</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <h3 className="section-title">Reasoning</h3>
                    <div className="content-block">{aiRationale.reasoning || "No reasoning recorded."}</div>
                  </div>

                  <div>
                    <h3 className="section-title">Missing info checklist</h3>
                    {aiRationale.missing_info.length === 0 ? (
                      <p className="muted">No missing-information checks listed.</p>
                    ) : (
                      <ul className="list-clean ai-missing-list">
                        {aiRationale.missing_info.map((item) => (
                          <li key={item}>
                            <label>
                              <input type="checkbox" disabled /> <span>{item}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ) : (
                <p className="muted">
                  No AI rationale recorded for this incident. New incidents store rationale in
                  enrichment.ai_rationale.
                </p>
              )}
            </Accordion>

            <Accordion title="Entities">
              <CopyCodeBlock value={incident.entities_json} codeKey="entities" />
            </Accordion>

            <Accordion title="Enrichment">
              <CopyCodeBlock value={incident.enrichment_json} codeKey="enrichment" />
            </Accordion>

            <Accordion title="Artifacts">
              {artifacts.length === 0 ? (
                <p className="muted">No artifacts stored for this incident.</p>
              ) : (
                <div className="artifact-list">
                  {artifacts.map((artifact) => (
                    <article className="artifact-item" key={artifact.id}>
                      <div className="artifact-meta">
                        <span className="badge badge-muted">{artifact.kind.toUpperCase()}</span>
                        <span className="meta-inline">{new Date(artifact.created_at).toLocaleString()}</span>
                        {artifact.mime ? <span className="meta-inline">{artifact.mime}</span> : null}
                      </div>
                      <div className="text-block artifact-content">{artifact.content || "(empty artifact)"}</div>
                    </article>
                  ))}
                </div>
              )}
            </Accordion>

            <Accordion title="Timeline">
              {timeline.length === 0 ? (
                <p className="muted">No timeline events recorded yet.</p>
              ) : (
                <div className="timeline-list">
                  {timeline.map((event) => (
                    <details key={event.id} className="timeline-item">
                      <summary className="timeline-summary">
                        <div className="timeline-summary-main">
                          <span className={`badge timeline-type timeline-type-${event.type.toLowerCase()}`}>
                            {event.type}
                          </span>
                          <span>{event.message}</span>
                        </div>
                        <span className="meta-inline">{new Date(event.created_at).toLocaleString()}</span>
                      </summary>
                      <div className="timeline-meta-wrap">
                        <pre className="code-block timeline-meta">
                          {JSON.stringify(event.meta ?? {}, null, 2)}
                        </pre>
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </Accordion>

            <Accordion title="Similar incidents">
              {similar.length === 0 ? (
                <p className="muted">No similar incidents found yet.</p>
              ) : (
                <ul className="list-clean">
                  {similar.map((item) => (
                    <li key={item.id}>
                      <a href={`/incidents/${item.id}`}>
                        {item.title ?? "Untitled incident"} (score {Number(item.score).toFixed(3)})
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </Accordion>

            <Accordion title="Diagnostics">
              <div className="stack">
                <div>
                  <h3 className="section-title">Request IDs</h3>
                  {diagnostics.requestIds.length === 0 ? (
                    <p className="muted">No request IDs recorded.</p>
                  ) : (
                    <div className="meta-row">
                      {diagnostics.requestIds.map((requestId) => (
                        <span key={requestId} className="badge badge-muted">
                          {requestId}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="section-title">Model Calls</h3>
                  {diagnostics.modelCalls.length === 0 ? (
                    <p className="muted">No model telemetry recorded in pipeline runs.</p>
                  ) : (
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>At</th>
                            <th>Request ID</th>
                            <th>Model</th>
                            <th>Type</th>
                            <th>Latency (ms)</th>
                            <th>Input chars</th>
                            <th>Output chars</th>
                            <th>Status</th>
                            <th>Error</th>
                          </tr>
                        </thead>
                        <tbody>
                          {diagnostics.modelCalls.map((call, index) => (
                            <tr key={`${call.request_id}-${call.model}-${index}`}>
                              <td>{call.at ? new Date(call.at).toLocaleString() : "-"}</td>
                              <td>{call.request_id || "-"}</td>
                              <td>{call.model}</td>
                              <td>{call.kind}</td>
                              <td>{Math.round(call.latency_ms)}</td>
                              <td>{call.input_chars}</td>
                              <td>{call.output_chars}</td>
                              <td>
                                <Badge kind="status" value={call.ok ? "Success" : "Failure"} />
                              </td>
                              <td>{call.error ? <span className="text-danger">{call.error}</span> : "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="section-title">OCR Debug</h3>
                  {diagnostics.ocrDebugRows.length === 0 ? (
                    <p className="muted">No OCR debug data recorded.</p>
                  ) : (
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Run Time</th>
                            <th>HTTP</th>
                            <th>Model</th>
                            <th>OCR text len</th>
                            <th>Raw text len after OCR</th>
                            <th>OCR preview</th>
                            <th>Raw response preview</th>
                            <th>OCR error</th>
                          </tr>
                        </thead>
                        <tbody>
                          {diagnostics.ocrDebugRows.map((row, index) => (
                            <tr key={`${row.run_created_at}-${index}`}>
                              <td>{new Date(row.run_created_at).toLocaleString()}</td>
                              <td>{row.ocr_http_status ?? "-"}</td>
                              <td>{row.ocr_model || "-"}</td>
                              <td>{row.ocr_text_len}</td>
                              <td>{row.raw_text_len_after_ocr}</td>
                              <td>{row.ocr_preview || "-"}</td>
                              <td>{row.ocr_raw_preview || "-"}</td>
                              <td>{row.ocr_error ? <span className="text-danger">{row.ocr_error}</span> : "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </Accordion>

            <Accordion title="Pipeline logs">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Run Time</th>
                      <th>Step</th>
                      <th>Duration (ms)</th>
                      <th>Status</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {steps.map((step, index) => (
                      <tr key={`${step.run_id}-${step.name}-${index}`}>
                        <td>{new Date(step.run_created_at).toLocaleString()}</td>
                        <td>{step.name}</td>
                        <td>{Math.round(step.ms)}</td>
                        <td>
                          <Badge kind="status" value={step.ok ? "Success" : "Failure"} />
                        </td>
                        <td>{step.error ? <span className="text-danger">{step.error}</span> : "-"}</td>
                      </tr>
                    ))}
                    {steps.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="muted">
                          No pipeline runs recorded for this incident.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </Accordion>
          </AccordionGroup>
        </Card>
      </div>
    </Layout>
  );
}
