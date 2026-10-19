import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export type TranButtonVariant = 'primary' | 'secondary';
export type TranButtonSize = 'md' | 'lg';

export interface TranButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: TranButtonVariant;
  size?: TranButtonSize;
}

/** Token-sized button; minimum touch target from `--tran-spacing-touch`. */
export const TranButton = forwardRef<HTMLButtonElement, TranButtonProps>(function TranButton(
  { variant = 'primary', size = 'lg', type = 'button', className, ...props },
  ref
) {
  const classes = ['tran-button', className].filter(Boolean).join(' ');

  return (
    <button
      type={type}
      className={classes}
      data-variant={variant}
      data-size={size}
      ref={ref}
      {...props}
    />
  );
});
