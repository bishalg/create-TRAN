import { useEffect, useId, useRef, useState } from 'react';
import { ScreenIds } from '@tran/core';
import { TranButton } from './TranButton.js';

export interface TranDialogProps {
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel: string;
  /** A destructive confirm is styled as danger and focus starts on Cancel (the safe choice). */
  destructive?: boolean;
  /** The screen contract ids of the two buttons; a confirmation may declare its own. */
  confirmTestId?: string;
  cancelTestId?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Blocking choice (REQ-ERR-006/007) on the native modal `<dialog>`: the browser traps focus, makes
 * the page inert and restores focus to the trigger on close. Escape is Cancel.
 */
export function TranDialog({
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive = false,
  confirmTestId = ScreenIds.eligibility.dialogConfirm,
  cancelTestId = ScreenIds.eligibility.dialogCancel,
  onConfirm,
  onCancel,
}: TranDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  // Read during the first render, before focus moves into the dialog.
  const [trigger] = useState(() => document.activeElement as HTMLElement | null);

  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    const initialFocus = destructive ? cancelRef.current : confirmRef.current;
    initialFocus?.focus();
    return () => {
      dialog.close();
      // React removes the node before this cleanup runs, so the browser cannot restore focus.
      trigger?.focus();
    };
  }, [destructive, trigger]);

  return (
    <dialog
      ref={ref}
      className="tran-dialog"
      aria-labelledby={titleId}
      aria-describedby={body ? bodyId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id={titleId} className="tran-dialog-title">
        {title}
      </h2>
      {body && (
        <p id={bodyId} className="tran-dialog-body">
          {body}
        </p>
      )}
      <div className="tran-dialog-actions">
        <TranButton
          ref={cancelRef}
          variant="secondary"
          size="md"
          autoFocus={destructive}
          data-testid={cancelTestId}
          onClick={onCancel}
        >
          {cancelLabel}
        </TranButton>
        <TranButton
          ref={confirmRef}
          variant={destructive ? 'danger' : 'primary'}
          size="md"
          autoFocus={!destructive}
          data-testid={confirmTestId}
          onClick={onConfirm}
        >
          {confirmLabel}
        </TranButton>
      </div>
    </dialog>
  );
}
