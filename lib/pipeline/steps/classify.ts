import { ClassificationSchema, type AiRationale, type Classification } from "@/lib/schema";
import { hfTextGenerate } from "@/lib/hf/client";
import { safeModelJson } from "@/lib/ai/safe-model-json";

const MODEL = process.env.HF_TEXT_MODEL;
const TOKEN = process.env.HF_TOKEN;

function requireEnv(value: string | undefined, key: string): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function inferOperationalCategory(rawText: string): "OUTAGE" | "DEGRADATION" | null {
  const hasOutageSignal =
    /\boutage\b/i.test(rawText) ||
    /\bdown\b/i.test(rawText) ||
    /\bunavailable\b/i.test(rawText) ||
    /cannot access/i.test(rawText) ||
    /\b502\b/.test(rawText) ||
    /\b503\b/.test(rawText) ||
    /\b504\b/.test(rawText);

  const hasDegradationSignal =
    /\bdegradation\b/i.test(rawText) ||
    /\bdegraded\b/i.test(rawText) ||
    /\blatency\b/i.test(rawText) ||
    /\btimeout(?:s)?\b/i.test(rawText) ||
    /\brestart(?:ed|ing|s)?\b/i.test(rawText) ||
    /\bslow\b/i.test(rawText);

  if (!hasOutageSignal && !hasDegradationSignal) {
    return null;
  }
  if (hasOutageSignal && !hasDegradationSignal) {
    return "OUTAGE";
  }
  if (!hasOutageSignal && hasDegradationSignal) {
    return "DEGRADATION";
  }

  if (/\blatency\b/i.test(rawText) || /\btimeout(?:s)?\b/i.test(rawText)) {
    return "DEGRADATION";
  }
  return "OUTAGE";
}

function hasExplicitSecurityContext(rawText: string): boolean {
  if (/\bsecurity\b/i.test(rawText)) {
    return true;
  }

  return /\b(vulnerability|exploit|intrusion|unauthorized|breach|compromis|malware|ransomware)\b/i.test(
    rawText
  );
}

function uniqueNonEmpty(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of values) {
    const value = item.trim();
    if (!value) {
      continue;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(value);
  }
  return out;
}

function firstMatch(rawText: string, regex: RegExp): string | null {
  const match = regex.exec(rawText);
  if (!match) {
    return null;
  }
  return (match[1] ?? match[0] ?? "").trim() || null;
}

function buildGroundedSignals(rawText: string): string[] {
  const signals: string[] = [];
  const httpCode = firstMatch(rawText, /\b(5\d\d)\b/);
  const latencyWord = firstMatch(rawText, /\b(timeout(?:s)?|latency|slow|degraded?)\b/i);
  const errorWord = firstMatch(rawText, /\b(error|exception|failed|failure|unavailable|down)\b/i);
  const cve = firstMatch(rawText, /\b(CVE-\d{4}-\d{4,7})\b/i);
  const region = firstMatch(
    rawText,
    /\b((?:us|eu|ap|sa|ca|me|af)-(?:north|south|east|west|central|southeast|northeast|southwest|northwest)-\d)\b/i
  );
  const changeWord = firstMatch(rawText, /\b(restart(?:ed|ing|s)?|rollback|deploy(?:ed|ment)?)\b/i);

  if (httpCode) {
    signals.push(`HTTP status signal: "${httpCode}"`);
  }
  if (latencyWord) {
    signals.push(`Performance signal: "${latencyWord}"`);
  }
  if (errorWord) {
    signals.push(`Failure signal: "${errorWord}"`);
  }
  if (cve) {
    signals.push(`Security signal: "${cve}"`);
  }
  if (region) {
    signals.push(`Region signal: "${region}"`);
  }
  if (changeWord) {
    signals.push(`Change signal: "${changeWord}"`);
  }

  return uniqueNonEmpty(signals).slice(0, 6);
}

function buildMissingInfo(rawText: string, category: Classification["category"]): string[] {
  const missing: string[] = [];

  if (!/\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?(?:AM|PM|UTC|Z))?\b|\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/i.test(rawText)) {
    missing.push("Confirm exact incident start time in UTC.");
  }
  if (!/\b(deploy(?:ed|ment)?|release|rollback|roll back|change window)\b/i.test(rawText)) {
    missing.push("Confirm whether a deploy or config change happened near onset.");
  }
  if (
    !/\b(?:us|eu|ap|sa|ca|me|af)-(?:north|south|east|west|central|southeast|northeast|southwest|northwest)-\d\b/i.test(
      rawText
    )
  ) {
    missing.push("Confirm affected region(s) and blast radius.");
  }
  if (!/\b(4\d\d|5\d\d|[A-Z]{2,}(?:[_-][A-Z0-9]{2,})+)\b/.test(rawText)) {
    missing.push("Collect one representative error code or stack fragment.");
  }
  if (category === "SECURITY" && !/\b(CVE-\d{4}-\d{4,7}|ioc|indicator|unauthorized|intrusion)\b/i.test(rawText)) {
    missing.push("Validate security scope with IOC/CVE or concrete auth evidence.");
  }

  return uniqueNonEmpty(missing).slice(0, 5);
}

function inferConfidence(rawText: string, signals: string[], missingInfo: string[]): AiRationale["confidence"] {
  let score = 0;
  if (signals.length >= 3) {
    score += 2;
  } else if (signals.length >= 2) {
    score += 1;
  }

  if (/\b(5\d\d|CVE-\d{4}-\d{4,7}|timeout(?:s)?|latency|unavailable|down)\b/i.test(rawText)) {
    score += 1;
  }

  if (missingInfo.length >= 3) {
    score -= 1;
  }

  if (score >= 3) {
    return "high";
  }
  if (score >= 1) {
    return "medium";
  }
  return "low";
}

function buildEvidenceRationale(rawText: string, classification: Classification): AiRationale {
  const signals = buildGroundedSignals(rawText);
  const missingInfo = buildMissingInfo(rawText, classification.category);
  const confidence = inferConfidence(rawText, signals, missingInfo);
  const evidenceText =
    signals.length > 0 ? signals.slice(0, 3).join("; ") : "limited explicit operational evidence in the provided text";

  return {
    signals,
    reasoning: `Chosen ${classification.severity} ${classification.category} routed to ${classification.routing_team} based on ${evidenceText}.`,
    missing_info: missingInfo,
    confidence,
  };
}

function mergeRationale(rawText: string, classification: Classification, modelRationale: AiRationale): AiRationale {
  const evidence = buildEvidenceRationale(rawText, classification);
  const modelSignals = Array.isArray(modelRationale.signals) ? modelRationale.signals : [];
  const modelMissing = Array.isArray(modelRationale.missing_info) ? modelRationale.missing_info : [];
  const modelReasoning = typeof modelRationale.reasoning === "string" ? modelRationale.reasoning.trim() : "";

  return {
    signals: uniqueNonEmpty([...modelSignals, ...evidence.signals]).slice(0, 6),
    reasoning: modelReasoning || evidence.reasoning,
    missing_info: uniqueNonEmpty([...modelMissing, ...evidence.missing_info]).slice(0, 5),
    confidence: evidence.confidence,
  };
}

function enforceOperationalCategoryRule(classification: Classification, rawText: string): Classification {
  const parsed = ClassificationSchema.parse(classification);
  const operationalCategory = inferOperationalCategory(rawText);
  const adjusted: Classification = operationalCategory
    ? {
        ...parsed,
        category: operationalCategory,
        routing_team: /security/i.test(parsed.routing_team) ? "ops" : parsed.routing_team,
      }
    : parsed;

  const mergedRationale = mergeRationale(rawText, adjusted, parsed.rationale);
  const categoryChanged = operationalCategory && operationalCategory !== parsed.category;
  const reasoning = categoryChanged
    ? `Category adjusted to ${operationalCategory} due to explicit availability/latency symptoms. ${mergedRationale.reasoning}`
    : mergedRationale.reasoning;

  return ClassificationSchema.parse({
    ...adjusted,
    rationale: {
      ...mergedRationale,
      reasoning: reasoning.trim(),
    },
  });
}

function fallbackClassification(rawText: string, providedTitle?: string): Classification {
  const firstLine = rawText
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  const text = rawText.toLowerCase();
  let severity: "SEV1" | "SEV2" | "SEV3" | "SEV4" = "SEV3";
  if (
    text.includes("outage") ||
    text.includes("down") ||
    text.includes("cannot access") ||
    /\b502\b/.test(text) ||
    /\b503\b/.test(text) ||
    /\b504\b/.test(text)
  ) {
    severity = "SEV1";
  } else if (
    text.includes("degradation") ||
    text.includes("timeouts") ||
    text.includes("timeout") ||
    text.includes("latency")
  ) {
    severity = "SEV2";
  } else if (text.includes("minor") || text.includes("intermittent")) {
    severity = "SEV4";
  }

  const inferredCategory = inferOperationalCategory(rawText);
  const category =
    inferredCategory ??
    (text.includes("data")
      ? "DATA"
      : hasExplicitSecurityContext(rawText)
        ? "SECURITY"
        : "OTHER");

  const base = ClassificationSchema.parse({
    severity,
    category,
    routing_team: category === "SECURITY" ? "security-ops" : "ops",
    customer_impact: severity === "SEV1" || severity === "SEV2",
    title: providedTitle?.trim() || firstLine || "Untitled incident",
  });

  return ClassificationSchema.parse({
    ...base,
    rationale: buildEvidenceRationale(rawText, base),
  });
}

export async function stepClassify(rawText: string, providedTitle?: string) {
  const model = requireEnv(MODEL, "HF_TEXT_MODEL");
  const token = requireEnv(TOKEN, "HF_TOKEN");

  const prompt = `
You are an incident triage classifier.
Return ONLY valid JSON matching this schema:
{
  "severity": "SEV1|SEV2|SEV3|SEV4",
  "category": "OUTAGE|DEGRADATION|SECURITY|DATA|OTHER",
  "routing_team": "string",
  "customer_impact": true|false,
  "title": "string",
  "rationale": {
    "signals": ["string"],
    "reasoning": "string",
    "missing_info": ["string"],
    "confidence": "low|medium|high"
  }
}

Guidelines:
- SEV1: widespread outage/customer down
- SEV2: major degradation/many impacted
- SEV3: limited impact/intermittent
- SEV4: minor/no impact
- Do NOT classify as SECURITY only because a CVE is mentioned.
- If primary symptoms are availability/latency (502/504, timeouts, restarts), category must be OUTAGE or DEGRADATION.
- Use OUTAGE for full unavailability/down and DEGRADATION for partial availability or elevated latency.
- Keep rationale concise and operational (1-2 short sentences).
- "signals" must be grounded in the provided text; quote short fragments when useful (example: "HTTP 503", "timeout").
- "missing_info" must be actionable checks (example: confirm deploy time, verify DB connection saturation).
- Confidence must depend on evidence strength: high=multiple concrete signals, medium=some signals, low=limited/ambiguous evidence.
- Do not invent systems, regions, CVEs, timestamps, or metrics not present in the text.

Incident text:
${rawText.slice(0, 12000)}

Provided title (may be empty): ${providedTitle ?? ""}
`;

  try {
    const output = await hfTextGenerate(model, token, prompt);
    const parsed = await safeModelJson(output, {
      retry: (repairPrompt) => hfTextGenerate(model, token, repairPrompt),
      parse: (value) => ClassificationSchema.parse(value),
    });
    return enforceOperationalCategoryRule(parsed, rawText);
  } catch {
    return enforceOperationalCategoryRule(fallbackClassification(rawText, providedTitle), rawText);
  }
}
