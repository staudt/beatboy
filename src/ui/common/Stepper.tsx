import { IconMinus, IconPlus } from './icons';

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  /** Text shown instead of the raw number. */
  display?: string;
}

/** Compact [–] value [+] control. */
export function Stepper({ label, value, min, max, onChange, display }: Props) {
  return (
    <div class="stepper" role="group" aria-label={label}>
      <button type="button" class="btn btn-icon" aria-label={`${label} down`} disabled={value <= min} onClick={() => onChange(value - 1)}>
        <IconMinus />
      </button>
      <output class="stepper-value" aria-live="polite">
        {display ?? value}
      </output>
      <button type="button" class="btn btn-icon" aria-label={`${label} up`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        <IconPlus />
      </button>
    </div>
  );
}
