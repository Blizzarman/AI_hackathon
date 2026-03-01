"use client";

type ToggleProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  className?: string;
};

export default function Toggle({ checked, onChange, label, className }: ToggleProps) {
  return (
    <label className={`toggle-wrap ${className ?? ""}`.trim()}>
      <span className="field-label">{label}</span>
      <button
        type="button"
        className={`toggle ${checked ? "toggle-on" : "toggle-off"}`}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
      >
        <span className="toggle-track">
          <span className="toggle-thumb" />
        </span>
        <span className="toggle-text">{checked ? "Customer-impacting only" : "All incidents"}</span>
      </button>
    </label>
  );
}
