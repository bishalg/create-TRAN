import { forwardRef, useId, type ComponentPropsWithoutRef } from 'react';
import { TranText } from './TranText.js';

export interface FieldProps extends ComponentPropsWithoutRef<'input'> {
  label: string;
  hint?: string;
}

/** Labelled text input. Label and hint use TranText; ref targets the input. */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, id: idProp, ...inputProps },
  ref
) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const hintId = `${id}-hint`;

  return (
    <div className="field">
      <TranText variant="body" as="label" htmlFor={id}>
        {label}
      </TranText>
      <input id={id} ref={ref} aria-describedby={hint ? hintId : undefined} {...inputProps} />
      {hint && (
        <TranText variant="caption" as="span" id={hintId} className="field-hint">
          {hint}
        </TranText>
      )}
    </div>
  );
});
