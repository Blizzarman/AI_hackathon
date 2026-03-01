function requireEnv(value: string | undefined, key: string): string {
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

export function validateHackathonModelPolicy() {
  requireEnv(process.env.HF_TEXT_MODEL, "HF_TEXT_MODEL");
  requireEnv(process.env.HF_EMBED_MODEL, "HF_EMBED_MODEL");
}
