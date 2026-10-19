import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export type TranStackGap = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface TranStackProps extends ComponentPropsWithoutRef<'div'> {
  gap?: TranStackGap;
}

/** Vertical flex stack with token spacing via `data-gap` (no inline styles). */
export const TranStack = forwardRef<HTMLDivElement, TranStackProps>(function TranStack(
  { gap = 'md', className, ...props },
  ref
) {
  const classes = ['tran-stack', className].filter(Boolean).join(' ');

  return <div className={classes} data-gap={gap} ref={ref} {...props} />;
});
