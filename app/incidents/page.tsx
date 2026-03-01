"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Badge from "@/components/Badge";
import Button from "@/components/Button";
import Card from "@/components/Card";
import Layout from "@/components/Layout";
import SearchInput from "@/components/SearchInput";
import Select from "@/components/Select";
import Toggle from "@/components/Toggle";

type IncidentListItem = {
  id: string;
  title: string | null;
  severity: string | null;
  category: string | null;
  routing_team: string | null;
  customer_impact?: boolean | null;
  created_at: string;
};

type IncidentListResponse = {
  items: IncidentListItem[];
};

type SortMode = "created_desc" | "created_asc" | "severity_desc";

const SEVERITY_VALUES = ["SEV1", "SEV2", "SEV3", "SEV4"] as const;
const CATEGORY_VALUES = ["OUTAGE", "DEGRADATION", "SECURITY", "DATA", "OTHER"] as const;
const severityRank: Record<string, number> = {
  SEV1: 0,
  SEV2: 1,
  SEV3: 2,
  SEV4: 3,
};

function normalizeUpper(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function normalizeCategory(value: string | null | undefined): string {
  const category = normalizeUpper(value);
  if (CATEGORY_VALUES.includes(category as (typeof CATEGORY_VALUES)[number])) {
    return category;
  }
  return "OTHER";
}

function incidentSearchText(incident: IncidentListItem): string {
  return [incident.title, incident.category, incident.severity, incident.routing_team].join(" ").toLowerCase();
}

export default function IncidentsListPage() {
  const router = useRouter();
  const [items, setItems] = useState<IncidentListItem[]>([]);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState<"seed" | "clear" | null>(null);
  const [demoNotice, setDemoNotice] = useState<string | null>(null);
  const [demoNoticeKind, setDemoNoticeKind] = useState<"ok" | "error" | null>(null);
  const [searchValue, setSearchValue] = useState("");
  const [severityFilter, setSeverityFilter] = useState("ALL");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [routingTeamFilter, setRoutingTeamFilter] = useState("ALL");
  const [impactOnly, setImpactOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("created_desc");
  const [deleteBusyId, setDeleteBusyId] = useState<string | null>(null);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  async function loadIncidents() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/incidents", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const data = (await res.json()) as IncidentListResponse;
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void loadIncidents();
  }, []);

  async function seedDemoIncidents() {
    setDemoBusy("seed");
    setDemoNotice(null);
    setDemoNoticeKind(null);
    try {
      const res = await fetch("/api/demo/seed", { method: "POST" });
      const data = (await res.json()) as { seeded?: number; error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to seed demo incidents.");
      }

      setDemoNotice(`Seeded ${data.seeded ?? 15} demo incidents`);
      setDemoNoticeKind("ok");
      await loadIncidents();
    } catch (e: unknown) {
      setDemoNotice(e instanceof Error ? e.message : String(e));
      setDemoNoticeKind("error");
    } finally {
      setDemoBusy(null);
    }
  }

  async function clearDemoIncidents() {
    setDemoBusy("clear");
    setDemoNotice(null);
    setDemoNoticeKind(null);
    try {
      const res = await fetch("/api/demo/seed", { method: "DELETE" });
      const data = (await res.json()) as { cleared?: number; error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to clear demo incidents.");
      }

      setDemoNotice(`Cleared ${data.cleared ?? 0} demo incidents`);
      setDemoNoticeKind("ok");
      await loadIncidents();
    } catch (e: unknown) {
      setDemoNotice(e instanceof Error ? e.message : String(e));
      setDemoNoticeKind("error");
    } finally {
      setDemoBusy(null);
    }
  }

  async function deleteIncident(incident: IncidentListItem) {
    const confirmation = window.prompt(
      `Delete incident "${incident.title ?? incident.id}"?\nType DELETE to confirm.`
    );
    if (confirmation !== "DELETE") {
      return;
    }

    setDeleteErr(null);
    setDeleteBusyId(incident.id);
    try {
      const res = await fetch(`/api/incidents/${incident.id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to delete incident.");
      }
      setItems((current) => current.filter((item) => item.id !== incident.id));
    } catch (error: unknown) {
      setDeleteErr(error instanceof Error ? error.message : String(error));
    } finally {
      setDeleteBusyId(null);
    }
  }

  const routingTeams = useMemo(() => {
    const set = new Set(
      items.map((item) => item.routing_team?.trim()).filter((value): value is string => Boolean(value))
    );
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filteredItems = useMemo(() => {
    const needle = searchValue.trim().toLowerCase();
    const output = items.filter((item) => {
      if (needle && !incidentSearchText(item).includes(needle)) {
        return false;
      }
      if (severityFilter !== "ALL" && normalizeUpper(item.severity) !== severityFilter) {
        return false;
      }
      if (categoryFilter !== "ALL" && normalizeCategory(item.category) !== categoryFilter) {
        return false;
      }
      if (routingTeamFilter !== "ALL" && (item.routing_team ?? "") !== routingTeamFilter) {
        return false;
      }
      if (impactOnly && item.customer_impact !== true) {
        return false;
      }
      return true;
    });

    output.sort((a, b) => {
      if (sortMode === "created_asc") {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      if (sortMode === "severity_desc") {
        const rankA = severityRank[normalizeUpper(a.severity)] ?? 99;
        const rankB = severityRank[normalizeUpper(b.severity)] ?? 99;
        if (rankA !== rankB) {
          return rankA - rankB;
        }
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return output;
  }, [categoryFilter, impactOnly, items, routingTeamFilter, searchValue, severityFilter, sortMode]);

  return (
    <Layout
      title="Incidents"
      subtitle="Latest incidents sorted by creation time."
      actions={
        <Button href="/incidents/new" variant="primary">
          New Incident
        </Button>
      }
    >
      <Card className="demo-actions-card">
        <div className="demo-actions">
          <Button variant="secondary" onClick={seedDemoIncidents} disabled={demoBusy !== null}>
            {demoBusy === "seed" ? "Seeding..." : "Seed demo incidents"}
          </Button>
          <Button variant="secondary" onClick={clearDemoIncidents} disabled={demoBusy !== null}>
            {demoBusy === "clear" ? "Clearing..." : "Clear demo incidents"}
          </Button>
        </div>
        {demoNotice ? (
          <p className={demoNoticeKind === "ok" ? "inline-ok" : "inline-error"}>{demoNotice}</p>
        ) : null}
      </Card>

      <Card className="filters-card">
        <div className="filter-grid">
          <SearchInput
            className="filter-search"
            value={searchValue}
            onDebouncedChange={setSearchValue}
            delayMs={250}
            placeholder="Search title, category, severity, routing team..."
          />

          <Select
            label="Severity"
            value={severityFilter}
            onChange={setSeverityFilter}
            options={[
              { value: "ALL", label: "All severities" },
              ...SEVERITY_VALUES.map((severity) => ({ value: severity, label: severity })),
            ]}
          />

          <Select
            label="Category"
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={[
              { value: "ALL", label: "All categories" },
              ...CATEGORY_VALUES.map((category) => ({ value: category, label: category })),
            ]}
          />

          <Select
            label="Routing team"
            value={routingTeamFilter}
            onChange={setRoutingTeamFilter}
            options={[
              { value: "ALL", label: "All teams" },
              ...routingTeams.map((team) => ({ value: team, label: team })),
            ]}
          />

          <Select
            label="Sort by"
            value={sortMode}
            onChange={(value) => setSortMode(value as SortMode)}
            options={[
              { value: "created_desc", label: "Created (newest first)" },
              { value: "created_asc", label: "Created (oldest first)" },
              { value: "severity_desc", label: "Severity (SEV1 first)" },
            ]}
          />

          <Toggle
            label="Customer impact"
            checked={impactOnly}
            onChange={setImpactOnly}
            className="filter-toggle"
          />
        </div>
      </Card>

      <Card>
        {busy ? <p className="muted">Loading incidents...</p> : null}
        {err ? <pre className="error-box">{err}</pre> : null}
        {deleteErr ? <p className="inline-error">{deleteErr}</p> : null}

        {!busy && !err ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Severity</th>
                  <th>Category</th>
                  <th>Routing Team</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((incident) => (
                  <tr
                    key={incident.id}
                    className="table-row-link"
                    onClick={() => router.push(`/incidents/${incident.id}`)}
                  >
                    <td>{incident.title ?? "Untitled incident"}</td>
                    <td>
                      {incident.severity ? (
                        <Badge kind="severity" value={incident.severity} />
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </td>
                    <td>
                      {incident.category ? (
                        <Badge kind="category" value={incident.category} />
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </td>
                    <td>{incident.routing_team ?? "-"}</td>
                    <td>{new Date(incident.created_at).toLocaleString()}</td>
                    <td>
                      <Button
                        variant="danger"
                        className="btn-delete-inline"
                        disabled={deleteBusyId !== null}
                        onClick={(event) => {
                          event.stopPropagation();
                          void deleteIncident(incident);
                        }}
                      >
                        {deleteBusyId === incident.id ? "Deleting..." : "Delete"}
                      </Button>
                    </td>
                  </tr>
                ))}

                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="muted">
                      No incidents match your filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
    </Layout>
  );
}
