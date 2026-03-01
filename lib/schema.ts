import { z } from "zod";

export const IncidentInputSchema = z.object({
  title: z.string().optional(),
  pastedText: z.string().optional(),
  screenshotBase64: z.string().optional(),
  audioBase64: z.string().optional(),
  githubRepo: z.string().optional(),
});

export const EntitiesSchema = z.object({
  systems: z.array(z.string()).default([]),
  regions: z.array(z.string()).default([]),
  error_codes: z.array(z.string()).default([]),
  vendors: z.array(z.string()).default([]),
  cves: z.array(z.string()).default([]),
  security_signal: z.boolean().default(false),
  timestamps: z.array(z.string()).default([]),
  issue_refs: z.array(z.string()).default([]),
});

export const AiRationaleSchema = z.object({
  signals: z.array(z.string()).default([]),
  reasoning: z.string().default(""),
  missing_info: z.array(z.string()).default([]),
  confidence: z.enum(["low", "medium", "high"]).default("low"),
});

export const ClassificationSchema = z.object({
  severity: z.enum(["SEV1", "SEV2", "SEV3", "SEV4"]).default("SEV3"),
  category: z.enum(["OUTAGE", "DEGRADATION", "SECURITY", "DATA", "OTHER"]).default("OTHER"),
  routing_team: z.string().default("ops"),
  customer_impact: z.boolean().default(false),
  title: z.string().default("Untitled incident"),
  rationale: AiRationaleSchema.default({
    signals: [],
    reasoning: "",
    missing_info: [],
    confidence: "low",
  }),
});

export const GeneratedOutputsSchema = z.object({
  summary_md: z.string(),
  next_actions_md: z.string(),
  comms_internal: z.string(),
  comms_external: z.string(),
});

export const PipelineResultSchema = z.object({
  raw_text: z.string(),
  classification: ClassificationSchema,
  entities: EntitiesSchema,
  enrichment: z.record(z.string(), z.unknown()).default({}),
  generated: GeneratedOutputsSchema,
});

export type IncidentInput = z.infer<typeof IncidentInputSchema>;
export type AiRationale = z.infer<typeof AiRationaleSchema>;
export type Classification = z.infer<typeof ClassificationSchema>;
export type Entities = z.infer<typeof EntitiesSchema>;
export type GeneratedOutputs = z.infer<typeof GeneratedOutputsSchema>;
export type PipelineResult = z.infer<typeof PipelineResultSchema>;
