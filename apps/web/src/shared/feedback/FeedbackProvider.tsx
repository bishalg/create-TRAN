import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  actionSpec,
  admitToast,
  type ErrorCode,
  logFailure,
  type Presentation,
  ScreenIds,
  type SupportedLocale,
  t,
  TOAST_DURATIONS_MS,
  type ToastTone,
  type TranRequestError,
  type TranStringKey,
  type UserAction,
} from '@tran/core';
import { TranDialog } from '../ui/TranDialog.js';
import { TranToast, TranToastRegion } from '../ui/TranToast.js';

/**
 * The web's one implementation of the Rust feedback policy (ADR-0028, ADR-0036). Features say
 * *what* happened; the catalogue decides *how* the user hears about it.
 */
export interface Feedback {
  /** Shows an action's acknowledgement when the catalogue makes it a toast (REQ-ERR-008). */
  acknowledge(action: UserAction): void;
  /** Resolves `true` once confirmed — immediately when the catalogue asks for no dialog (REQ-ERR-007). */
  confirm(action: UserAction): Promise<boolean>;
  /** Logs the failure; shows it when it is a toast or a dialog. Returns the presentation so the
   * caller can render inline and banner states, which belong to the screen (REQ-ERR-006). */
  report(error: TranRequestError): Presentation;
  /** Runs `handler` when the user confirms the dialog a failure with `code` opened (REQ-ERR-010).
   * Returns the unsubscribe function. */
  onErrorConfirmed(code: ErrorCode, handler: () => void): () => void;
}

export interface DialogCopy {
  body: TranStringKey;
  confirm: TranStringKey;
  /** Defaults to `common.cancel`. */
  cancel?: TranStringKey;
  /** The buttons' screen contract ids, when the contract declares this dialog's own. */
  confirmId?: string;
  cancelId?: string;
}

/**
 * Dialog copy per action (the title is the catalogue's `messageKey`). `Record` keeps it exhaustive
 * when Rust adds an action; a test fails if a catalogue dialog has no copy here.
 */
export const DIALOG_COPY: Record<UserAction, DialogCopy | null> = {
  sign_out: { body: 'auth.signOutConfirm.body', confirm: 'common.signOut' },
  server_check_succeeded: null,
  // Its own ids, so a scenario can never confirm a deletion by tapping the sign-out dialog.
  delete_account: {
    body: 'auth.deleteAccountConfirm.body',
    confirm: 'common.deleteAccount',
    confirmId: ScreenIds.eligibility.deleteAccountConfirm,
    cancelId: ScreenIds.eligibility.deleteAccountCancel,
  },
  account_deleted: null,
};

/** Dialog copy for failures the catalogue presents as a dialog; a test keeps it complete. */
export const ERROR_DIALOG_COPY: Partial<Record<ErrorCode, DialogCopy>> = {
  'auth.session_expired': {
    body: 'errors.sessionExpiredBody',
    confirm: 'auth.signInAgain',
    cancel: 'common.notNow',
  },
};

interface ToastItem {
  id: number;
  /** Bumped when a duplicate arrives, so the toast remounts and its timer restarts (REQ-ERR-012). */
  generation: number;
  tone: ToastTone;
  messageKey: TranStringKey;
  requestId?: string;
  durationMs: number;
}

/** The one dialog on screen, whatever opened it: an action to confirm or a failure that asks. */
interface PendingDialog {
  titleKey: TranStringKey;
  copy: DialogCopy;
  destructive: boolean;
  settle: (confirmed: boolean) => void;
}

const FeedbackContext = createContext<Feedback | null>(null);

export function useFeedback(): Feedback {
  const feedback = useContext(FeedbackContext);
  if (!feedback) throw new Error('useFeedback must be used inside <FeedbackProvider>');
  return feedback;
}

export interface FeedbackProviderProps {
  locale: SupportedLocale;
  children: ReactNode;
}

export function FeedbackProvider({ locale, children }: FeedbackProviderProps) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [pending, setPending] = useState<PendingDialog | null>(null);
  const nextId = useRef(0);
  const handlers = useRef(new Map<ErrorCode, Set<() => void>>());

  const show = useCallback(
    (presentation: Presentation, messageKey: TranStringKey, requestId?: string) => {
      if (presentation.kind !== 'toast') return;
      const { tone } = presentation;
      const durationMs = TOAST_DURATIONS_MS[presentation.duration];
      setToasts((current) => {
        const admission = admitToast(current, { messageKey, tone });
        if (admission.kind === 'refresh') {
          return current.map((toast, index) =>
            index === admission.index
              ? { ...toast, generation: toast.generation + 1, requestId, durationMs }
              : toast
          );
        }
        nextId.current += 1;
        const item: ToastItem = {
          id: nextId.current,
          generation: 0,
          tone,
          messageKey,
          requestId,
          durationMs,
        };
        return [...current.slice(admission.evictOldest), item];
      });
    },
    []
  );

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const feedback = useMemo<Feedback>(
    () => ({
      acknowledge(action) {
        const spec = actionSpec(action);
        show(spec.presentation, spec.messageKey);
      },
      confirm(action) {
        const { presentation, messageKey } = actionSpec(action);
        if (presentation.kind !== 'dialog') return Promise.resolve(true);
        return new Promise((resolve) =>
          setPending({
            titleKey: messageKey,
            // A test keeps DIALOG_COPY complete for every catalogue dialog.
            copy: DIALOG_COPY[action]!,
            destructive: presentation.destructive,
            settle: resolve,
          })
        );
      },
      report(error) {
        logFailure(error);
        const { presentation, messageKey } = error.spec;
        show(presentation, messageKey, error.requestId);
        if (presentation.kind === 'dialog') {
          const { code } = error;
          setPending({
            titleKey: messageKey,
            // A test keeps ERROR_DIALOG_COPY complete for every catalogue dialog.
            copy: ERROR_DIALOG_COPY[code]!,
            destructive: presentation.destructive,
            settle: (confirmed) => {
              if (confirmed) handlers.current.get(code)?.forEach((handler) => handler());
            },
          });
        }
        return presentation;
      },
      onErrorConfirmed(code, handler) {
        const set = handlers.current.get(code) ?? new Set();
        set.add(handler);
        handlers.current.set(code, set);
        return () => set.delete(handler);
      },
    }),
    [show]
  );

  const settle = (confirmed: boolean) => {
    pending?.settle(confirmed);
    setPending(null);
  };

  return (
    <FeedbackContext.Provider value={feedback}>
      {children}
      <TranToastRegion label={t('common.notifications', locale)}>
        {toasts.map((toast) => (
          <TranToast
            key={`${toast.id}:${toast.generation}`}
            tone={toast.tone}
            message={t(toast.messageKey, locale)}
            detail={toast.requestId && t('errors.reference', locale, { id: toast.requestId })}
            durationMs={toast.durationMs}
            dismissLabel={t('common.dismiss', locale)}
            onDismiss={() => dismiss(toast.id)}
          />
        ))}
      </TranToastRegion>
      {pending && (
        <TranDialog
          title={t(pending.titleKey, locale)}
          body={t(pending.copy.body, locale)}
          confirmLabel={t(pending.copy.confirm, locale)}
          cancelLabel={t(pending.copy.cancel ?? 'common.cancel', locale)}
          destructive={pending.destructive}
          confirmTestId={pending.copy.confirmId}
          cancelTestId={pending.copy.cancelId}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
      )}
    </FeedbackContext.Provider>
  );
}
