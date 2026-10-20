import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

// `logFailure` logs every handled failure at its catalogue level (REQ-ERR-003); keep test output
// readable. `console.error` stays live so React warnings are still seen; tests spy where they assert.
beforeEach(() => {
  for (const level of ['debug', 'info', 'warn'] as const) {
    vi.spyOn(console, level).mockImplementation(() => {});
  }
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

// jsdom has no modal <dialog>; emulate the open/close state the browser implements (TranDialog).
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
}
