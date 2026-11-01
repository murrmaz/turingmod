import { type ReactNode, useId } from 'react';
import { Label } from '@/components/ui/label';

/** What a field's control is given so its label and hint belong to it. */
export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
}

/**
 * One form field: a label, its control, and an optional hint below. The control receives the
 * props that tie it to the label and hint, so a screen reader announces both with it:
 * `<FormField label="Board address">{(field) => <Input {...field} … />}</FormField>`.
 * For a Select, spread them on its SelectTrigger.
 */
export function FormField({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: (field: FieldControlProps) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children(hint === undefined ? { id } : { id, 'aria-describedby': hintId })}
      {hint !== undefined && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}
