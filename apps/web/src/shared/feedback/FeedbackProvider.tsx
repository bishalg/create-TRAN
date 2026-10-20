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
  logFailure,
  type Presentation,
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
 * The web's one implementation of the Rust feedback policy (ADR-0028). Features say *what*
 * happened; the catalogue decides *how* the user hears about it.
 */
export interface Feedback {
  /** Shows an action's acknowledgement when the catalogue makes it a toast (REQ-ERR-008). */
  acknowledge(action: UserAction): void;
  /** Resolves `true` once confirmed — immediately when the catalogue asks for no dialog (REQ-ERR-007). */
  confirm(action: UserAction): Promise<boolean>;
  /** Logs the failure; shows it when it is a toast. Returns the presentation so the caller can
   * render inline and banner states, which belong to the screen (REQ-ERR-006). */
  report(error: TranRequestError): Presentation;
}

export interface DialogCopy {
  body: TranStringKey;
  confirm: TranStringKey;
}

/**
 * Dialog copy per action (the title is the catalogue's `messageKey`). `Record` keeps it exhaustive
 * when Rust adds an action; a test fails if a catalogue dialog has no copy here.
 */
export const DIALOG_COPY: Record<UserAction, DialogCopy | null> = {
  sign_out: { body: 'auth.signOutConfirm.body', confirm: 'common.signOut' },
  server_check_succeeded: null,
};

interface ToastItem {
  id: number;
  tone: ToastTone;
  messageKey: TranStringKey;
  requestId?: string;
  durationMs: number;
}

interface PendingConfirm {
  action: UserAction;
  resolve: (confirmed: boolean) => void;
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
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const nextId = useRef(0);

  const show = useCallback(
    (presentation: Presentation, messageKey: TranStringKey, requestId?: string) => {
      if (presentation.kind !== 'toast') return;
      nextId.current += 1;
      const item: ToastItem = {
        id: nextId.current,
        tone: presentation.tone,
        messageKey,
        requestId,
        durationMs: TOAST_DURATIONS_MS[presentation.duration],
      };
      setToasts((current) => [...current, item]);
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
        if (actionSpec(action).presentation.kind !== 'dialog') return Promise.resolve(true);
        return new Promise((resolve) => setPending({ action, resolve }));
      },
      report(error) {
        logFailure(error);
        show(error.spec.presentation, error.spec.messageKey, error.requestId);
        return error.spec.presentation;
      },
    }),
    [show]
  );

  const settle = (confirmed: boolean) => {
    pending?.resolve(confirmed);
    setPending(null);
  };

  const pendingSpec = pending && actionSpec(pending.action);
  const pendingCopy = pending && DIALOG_COPY[pending.action];

  return (
    <FeedbackContext.Provider value={feedback}>
      {children}
      <TranToastRegion label={t('common.notifications', locale)}>
        {toasts.map((toast) => (
          <TranToast
            key={toast.id}
            tone={toast.tone}
            message={t(toast.messageKey, locale)}
            detail={toast.requestId && t('errors.reference', locale, { id: toast.requestId })}
            durationMs={toast.durationMs}
            dismissLabel={t('common.dismiss', locale)}
            onDismiss={() => dismiss(toast.id)}
          />
        ))}
      </TranToastRegion>
      {pendingSpec && pendingCopy && pendingSpec.presentation.kind === 'dialog' && (
        <TranDialog
          title={t(pendingSpec.messageKey, locale)}
          body={t(pendingCopy.body, locale)}
          confirmLabel={t(pendingCopy.confirm, locale)}
          cancelLabel={t('common.cancel', locale)}
          destructive={pendingSpec.presentation.destructive}
          onConfirm={() => settle(true)}
          onCancel={() => settle(false)}
        />
      )}
    </FeedbackContext.Provider>
  );
}
