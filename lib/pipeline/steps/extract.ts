import { EntitiesSchema } from "@/lib/schema";
import { hfTextGenerate } from "@/lib/hf/client";
import { safeModelJson } from "@/lib/ai/safe-model-json";

const MODEL = process.env.HF_TEXT_MODEL;
const TOKEN = process.env.HF_TOKEN;
const CVE_REGEX = /\bCVE-\d{4}-\d{4,}\b/gi;

function requireEnv(value: string | undefined, key: string): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function fallbackEntities(rawText: string) {
  const issueRegex = /\B#\d+\b/g;

  const cves = Array.from(new Set(rawText.match(CVE_REGEX) ?? []));
  const issueRefs = Array.from(new Set(rawText.match(issueRegex) ?? []));

  return EntitiesSchema.parse({
    systems: [],
    regions: [],
    error_codes: [],
    vendors: [],
    cves,
    security_signal: cves.length > 0,
    timestamps: [],
    issue_refs: issueRefs,
  });
}

function hasSecuritySignal(rawText: string, cves: string[]): boolean {
  CVE_REGEX.lastIndex = 0;
  return cves.length > 0 || CVE_REGEX.test(rawText);
}

export async function stepExtract(rawText: string) {
  const model = requireEnv(MODEL, "HF_TEXT_MODEL");
  const token = requireEnv(TOKEN, "HF_TOKEN");

  const prompt = `
Extract entities from incident text.
Return ONLY valid JSON matching:
{
 "systems": string[],
 "regions": string[],
 "error_codes": string[],
 "vendors": string[],
 "cves": string[],
 "security_signal": boolean,
 "timestamps": string[],
 "issue_refs": string[]
}

Rules:
- CVEs must match CVE-YYYY-NNNN+
- issue_refs include patterns like "#123" or "ORG/REPO#123"

Text:
${rawText.slice(0, 12000)}
`;

  try {
    const output = await hfTextGenerate(model, token, prompt);
    const parsed = await safeModelJson(output, {
      retry: (repairPrompt) => hfTextGenerate(model, token, repairPrompt),
      parse: (value) => EntitiesSchema.parse(value),
    });
    return EntitiesSchema.parse({
      ...parsed,
      security_signal: parsed.security_signal || hasSecuritySignal(rawText, parsed.cves),
    });
  } catch {
    return fallbackEntities(rawText);
  }
}
