import { forwardRef, type ComponentPropsWithoutRef } from 'react';

export const TranTable = forwardRef<HTMLTableElement, ComponentPropsWithoutRef<'table'>>(
  function TranTable({ className, ...props }, ref) {
    const classes = ['tran-table', className].filter(Boolean).join(' ');
    return <table className={classes} ref={ref} {...props} />;
  }
);

export const TranTh = forwardRef<HTMLTableCellElement, ComponentPropsWithoutRef<'th'>>(
  function TranTh({ className, ...props }, ref) {
    const classes = ['tran-th', className].filter(Boolean).join(' ');
    return <th className={classes} ref={ref} {...props} />;
  }
);

export const TranTd = forwardRef<HTMLTableCellElement, ComponentPropsWithoutRef<'td'>>(
  function TranTd({ className, ...props }, ref) {
    const classes = ['tran-td', className].filter(Boolean).join(' ');
    return <td className={classes} ref={ref} {...props} />;
  }
);
