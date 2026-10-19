import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export type TranInlineGap = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface TranInlineProps extends ComponentPropsWithoutRef<'div'> {
  gap?: TranInlineGap;
}

/** Horizontal flex row with token spacing via `data-gap`. */
export const TranInline = forwardRef<HTMLDivElement, TranInlineProps>(function TranInline(
  { gap = 'sm', className, ...props },
  ref
) {
  const classes = ['tran-inline', className].filter(Boolean).join(' ');

  return <div className={classes} data-gap={gap} ref={ref} {...props} />;
});
