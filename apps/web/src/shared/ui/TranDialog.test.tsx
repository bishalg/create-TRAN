// Verifies: REQ-ERR-006 REQ-ERR-007
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TranDialog } from './TranDialog.js';

const renderDialog = (destructive: boolean) => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const view = render(
    <TranDialog
      title="Sign out?"
      body="You'll return to role selection."
      confirmLabel="Sign out"
      cancelLabel="Cancel"
      destructive={destructive}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
  return { onConfirm, onCancel, ...view };
};

describe('TranDialog', () => {
  it('opens as a modal dialog named and described by its copy', () => {
    renderDialog(true);
    const dialog = screen.getByRole('dialog', { name: 'Sign out?' });
    expect(dialog).toHaveAttribute('open');
    expect(dialog).toHaveAccessibleDescription("You'll return to role selection.");
  });

  it('starts on Cancel for destructive choices and styles the confirm as danger', () => {
    renderDialog(true);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Sign out' })).toHaveAttribute(
      'data-variant',
      'danger'
    );
  });

  it('starts on the confirm button for safe choices', () => {
    renderDialog(false);
    const confirm = screen.getByRole('button', { name: 'Sign out' });
    expect(confirm).toHaveFocus();
    expect(confirm).toHaveAttribute('data-variant', 'primary');
  });

  it('reports the choice; Escape (the cancel event) is Cancel', () => {
    const { onConfirm, onCancel } = renderDialog(true);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const escape = new Event('cancel', { cancelable: true });
    screen.getByRole('dialog').dispatchEvent(escape);
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(escape.defaultPrevented).toBe(true);
  });

  it('closes the native dialog when unmounted', () => {
    const { unmount } = renderDialog(true);
    const dialog = screen.getByRole('dialog');
    unmount();
    expect(dialog).not.toHaveAttribute('open');
  });

  it('has no description when there is no body', () => {
    render(
      <TranDialog
        title="Continue?"
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );
    expect(screen.getByRole('dialog', { name: 'Continue?' })).not.toHaveAttribute(
      'aria-describedby'
    );
  });

  it('returns focus to the control that opened it', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();

    const { unmount } = renderDialog(true);
    expect(trigger).not.toHaveFocus();
    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
