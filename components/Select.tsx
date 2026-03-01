"use client";

type SelectOption = {
  value: string;
  label: string;
};

type SelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  label?: string;
  className?: string;
};

export default function Select({ value, onChange, options, label, className }: SelectProps) {
  return (
    <label className={`select-wrap ${className ?? ""}`.trim()}>
      {label ? <span className="field-label">{label}</span> : null}
      <select className="input select-input" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
