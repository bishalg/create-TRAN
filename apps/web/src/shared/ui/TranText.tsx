import { forwardRef, type ComponentPropsWithoutRef, type ElementType } from 'react';

/** Typography variants — styles use `--tran-*` / app token aliases only (see app.css). */
export type TranTextVariant =
  'display' | 'title' | 'body' | 'caption' | 'muted' | 'success' | 'danger';

export type TranTextAs = 'h1' | 'h2' | 'h3' | 'p' | 'span' | 'label' | 'div';

const defaultTag: Record<TranTextVariant, TranTextAs> = {
  display: 'h1',
  title: 'h2',
  body: 'p',
  caption: 'span',
  muted: 'p',
  success: 'p',
  danger: 'p',
};

export interface TranTextProps extends ComponentPropsWithoutRef<'span'> {
  variant?: TranTextVariant;
  /** Semantic override; wins over variant default (e.g. `as="h1"` in the hero). */
  as?: TranTextAs;
  /** When `as="label"`, associates the label with a control. */
  htmlFor?: string;
}

/**
 * Token-bound typography atom (web). Mirrors the AFText pattern: one primitive, variant → CSS vars.
 * Native iOS/Android wrappers will map the same variant names later.
 */
export const TranText = forwardRef<HTMLElement, TranTextProps>(function TranText(
  { variant = 'body', as, className, ...props },
  ref
) {
  const Comp = (as ?? defaultTag[variant]) as ElementType;
  const classes = ['tran-text', className].filter(Boolean).join(' ');

  return <Comp className={classes} data-variant={variant} ref={ref} {...props} />;
});
