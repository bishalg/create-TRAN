import { forwardRef, type ComponentPropsWithoutRef } from 'react';

/** Accessible `<label>` wrapper for custom controls (e.g. radio tiles). */
export const TranLabel = forwardRef<HTMLLabelElement, ComponentPropsWithoutRef<'label'>>(
  function TranLabel({ className, ...props }, ref) {
    const classes = ['tran-label', className].filter(Boolean).join(' ');
    return <label className={classes} ref={ref} {...props} />;
  }
);
