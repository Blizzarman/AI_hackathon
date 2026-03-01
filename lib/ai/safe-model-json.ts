type SafeModelJsonOptions<T> = {
  retry: (prompt: string) => Promise<string>;
  parse: (value: unknown) => T;
  retryTimeoutMs?: number;
};

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

function extractFencedBlocks(text: string): string[] {
  const blocks: string[] = [];
  const regex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  do {
    match = regex.exec(text);
    if (match?.[1]) {
      blocks.push(match[1]);
    }
  } while (match);
  return blocks;
}

function findBalancedJsonBlocks(text: string): string[] {
  const blocks: string[] = [];
  const stack: string[] = [];
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{" || ch === "[") {
      if (stack.length === 0) {
        start = i;
      }
      stack.push(ch);
      continue;
    }

    if (ch === "}" || ch === "]") {
      if (stack.length === 0) {
        continue;
      }
      const open = stack[stack.length - 1];
      const validPair = (open === "{" && ch === "}") || (open === "[" && ch === "]");
      if (!validPair) {
        stack.length = 0;
        start = -1;
        continue;
      }
      stack.pop();
      if (stack.length === 0 && start !== -1) {
        blocks.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return blocks;
}

function parseJsonCandidates(text: string): unknown | null {
  const trimmed = text.trim();
  const candidates = uniqueStrings([
    trimmed,
    ...extractFencedBlocks(trimmed),
    ...findBalancedJsonBlocks(trimmed),
  ]);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

export async function safeModelJson<T>(
  rawOutput: string,
  options: SafeModelJsonOptions<T>
): Promise<T> {
  const firstParsed = parseJsonCandidates(rawOutput);
  if (firstParsed !== null) {
    return options.parse(firstParsed);
  }

  const repairPrompt = [
    "Fix this into valid JSON only.",
    "Do not include markdown fences, comments, prose, or trailing commas.",
    "Return exactly one JSON object.",
    "",
    rawOutput,
  ].join("\n");

  const timeoutMs = options.retryTimeoutMs ?? 0;
  let repairedOutput: string;
  if (timeoutMs > 0) {
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<string>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`Model JSON repair timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    });
    try {
      repairedOutput = await Promise.race<string>([options.retry(repairPrompt), timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  } else {
    repairedOutput = await options.retry(repairPrompt);
  }

  const secondParsed = parseJsonCandidates(repairedOutput);
  if (secondParsed === null) {
    throw new Error("Model returned invalid JSON, including after repair retry.");
  }

  return options.parse(secondParsed);
}
