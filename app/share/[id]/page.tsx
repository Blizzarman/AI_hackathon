"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Accordion from "@/components/Accordion";
import AccordionGroup from "@/components/AccordionGroup";
import Badge from "@/components/Badge";
import Button from "@/components/Button";
import Card from "@/components/Card";
import Layout from "@/components/Layout";
import { toExcerpt } from "@/lib/incidents/report";

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

function ArtifactExcerptList({ artifacts }: { artifacts: Artifact[] }) {
  if (artifacts.length === 0) {
    return <p className="muted">No artifacts available.</p>;
  }

  return (
    <div className="artifact-list">
      {artifacts.map((artifact) => (
        <article className="artifact-item" key={artifact.id}>
          <div className="artifact-meta">
            <span className="badge badge-muted">{artifact.kind.toUpperCase()}</span>
            <span className="meta-inline">{new Date(artifact.created_at).toLocaleString()}</span>
            {artifact.mime ? <span className="meta-inline">{artifact.mime}</span> : null}
            <span className="meta-inline">chars: {artifact.content.length}</span>
          </div>
          <div className="text-block artifact-content">{toExcerpt(artifact.content, 700)}</div>
        </article>
      ))}
    </div>
  );
}

export default function IncidentSharePage() {
  const params = useParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : "";

  const [incident, setIncident] = useState<Incident | null>(null);
  const [similar, setSimilar] = useState<SimilarIncident[]>([]);
  const [steps, setSteps] = useState<PipelineStepRow[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      return;
    }

    let active = true;
    (async () => {
      setBusy(true);
      setErr(null);
      try {
        const incidentRes = await fetch(`/api/incidents/${id}`, { cache: "no-store" });
        if (!incidentRes.ok) {
          throw new Error(await incidentRes.text());
        }
        const incidentData = (await incidentRes.json()) as IncidentResponse;

        const [similarRes, runsRes, timelineRes] = await Promise.all([
          fetch(`/api/incidents/${id}/similar`, { cache: "no-store" }),
          fetch(`/api/incidents/${id}/runs`, { cache: "no-store" }),
          fetch(`/api/incidents/${id}/timeline`, { cache: "no-store" }),
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

        if (!active) {
          return;
        }
        setIncident(incidentData.incident);
        setArtifacts(Array.isArray(incidentData.artifacts) ? incidentData.artifacts : []);
        setSimilar(Array.isArray(similarData.items) ? similarData.items : []);
        setSteps(Array.isArray(runData.items) ? runData.items : []);
        setTimeline(Array.isArray(timelineData.items) ? timelineData.items : []);
      } catch (error: unknown) {
        if (!active) {
          return;
        }
        setErr(error instanceof Error ? error.message : String(error));
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

  if (busy) {
    return (
      <Layout title="Share view" backHref="/incidents" backLabel="Back to incidents">
        <Card>
          <p className="muted">Loading shared incident view...</p>
        </Card>
      </Layout>
    );
  }

  if (err) {
    return (
      <Layout title="Share view" backHref="/incidents" backLabel="Back to incidents">
        <pre className="error-box">{err}</pre>
      </Layout>
    );
  }

  if (!incident) {
    return (
      <Layout title="Share view" backHref="/incidents" backLabel="Back to incidents">
        <Card>
          <p className="muted">Incident not found.</p>
        </Card>
      </Layout>
    );
  }

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
        </>
      }
    >
      <Card className="readonly-banner-card">
        <p className="readonly-banner">Read-only share view</p>
        <p className="muted">
          This shared view hides raw text and full artifact contents. It is intended for external review.
        </p>
      </Card>

      <div className="stack">
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

        <Card>
          <AccordionGroup>
            <Accordion title="Summary" defaultOpen>
              <TextBlock value={incident.summary_md} />
            </Accordion>

            <Accordion title="Next actions" defaultOpen>
              <TextBlock value={incident.next_actions_md} />
            </Accordion>

            <Accordion title="Internal update">
              <TextBlock value={incident.comms_internal} />
            </Accordion>

            <Accordion title="External update">
              <TextBlock value={incident.comms_external} />
            </Accordion>

            <Accordion title="Entities">
              <CopyCodeBlock value={incident.entities_json} codeKey="share-entities" />
            </Accordion>

            <Accordion title="Enrichment">
              <CopyCodeBlock value={incident.enrichment_json} codeKey="share-enrichment" />
            </Accordion>

            <Accordion title="Artifacts (excerpts)">
              <ArtifactExcerptList artifacts={artifacts} />
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
