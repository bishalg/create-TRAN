import { type ComponentPropsWithoutRef, type ElementType } from 'react';

/** Typography variants — styles use `--tran-*` / app token aliases only (see app.css). */
export type TranTextVariant = 'title' | 'body' | 'caption' | 'muted' | 'success' | 'danger';

const defaultTag: Record<TranTextVariant, ElementType> = {
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
  as?: ElementType;
}

/**
 * Token-bound typography atom (web). Mirrors the AFText pattern: one primitive, variant → CSS vars.
 * Native iOS/Android wrappers will map the same variant names later.
 */
export function TranText({ variant = 'body', as, className, ...props }: TranTextProps) {
  const Comp = as ?? defaultTag[variant];
  const classes = ['tran-text', className].filter(Boolean).join(' ');

  return <Comp className={classes} data-variant={variant} {...props} />;
}
