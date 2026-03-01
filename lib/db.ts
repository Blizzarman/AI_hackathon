import { Pool } from "pg";

export type PipelineStepLog = {
  name: string;
  ms: number;
  ok: boolean;
  meta?: Record<string, unknown>;
  error?: string;
};

export type IncidentInsertRow = {
  title: string;
  severity: string;
  category: string;
  routing_team: string;
  customer_impact: boolean;
  summary_md: string;
  next_actions_md: string;
  comms_internal: string;
  comms_external: string;
  entities_json: unknown;
  enrichment_json: unknown;
  raw_text: string;
  embedding: number[];
};

type IncidentQueryRow = {
  id: string;
  created_at: Date | string;
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
  embedding: unknown;
};

type SimilarIncidentRow = {
  id: string;
  title: string | null;
  severity: string | null;
  category: string | null;
  summary_md: string | null;
  score: number;
};

type PipelineRunRow = {
  id: string;
  created_at: Date | string;
  steps_json: unknown;
};

type TimelineEventRow = {
  id: string;
  incident_id: string;
  created_at: Date | string;
  type: TimelineEventType;
  message: string;
  meta: unknown;
};

type ArtifactRow = {
  id: string;
  incident_id: string;
  kind: string;
  mime: string | null;
  content: string | null;
  created_at: Date | string;
};

type IncidentListRow = {
  id: string;
  title: string | null;
  severity: string | null;
  category: string | null;
  routing_team: string | null;
  customer_impact: boolean | null;
  created_at: Date | string;
};

type EmbeddingDimensionRow = {
  atttypmod: number;
  embedding_type: string | null;
};

export type IncidentListItem = {
  id: string;
  title: string | null;
  severity: string | null;
  category: string | null;
  routing_team: string | null;
  customer_impact: boolean | null;
  created_at: string;
};

export type PipelineRunStepRow = {
  run_id: string;
  run_created_at: string;
  name: string;
  ms: number;
  ok: boolean;
  error: string | null;
  meta?: Record<string, unknown>;
};

export type TimelineEventType =
  | "INGEST"
  | "TRIAGE"
  | "ENRICH"
  | "UPDATE_INTERNAL"
  | "UPDATE_EXTERNAL"
  | "NOTE";

export type TimelineEventItem = {
  id: string;
  incident_id: string;
  created_at: string;
  type: TimelineEventType;
  message: string;
  meta: Record<string, unknown>;
};

export type ArtifactItem = {
  id: string;
  incident_id: string;
  kind: string;
  mime: string | null;
  content: string;
  created_at: string;
};

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

let cachedIncidentEmbeddingDimension: number | null = null;

function normalizeIsoDate(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(value).toISOString();
}

function toVectorString(values: number[]): string {
  return `[${values.join(",")}]`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function validateEmbeddingLength(embedding: number[], expectedDimension: number) {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("Embedding must be a non-empty number array.");
  }
  if (!embedding.every(isFiniteNumber)) {
    throw new Error("Embedding contains non-finite values.");
  }
  if (embedding.length !== expectedDimension) {
    throw new Error(
      `Embedding dimension mismatch: expected ${expectedDimension}, got ${embedding.length}.`
    );
  }
}

export async function getIncidentEmbeddingDimension(): Promise<number> {
  if (cachedIncidentEmbeddingDimension !== null) {
    return cachedIncidentEmbeddingDimension;
  }

  const query = `
    SELECT
      a.atttypmod,
      format_type(a.atttypid, a.atttypmod) AS embedding_type
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'incidents'
      AND a.attname = 'embedding'
      AND n.nspname = current_schema()
    LIMIT 1
  `;
  const res = await pool.query<EmbeddingDimensionRow>(query);
  const atttypmod = res.rows[0]?.atttypmod;
  const embeddingType = res.rows[0]?.embedding_type ?? "";

  const typeMatch = embeddingType.match(/^vector\((\d+)\)$/i);
  if (typeMatch) {
    const dimensionFromType = Number(typeMatch[1]);
    if (Number.isInteger(dimensionFromType) && dimensionFromType > 0) {
      cachedIncidentEmbeddingDimension = dimensionFromType;
      return dimensionFromType;
    }
  }

  if (!Number.isInteger(atttypmod)) {
    throw new Error("Could not read incidents.embedding vector metadata from PostgreSQL.");
  }

  // Fallback for environments where format_type is unavailable/unexpected.
  // Different pgvector/pg versions can expose typmod with or without the +4 offset.
  const typmod = Number(atttypmod);
  const candidates = [typmod, typmod - 4].filter((value) => Number.isInteger(value) && value > 0);
  const dimension = candidates[0];

  if (!dimension) {
    throw new Error(
      "incidents.embedding is not a fixed-dimension vector. Expected vector(N) column."
    );
  }

  cachedIncidentEmbeddingDimension = dimension;
  return dimension;
}

export async function insertIncident(row: IncidentInsertRow) {
  const expectedDimension = await getIncidentEmbeddingDimension();
  validateEmbeddingLength(row.embedding, expectedDimension);

  const query = `
    INSERT INTO incidents
      (title, severity, category, routing_team, customer_impact, summary_md, next_actions_md, comms_internal, comms_external, entities_json, enrichment_json, raw_text, embedding)
    VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::vector)
    RETURNING id
  `;

  const values = [
    row.title,
    row.severity,
    row.category,
    row.routing_team,
    row.customer_impact,
    row.summary_md,
    row.next_actions_md,
    row.comms_internal,
    row.comms_external,
    row.entities_json,
    row.enrichment_json,
    row.raw_text,
    toVectorString(row.embedding),
  ];

  const res = await pool.query<{ id: string }>(query, values);
  return res.rows[0].id;
}

export async function getIncident(id: string) {
  const res = await pool.query<IncidentQueryRow>("SELECT * FROM incidents WHERE id = $1", [id]);
  return res.rows[0] ?? null;
}

function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const maybe = error as { code?: string };
  return maybe.code === "42P01";
}

export async function deleteIncidentById(id: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    try {
      await client.query("DELETE FROM incident_timeline WHERE incident_id = $1", [id]);
    } catch (error: unknown) {
      if (!isMissingRelationError(error)) {
        throw error;
      }
    }

    await client.query("DELETE FROM artifacts WHERE incident_id = $1", [id]);
    await client.query("DELETE FROM pipeline_runs WHERE incident_id = $1", [id]);
    const res = await client.query<{ id: string }>(
      "DELETE FROM incidents WHERE id = $1 RETURNING id",
      [id]
    );

    await client.query("COMMIT");
    return (res.rowCount ?? 0) > 0;
  } catch (error: unknown) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateIncidentComms(
  incidentId: string,
  target: "internal" | "external",
  content: string
) {
  const normalizedContent = content.trim();
  if (!normalizedContent) {
    throw new Error("Generated update content is empty.");
  }

  const column = target === "internal" ? "comms_internal" : "comms_external";
  await pool.query(`UPDATE incidents SET ${column} = $2 WHERE id = $1`, [incidentId, normalizedContent]);
}

export async function appendIncidentInvestigation(params: {
  incidentId: string;
  updatedNextActionsMd: string;
  investigationEntry: Record<string, unknown>;
}) {
  const nextActions = params.updatedNextActionsMd.trim();
  if (!nextActions) {
    throw new Error("Updated next actions content is empty.");
  }

  await pool.query(
    `
      UPDATE incidents
      SET
        next_actions_md = $2,
        enrichment_json = jsonb_set(
          COALESCE(enrichment_json, '{}'::jsonb),
          '{investigation}',
          (
            CASE
              WHEN jsonb_typeof(COALESCE(enrichment_json, '{}'::jsonb)->'investigation') = 'array'
                THEN COALESCE(enrichment_json, '{}'::jsonb)->'investigation'
              ELSE '[]'::jsonb
            END
          ) || $3::jsonb,
          true
        )
      WHERE id = $1
    `,
    [params.incidentId, nextActions, JSON.stringify(params.investigationEntry)]
  );
}

export async function listIncidents(limit = 50): Promise<IncidentListItem[]> {
  const max = Math.min(Math.max(limit, 1), 200);
  const res = await pool.query<IncidentListRow>(
    `
      SELECT id, title, severity, category, routing_team, customer_impact, created_at
      FROM incidents
      ORDER BY created_at DESC
      LIMIT $1
    `,
    [max]
  );

  return res.rows.map((row) => ({
    id: row.id,
    title: row.title,
    severity: row.severity,
    category: row.category,
    routing_team: row.routing_team,
    customer_impact: row.customer_impact,
    created_at: normalizeIsoDate(row.created_at),
  }));
}

export async function similarIncidents(embedding: number[], limit = 5) {
  const expectedDimension = await getIncidentEmbeddingDimension();
  validateEmbeddingLength(embedding, expectedDimension);

  const res = await pool.query<SimilarIncidentRow>(
    `
      SELECT id, title, severity, category, summary_md,
             1 - (embedding <=> $1::vector) AS score
      FROM incidents
      ORDER BY embedding <=> $1::vector
      LIMIT $2
    `,
    [toVectorString(embedding), limit]
  );

  return res.rows;
}

export async function insertRun(incidentId: string, steps: PipelineStepLog[]) {
  await pool.query(
    "INSERT INTO pipeline_runs (incident_id, steps_json) VALUES ($1, $2::jsonb)",
    [incidentId, JSON.stringify(steps)]
  );
}

export async function insertArtifact(
  incidentId: string,
  kind: string,
  mime: string | null,
  content: string
) {
  const normalizedKind = kind.trim();
  const normalizedMime = mime?.trim() || null;
  const normalizedContent = content;

  if (!normalizedKind) {
    throw new Error("Artifact kind is required.");
  }

  const res = await pool.query<{ id: string }>(
    `
      INSERT INTO artifacts (incident_id, kind, mime, content)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `,
    [incidentId, normalizedKind, normalizedMime, normalizedContent]
  );

  return res.rows[0]?.id ?? null;
}

export async function getArtifacts(incidentId: string): Promise<ArtifactItem[]> {
  const res = await pool.query<ArtifactRow>(
    `
      SELECT id, incident_id, kind, mime, content, created_at
      FROM artifacts
      WHERE incident_id = $1
      ORDER BY created_at ASC
    `,
    [incidentId]
  );

  return res.rows.map((row) => ({
    id: row.id,
    incident_id: row.incident_id,
    kind: row.kind,
    mime: row.mime,
    content: row.content ?? "",
    created_at: normalizeIsoDate(row.created_at),
  }));
}

export async function clearDemoIncidents(): Promise<number> {
  const res = await pool.query<{ id: string }>(
    `
      DELETE FROM incidents
      WHERE enrichment_json @> '{"demo": true}'::jsonb
         OR title LIKE '[DEMO]%'
      RETURNING id
    `
  );

  return res.rows.length;
}

export async function insertTimelineEvent(params: {
  incidentId: string;
  type: TimelineEventType;
  message: string;
  meta?: Record<string, unknown>;
}) {
  const message = params.message.trim();
  if (!message) {
    throw new Error("Timeline event message is required.");
  }

  const res = await pool.query<{ id: string }>(
    `
      INSERT INTO incident_timeline (incident_id, type, message, meta)
      VALUES ($1, $2, $3, $4::jsonb)
      RETURNING id
    `,
    [params.incidentId, params.type, message, JSON.stringify(params.meta ?? {})]
  );

  return res.rows[0]?.id ?? null;
}

export async function listTimelineEvents(
  incidentId: string,
  limit = 100
): Promise<TimelineEventItem[]> {
  const max = Math.min(Math.max(limit, 1), 500);
  const res = await pool.query<TimelineEventRow>(
    `
      SELECT id, incident_id, created_at, type, message, meta
      FROM incident_timeline
      WHERE incident_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [incidentId, max]
  );

  return res.rows.map((row) => ({
    id: row.id,
    incident_id: row.incident_id,
    created_at: normalizeIsoDate(row.created_at),
    type: row.type,
    message: row.message,
    meta: row.meta && typeof row.meta === "object" ? (row.meta as Record<string, unknown>) : {},
  }));
}

export async function listPipelineRunSteps(
  incidentId: string,
  limitRuns = 20
): Promise<PipelineRunStepRow[]> {
  const res = await pool.query<PipelineRunRow>(
    `
      SELECT id, created_at, steps_json
      FROM pipeline_runs
      WHERE incident_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [incidentId, limitRuns]
  );

  const out: PipelineRunStepRow[] = [];
  for (const run of res.rows) {
    const runCreatedAt = normalizeIsoDate(run.created_at);
    const rawSteps = Array.isArray(run.steps_json) ? run.steps_json : [];

    for (const step of rawSteps) {
      if (!step || typeof step !== "object") {
        continue;
      }

      const item = step as Record<string, unknown>;
      const name = typeof item.name === "string" ? item.name : "unknown";
      const ms = isFiniteNumber(item.ms) ? item.ms : 0;
      const ok = Boolean(item.ok);
      const error = typeof item.error === "string" ? item.error : null;
      const meta = item.meta && typeof item.meta === "object" ? (item.meta as Record<string, unknown>) : undefined;

      out.push({
        run_id: run.id,
        run_created_at: runCreatedAt,
        name,
        ms,
        ok,
        error,
        meta,
      });
    }
  }

  return out;
}
