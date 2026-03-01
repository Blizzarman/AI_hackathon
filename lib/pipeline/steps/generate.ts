import { GeneratedOutputsSchema } from "@/lib/schema";
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

type StepGenerateInput = {
  rawText: string;
  classification: unknown;
  entities: unknown;
  enrichment: unknown;
};

function fallbackGenerated(payload: StepGenerateInput) {
  const classification = payload.classification as {
    title?: string;
    severity?: string;
    category?: string;
    routing_team?: string;
  };
  const title = classification?.title ?? "Untitled incident";
  const severity = classification?.severity ?? "SEV3";
  const category = classification?.category ?? "OTHER";
  const routingTeam = classification?.routing_team ?? "ops";
  const excerpt = payload.rawText.slice(0, 1200);

  return GeneratedOutputsSchema.parse({
    summary_md: [
      `## Incident Summary`,
      `- Title: ${title}`,
      `- Severity: ${severity}`,
      `- Category: ${category}`,
      `- Routing team: ${routingTeam}`,
      "",
      `### Evidence`,
      excerpt ? excerpt : "No source text was provided.",
    ].join("\n"),
    next_actions_md: [
      "- [ ] Confirm scope and customer impact",
      "- [ ] Validate timeline and root cause signals",
      "- [ ] Assign owners for mitigation and communication",
      "- [ ] Publish next status update with verified facts",
    ].join("\n"),
    comms_internal:
      `Internal update: ${title} is being triaged as ${severity}/${category}. ` +
      `Current owner team: ${routingTeam}. Investigation is in progress; next update in 30 minutes.`,
    comms_external:
      "We are investigating an issue affecting service reliability. Our team is actively working on mitigation and will provide the next update as soon as more information is confirmed.",
  });
}

export async function stepGenerate(payload: StepGenerateInput) {
  const model = requireEnv(MODEL, "HF_TEXT_MODEL");
  const token = requireEnv(TOKEN, "HF_TOKEN");

  const prompt = `
You are an incident commander assistant.
Using the inputs, produce ONLY valid JSON:
{
 "summary_md": "markdown",
 "next_actions_md": "markdown checklist",
 "comms_internal": "plain text update for internal stakeholders",
 "comms_external": "plain text status page update for customers"
}

Inputs:
Classification: ${JSON.stringify(payload.classification)}
Entities: ${JSON.stringify(payload.entities)}
Enrichment (may include errors): ${JSON.stringify(payload.enrichment).slice(0, 12000)}
Incident text:
${payload.rawText.slice(0, 12000)}

Requirements:
- Be specific but avoid hallucinating details not present.
- If details are missing, say what is unknown and what evidence to collect.
- External comms must be cautious, customer-safe, no blame.
`;

  try {
    const output = await hfTextGenerate(model, token, prompt);
    return await safeModelJson(output, {
      retry: (repairPrompt) => hfTextGenerate(model, token, repairPrompt),
      parse: (value) => GeneratedOutputsSchema.parse(value),
    });
  } catch {
    return fallbackGenerated(payload);
  }
}
