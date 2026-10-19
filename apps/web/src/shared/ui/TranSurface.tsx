import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export type TranSurfaceVariant = 'default' | 'raised' | 'field';
export type TranSurfaceRadius = 'sm' | 'md' | 'lg';
export type TranSurfacePadding = 'none' | 'sm' | 'md' | 'lg';

export interface TranSurfaceProps extends ComponentPropsWithoutRef<'div'> {
  surface?: TranSurfaceVariant;
  radius?: TranSurfaceRadius;
  padding?: TranSurfacePadding;
}

/** Bordered surface panel using semantic token backgrounds. */
export const TranSurface = forwardRef<HTMLDivElement, TranSurfaceProps>(function TranSurface(
  { surface = 'default', radius = 'md', padding = 'md', className, ...props },
  ref
) {
  const classes = ['tran-surface', className].filter(Boolean).join(' ');

  return (
    <div
      className={classes}
      data-surface={surface}
      data-radius={radius}
      data-padding={padding}
      ref={ref}
      {...props}
    />
  );
});
