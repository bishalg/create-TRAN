import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export type TranBoxPadding = 'none' | 'sm' | 'md' | 'lg';

export interface TranBoxProps extends ComponentPropsWithoutRef<'div'> {
  padding?: TranBoxPadding;
}

/** Generic layout box with token padding via `data-padding`. */
export const TranBox = forwardRef<HTMLDivElement, TranBoxProps>(function TranBox(
  { padding = 'none', className, ...props },
  ref
) {
  const classes = ['tran-box', className].filter(Boolean).join(' ');

  return <div className={classes} data-padding={padding} ref={ref} {...props} />;
});
