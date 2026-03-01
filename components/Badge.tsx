"use client";

type BadgeKind = "severity" | "category" | "status";

type BadgeProps = {
  value: string;
  kind?: BadgeKind;
  className?: string;
};

function severityClass(value: string) {
  const normalized = value.trim().toUpperCase();
  if (normalized === "SEV1") return "badge-sev1";
  if (normalized === "SEV2") return "badge-sev2";
  if (normalized === "SEV3") return "badge-sev3";
  if (normalized === "SEV4") return "badge-sev4";
  return "badge-muted";
}

function categoryClass(value: string) {
  const normalized = value.trim().toUpperCase();
  if (normalized === "OUTAGE") return "badge-category-outage";
  if (normalized === "DEGRADATION") return "badge-category-degradation";
  if (normalized === "SECURITY") return "badge-category-security";
  if (normalized === "DATA") return "badge-category-data";
  return "badge-category-other";
}

export default function Badge({ value, kind = "status", className }: BadgeProps) {
  const normalized = value.trim();
  const variantClass =
    kind === "severity" ? severityClass(normalized) : kind === "category" ? categoryClass(normalized) : "badge-muted";

  return <span className={`badge ${variantClass} ${className ?? ""}`.trim()}>{normalized}</span>;
}
