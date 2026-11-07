// Verifies: REQ-ERR-011 REQ-ERR-014
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setErrorReporter } from '@tran/core';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CrashBoundary } from './CrashBoundary.js';

function Bomb({ explode }: { explode: boolean }) {
  if (explode) throw new TypeError('cannot read properties of undefined');
  return <p>all good</p>;
}

beforeEach(() => {
  // React logs caught render errors itself; keep the test output quiet.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  setErrorReporter(null);
  vi.restoreAllMocks();
});

describe('CrashBoundary (REQ-ERR-011)', () => {
  it('renders its children while nothing breaks', () => {
    render(
      <CrashBoundary locale="en">
        <Bomb explode={false} />
      </CrashBoundary>
    );
    expect(screen.getByText('all good')).not.toBeNull();
  });

  it('replaces a broken tree with a localized, focused screen instead of a blank page', () => {
    render(
      <CrashBoundary locale="en">
        <Bomb explode />
      </CrashBoundary>
    );
    const heading = screen.getByRole('heading', { name: "This screen couldn't be shown" });
    expect(heading).toHaveFocus();
    expect(screen.getByRole('alert')).toHaveTextContent('Reloading usually fixes it');
    expect(screen.queryByText('all good')).toBeNull();
  });

  it('logs client.render_failed once and reports it with the thrown error', () => {
    const reporter = vi.fn();
    setErrorReporter(reporter);
    render(
      <CrashBoundary locale="en">
        <Bomb explode />
      </CrashBoundary>
    );
    expect(console.error).toHaveBeenCalledWith(
      'request failed',
      expect.objectContaining({ code: 'client.render_failed' })
    );
    expect(reporter).toHaveBeenCalledOnce();
    const [event, cause] = reporter.mock.calls[0]!;
    expect(event).toEqual({ code: 'client.render_failed', status: null, request_id: undefined });
    expect(cause).toBeInstanceOf(TypeError);
  });

  it('Reload calls the injected reload', async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    render(
      <CrashBoundary locale="ne" onReload={reload}>
        <Bomb explode />
      </CrashBoundary>
    );
    await user.click(screen.getByRole('button', { name: 'फेरि लोड गर्नुहोस्' }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('Reload reloads the page by default', async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    try {
      render(
        <CrashBoundary locale="en">
          <Bomb explode />
        </CrashBoundary>
      );
      await user.click(screen.getByRole('button', { name: 'Reload' }));
      expect(reload).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a value that is not an Error still becomes the screen', () => {
    function Thrower(): never {
      throw 'plain string';
    }
    render(
      <CrashBoundary locale="en">
        <Thrower />
      </CrashBoundary>
    );
    expect(screen.getByRole('heading', { name: "This screen couldn't be shown" })).not.toBeNull();
  });

  it('keeps its children mounted across re-renders (stable tree)', async () => {
    const user = userEvent.setup();
    function Counter() {
      const [n, setN] = useState(0);
      return (
        <button type="button" onClick={() => setN(n + 1)}>
          count {n}
        </button>
      );
    }
    const { rerender } = render(
      <CrashBoundary locale="en">
        <Counter />
      </CrashBoundary>
    );
    await user.click(screen.getByRole('button'));
    rerender(
      <CrashBoundary locale="hi">
        <Counter />
      </CrashBoundary>
    );
    expect(screen.getByRole('button')).toHaveTextContent('count 1');
  });
});
