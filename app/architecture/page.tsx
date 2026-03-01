import Link from "next/link";

const aiResponsibilities = [
  {
    title: "OCR / ASR (perception)",
    does: "Converts screenshots and audio into machine-usable text.",
    outputs: "Extracted text blocks and transcripts.",
    matters: "Captures evidence that would otherwise stay in images or voice notes.",
  },
  {
    title: "Classification (severity/routing)",
    does: "Assigns severity, category, and likely owner team from context.",
    outputs: "Severity level, category, routing team, impact signal.",
    matters: "Reduces triage variance across operators and shifts.",
  },
  {
    title: "Entity extraction (semantic parsing)",
    does: "Finds structured entities such as CVEs, issue refs, and regions.",
    outputs: "Normalized entity payload for enrichment and search.",
    matters: "Turns unstructured text into queryable investigation inputs.",
  },
  {
    title: "Draft comms (generation)",
    does: "Builds concise internal/external updates from known facts.",
    outputs: "Comms drafts plus next-action language.",
    matters: "Shortens time-to-first-update while preserving consistency.",
  },
  {
    title: "Embeddings (memory layer)",
    does: "Encodes incident context into vectors for similarity retrieval.",
    outputs: "pgvector-compatible embedding arrays.",
    matters: "Unlocks incident reuse and pattern recall across historical cases.",
  },
  {
    title: "Investigation copilot (planning + evidence merge)",
    does: "Proposes checks, runs safe tools, and merges evidence into actions.",
    outputs: "Hypotheses, tool results, updated next actions, timeline event.",
    matters: "Keeps investigation work evidence-backed and auditable.",
  },
];

const dataModel = [
  {
    table: "incidents",
    description:
      "Core incident record: classification, generated outputs, entities/enrichment JSON, raw text, and embedding.",
  },
  {
    table: "artifacts",
    description:
      "Captured artifacts linked to an incident (markdown/json snapshots and supporting payloads).",
  },
  {
    table: "pipeline_runs",
    description:
      "Step-by-step execution logs, timings, and per-step metadata for debugging and observability.",
  },
  {
    table: "incident_timeline",
    description:
      "Chronological events (ingest, enrich, updates, investigation milestones) for auditability.",
  },
];

const reliabilityCards = [
  {
    title: "Strict JSON schema validation (Zod)",
    text: "Request bodies and model outputs are validated before persistence or downstream execution.",
  },
  {
    title: "Retry-safe JSON repair",
    text: "Model responses are parsed with fallback repair prompts when JSON formatting is imperfect.",
  },
  {
    title: "Timeouts + safe tool failures",
    text: "External tools run with timeouts; failures are captured as evidence, not fatal system crashes.",
  },
  {
    title: "Step-level telemetry + request_id",
    text: "Each stage records timing and metadata so traces can be followed from request to output.",
  },
  {
    title: "Caching where useful",
    text: "Read paths and deterministic fetches can be cached without changing critical incident state flow.",
  },
  {
    title: "No destructive tool actions",
    text: "Investigation tools are read-only lookups (NVD/GitHub/status), reducing operational risk.",
  },
];

const scalabilityPoints = [
  "Modular step pipeline: perception, triage, enrichment, generation, retrieval.",
  "Provider swap possible (HF/Mistral) through model client abstraction.",
  "pgvector similarity search supports historical incident memory at scale.",
  "Connector-friendly architecture for Slack/Jira/Zendesk extensions.",
  "Audit trail through pipeline run logs and timeline events.",
];

export default function ArchitecturePage() {
  return (
    <main className="architecture-page container">
      <section className="architecture-shell architecture-hero">
        <p className="hero-eyebrow">OpsSignal AI</p>
        <h1>Architecture</h1>
        <p className="architecture-sub">From multimodal intake to evidence-backed incident updates</p>
      </section>

      <section className="archSection">
        <h2>System diagram</h2>
        <p className="section-sub">
          End-to-end data flow from noisy operational signals to explainable outputs.
        </p>
        <pre className="archDiagram">{`[Inputs: logs / screenshot / audio]
                |
                v
      [Ingestion: OCR + ASR]
                |
                v
 [Normalization: merged raw text]
                |
                v
[Triage: classify + entity extract]
                |
                v
[Enrichment: NVD / GitHub / Status]
                |
                v
[Generation: summary / actions / comms]
                |
                v
[Storage: Postgres + artifacts + pipeline_runs]
                |
                v
[Retrieval: pgvector similar incidents]
                |
                v
[UI: incident page + export + share view]`}</pre>
      </section>

      <section className="archSection">
        <h2>AI responsibilities</h2>
        <div className="archGrid">
          {aiResponsibilities.map((item) => (
            <article key={item.title} className="feature-card">
              <h3>{item.title}</h3>
              <p>
                <strong>Does:</strong> {item.does}
              </p>
              <p>
                <strong>Outputs:</strong> {item.outputs}
              </p>
              <p>
                <strong>Why it matters:</strong> {item.matters}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="archSection">
        <h2>Data model</h2>
        <div className="archGrid archGrid-2">
          {dataModel.map((item) => (
            <article key={item.table} className="feature-card">
              <h3>
                <span className="kbd">{item.table}</span>
              </h3>
              <p>{item.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="archSection">
        <h2>Reliability</h2>
        <div className="archGrid">
          {reliabilityCards.map((item) => (
            <article key={item.title} className="feature-card">
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="archSection">
        <h2>Scalability</h2>
        <div className="callout">
          <ul className="list-clean">
            {scalabilityPoints.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="architecture-shell archSection">
        <h2>Next step</h2>
        <p className="architecture-sub">
          Validate the flow with live incidents and inspect outputs across ingest, enrichment, and comms.
        </p>
        <div className="architecture-actions">
          <Link className="btn btn-primary" href="/incidents">
            Try the demo
          </Link>
          <Link className="btn btn-secondary" href="/incidents/new">
            Create an incident
          </Link>
        </div>
        <p className="section-sub">
          Download export: <span className="kbd">Open an incident</span> -&gt; <span className="kbd">Export</span>
        </p>
      </section>
    </main>
  );
}
