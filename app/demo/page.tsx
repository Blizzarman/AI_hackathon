"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import Button from "@/components/Button";
import Card from "@/components/Card";
import Layout from "@/components/Layout";

type IncidentItem = {
  id: string;
  title: string | null;
  severity: string | null;
  category: string | null;
  routing_team: string | null;
  customer_impact?: boolean | null;
  created_at: string;
};

type IncidentsResponse = {
  items?: IncidentItem[];
  error?: string;
};

type SeedResponse = {
  seeded?: number;
  error?: string;
};

type IncidentCapabilities = {
  investigate: boolean | null;
  update: boolean | null;
  similar: boolean | null;
  exportMd: boolean | null;
  share: boolean | null;
};

function emptyCapabilities(): IncidentCapabilities {
  return {
    investigate: null,
    update: null,
    similar: null,
    exportMd: null,
    share: null,
  };
}

function parseJsonSafe(raw: string): unknown | null {
  if (!raw.trim()) {
    return null;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function payloadError(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (!("error" in payload)) {
    return null;
  }
  const error = (payload as { error?: unknown }).error;
  return typeof error === "string" && error.trim() ? error : null;
}

function sortNewest(items: IncidentItem[]): IncidentItem[] {
  return [...items].sort((a, b) => {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

async function probeRoute(url: string, method: "HEAD" | "GET" | "OPTIONS" = "GET"): Promise<boolean> {
  try {
    const res = await fetch(url, { method, cache: "no-store" });
    return res.status !== 404;
  } catch {
    return false;
  }
}

export default function GuidedDemoPage() {
  const [seedSupported, setSeedSupported] = useState<boolean | null>(null);
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedNotice, setSeedNotice] = useState<{ kind: "ok" | "error"; message: string } | null>(null);

  const [incidents, setIncidents] = useState<IncidentItem[]>([]);
  const [incidentsBusy, setIncidentsBusy] = useState(false);
  const [incidentsError, setIncidentsError] = useState<string | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState("");

  const [capabilities, setCapabilities] = useState<IncidentCapabilities>(emptyCapabilities());
  const [capabilitiesBusy, setCapabilitiesBusy] = useState(false);

  const loadIncidents = useCallback(async () => {
    setIncidentsBusy(true);
    setIncidentsError(null);

    try {
      const res = await fetch("/api/incidents", { cache: "no-store" });
      const raw = await res.text();
      const payload = parseJsonSafe(raw) as IncidentsResponse | null;

      if (!res.ok) {
        throw new Error(payloadError(payload) ?? `Failed to load incidents (${res.status}).`);
      }

      const items = Array.isArray(payload?.items) ? sortNewest(payload.items) : [];
      setIncidents(items);
      setSelectedIncidentId((previous) => {
        if (previous && items.some((item) => item.id === previous)) {
          return previous;
        }
        return items[0]?.id ?? "";
      });
    } catch (error: unknown) {
      setIncidentsError(error instanceof Error ? error.message : String(error));
      setIncidents([]);
      setSelectedIncidentId("");
    } finally {
      setIncidentsBusy(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const supported = await probeRoute("/api/demo/seed", "OPTIONS");
      if (active) {
        setSeedSupported(supported);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void loadIncidents();
  }, [loadIncidents]);

  useEffect(() => {
    if (!selectedIncidentId) {
      setCapabilities(emptyCapabilities());
      setCapabilitiesBusy(false);
      return;
    }

    let active = true;
    setCapabilities(emptyCapabilities());
    setCapabilitiesBusy(true);

    (async () => {
      const base = `/api/incidents/${selectedIncidentId}`;
      const [investigate, update, similar, exportMd, share] = await Promise.all([
        probeRoute(`${base}/investigate`, "OPTIONS"),
        probeRoute(`${base}/update`, "OPTIONS"),
        probeRoute(`${base}/similar`, "GET"),
        probeRoute(`${base}/export.md`, "GET"),
        probeRoute(`/share/${selectedIncidentId}`, "GET"),
      ]);

      if (!active) {
        return;
      }

      setCapabilities({ investigate, update, similar, exportMd, share });
      setCapabilitiesBusy(false);
    })().catch(() => {
      if (!active) {
        return;
      }
      setCapabilities({
        investigate: false,
        update: false,
        similar: false,
        exportMd: false,
        share: false,
      });
      setCapabilitiesBusy(false);
    });

    return () => {
      active = false;
    };
  }, [selectedIncidentId]);

  const selectedIncident = useMemo(() => {
    return incidents.find((item) => item.id === selectedIncidentId) ?? null;
  }, [incidents, selectedIncidentId]);

  const incidentHref = selectedIncident ? `/incidents/${selectedIncident.id}` : "/incidents";

  async function onSeedDemo() {
    if (!seedSupported) {
      setSeedNotice({
        kind: "error",
        message: "Seed endpoint is unavailable. Create an incident manually.",
      });
      return;
    }

    setSeedBusy(true);
    setSeedNotice(null);

    try {
      const res = await fetch("/api/demo/seed", { method: "POST" });
      const raw = await res.text();
      const payload = parseJsonSafe(raw) as SeedResponse | null;

      if (res.status === 404) {
        setSeedSupported(false);
        throw new Error("Seed endpoint not found. Use Create incident as fallback.");
      }

      if (!res.ok) {
        throw new Error(payloadError(payload) ?? `Seeding failed (${res.status}).`);
      }

      const seeded = typeof payload?.seeded === "number" ? payload.seeded : null;
      const seededMessage = seeded === null ? "Seeded demo incidents." : `Seeded demo incidents (${seeded}).`;
      setSeedNotice({ kind: "ok", message: seededMessage });
      await loadIncidents();
    } catch (error: unknown) {
      setSeedNotice({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSeedBusy(false);
    }
  }

  return (
    <Layout
      title="Guided Demo"
      subtitle="A 3-minute walkthrough of multimodal triage + investigation + comms"
      actions={
        <>
          <Button href="/incidents" variant="secondary">
            Open incidents
          </Button>
          <Button href="/incidents/new" variant="primary">
            Create incident
          </Button>
        </>
      }
    >
      <Card>
        <p className="muted">
          Use these six steps in order. Each step points to the exact action and what judges should verify.
        </p>
      </Card>

      <section className="demoSteps" aria-label="Guided demo steps">
        <article className="stepCard">
          <div className="stepNum" aria-hidden="true">
            1
          </div>
          <div>
            <h2 className="stepTitle">Seed demo incidents</h2>
            <p className="note">Load realistic incidents quickly so the rest of the walkthrough has data.</p>
            <div className="stepActions">
              {seedSupported === null ? (
                <Button variant="secondary" disabled>
                  Checking seed route...
                </Button>
              ) : seedSupported ? (
                <Button variant="primary" onClick={onSeedDemo} disabled={seedBusy}>
                  {seedBusy ? "Seeding..." : "Seed demo incidents"}
                </Button>
              ) : (
                <Button href="/incidents/new" variant="secondary">
                  Create incident manually
                </Button>
              )}
            </div>
            {seedNotice ? (
              <p className={seedNotice.kind === "ok" ? "inline-ok" : "inline-error"}>
                {seedNotice.message}{" "}
                {seedNotice.kind === "ok" ? <Link href="/incidents">Open incidents</Link> : null}
              </p>
            ) : null}
            {seedSupported === false ? (
              <p className="note">Fallback enabled because `/api/demo/seed` returned 404.</p>
            ) : null}
            <ul className="list-clean">
              <li>Incidents list populates immediately.</li>
              <li>Varied severities and categories appear in badges.</li>
              <li>You can continue manually if seed API is unavailable.</li>
            </ul>
          </div>
        </article>

        <article className="stepCard">
          <div className="stepNum" aria-hidden="true">
            2
          </div>
          <div>
            <h2 className="stepTitle">Find incidents fast</h2>
            <p className="note">Open the incident table and demonstrate discovery speed for triage workflows.</p>
            <div className="stepActions">
              <Button href="/incidents" variant="primary">
                Open incidents list
              </Button>
            </div>
            <ul className="list-clean">
              <li>Search input filters title/category/severity/routing team.</li>
              <li>Severity/category badges make prioritization obvious.</li>
              <li>Customer-impact filter narrows urgent cases.</li>
            </ul>
          </div>
        </article>

        <article className="stepCard">
          <div className="stepNum" aria-hidden="true">
            3
          </div>
          <div>
            <h2 className="stepTitle">Open an incident</h2>
            <p className="note">Select a recent incident and jump directly to the detail workspace.</p>

            {incidentsError ? <p className="inline-error">{incidentsError}</p> : null}

            {incidents.length > 0 ? (
              <div className="field">
                <label className="field-label" htmlFor="demo-incident-select">
                  Latest incidents
                </label>
                <select
                  id="demo-incident-select"
                  className="input"
                  value={selectedIncidentId}
                  onChange={(event) => setSelectedIncidentId(event.target.value)}
                >
                  {incidents.map((incident) => (
                    <option key={incident.id} value={incident.id}>
                      {(incident.title ?? "Untitled incident").trim() || "Untitled incident"} - {incident.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <p className="note">No incidents found yet. Seed data or create one manually.</p>
            )}

            <div className="stepActions">
              <Button href={selectedIncident ? `/incidents/${selectedIncident.id}` : "/incidents/new"} variant="primary">
                {selectedIncident ? "Open selected incident" : "Create your first incident"}
              </Button>
              <Button variant="secondary" onClick={() => void loadIncidents()} disabled={incidentsBusy}>
                {incidentsBusy ? "Refreshing..." : "Refresh incidents"}
              </Button>
            </div>

            <ul className="list-clean">
              <li>Summary and next actions are generated from raw intake.</li>
              <li>Timeline and pipeline logs show end-to-end traceability.</li>
              <li>Similar incidents section demonstrates RAG retrieval via pgvector.</li>
            </ul>
          </div>
        </article>

        <article className="stepCard">
          <div className="stepNum" aria-hidden="true">
            4
          </div>
          <div>
            <h2 className="stepTitle">Investigation Copilot</h2>
            <p className="note">Run investigation to generate hypotheses, tool checks, and merged evidence.</p>

            <div className="stepActions">
              {selectedIncident && capabilities.investigate !== false ? (
                <Button href={`${incidentHref}#investigation-note-input`} variant="primary">
                  Open investigation section
                </Button>
              ) : null}
            </div>

            {!selectedIncident ? <p className="note">Select an incident in Step 3 first.</p> : null}
            {selectedIncident && capabilitiesBusy ? <p className="note">Checking investigation endpoint...</p> : null}
            {selectedIncident && !capabilitiesBusy && capabilities.investigate === false ? (
              <p className="note">`/api/incidents/[id]/investigate` returned 404. Open the incident and continue manually.</p>
            ) : null}

            <ul className="list-clean">
              <li>Hypotheses list updates based on incident context.</li>
              <li>Tool results include structured evidence for each check.</li>
              <li>Next actions are rewritten using investigation findings.</li>
            </ul>
          </div>
        </article>

        <article className="stepCard">
          <div className="stepNum" aria-hidden="true">
            5
          </div>
          <div>
            <h2 className="stepTitle">Generate updates</h2>
            <p className="note">Draft internal and external updates directly from the current incident state.</p>

            <div className="stepActions">
              {selectedIncident && capabilities.update !== false ? (
                <Button href={`${incidentHref}#update-note-input`} variant="primary">
                  Open update generator
                </Button>
              ) : null}
            </div>

            {!selectedIncident ? <p className="note">Select an incident in Step 3 first.</p> : null}
            {selectedIncident && capabilitiesBusy ? <p className="note">Checking update endpoint...</p> : null}
            {selectedIncident && !capabilitiesBusy && capabilities.update === false ? (
              <p className="note">`/api/incidents/[id]/update` returned 404. Use incident notes as a manual fallback.</p>
            ) : null}

            <ul className="list-clean">
              <li>Internal update is action-focused and operational.</li>
              <li>External update is customer-safe and concise.</li>
              <li>Timeline gets a new event after generation.</li>
            </ul>
          </div>
        </article>

        <article className="stepCard">
          <div className="stepNum" aria-hidden="true">
            6
          </div>
          <div>
            <h2 className="stepTitle">Export + Share</h2>
            <p className="note">Package results for stakeholders and provide a read-only share view.</p>

            <div className="stepActions">
              {selectedIncident && capabilities.exportMd ? (
                <Button href={`/api/incidents/${selectedIncident.id}/export.md`} variant="primary" download>
                  Download markdown export
                </Button>
              ) : null}

              {selectedIncident && capabilities.share ? (
                <Button href={`/share/${selectedIncident.id}`} variant="secondary">
                  Open share view
                </Button>
              ) : null}

              {selectedIncident && capabilities.similar !== false ? (
                <Button href={incidentHref} variant="secondary">
                  Review similar incidents
                </Button>
              ) : null}
            </div>

            {!selectedIncident ? <p className="note">Select an incident in Step 3 first.</p> : null}
            {selectedIncident && capabilitiesBusy ? <p className="note">Checking export/share routes...</p> : null}
            {selectedIncident && !capabilitiesBusy && !capabilities.exportMd && !capabilities.share ? (
              <p className="note">Export and share actions are hidden because routes returned 404.</p>
            ) : null}

            <ul className="list-clean">
              <li>Markdown export captures summary, actions, timeline, and artifacts.</li>
              <li>Share view is read-only for safe stakeholder access.</li>
              <li>If needed: open an incident and use the built-in Export buttons.</li>
            </ul>
          </div>
        </article>
      </section>
    </Layout>
  );
}

