type SafeModelJsonOptions<T> = {
  retry: (prompt: string) => Promise<string>;
  parse: (value: unknown) => T;
};

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false; error: Error } {
  const trimmed = text.trim();

  const attempts: string[] = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    attempts.push(fenced[1].trim());
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && firstBrace < lastBrace) {
    attempts.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of attempts) {
    try {
      return { ok: true, value: JSON.parse(candidate) };
    } catch {
      // Continue until parse succeeds.
    }
  }

  return { ok: false, error: new Error("No valid JSON object found in model output.") };
}

export async function safeModelJson<T>(
  rawOutput: string,
  options: SafeModelJsonOptions<T>
): Promise<T> {
  const firstParse = tryParseJson(rawOutput);
  if (firstParse.ok) {
    return options.parse(firstParse.value);
  }

  const repairPrompt = `Fix this into valid JSON only:\n${rawOutput}`;
  const repairedOutput = await options.retry(repairPrompt);
  const secondParse = tryParseJson(repairedOutput);
  if (!secondParse.ok) {
    throw new Error("Model returned invalid JSON, including after repair retry.");
  }

  return options.parse(secondParse.value);
}
