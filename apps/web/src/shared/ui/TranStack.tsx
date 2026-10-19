import { type ComponentPropsWithoutRef, type CSSProperties } from 'react';

export type TranStackGap = 'sm' | 'md' | '4' | '5';

const gapVar: Record<TranStackGap, string> = {
  sm: 'var(--tran-spacing-sm)',
  md: 'var(--tran-spacing-md)',
  '4': 'var(--space-4)',
  '5': 'var(--space-5)',
};

export interface TranStackProps extends ComponentPropsWithoutRef<'div'> {
  gap?: TranStackGap;
}

/** Vertical flex stack with token spacing only (no magic pixel gaps). */
export function TranStack({ gap = '4', className, style, ...props }: TranStackProps) {
  const stackStyle: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: gapVar[gap],
    ...style,
  };

  const classes = ['tran-stack', className].filter(Boolean).join(' ');

  return <div className={classes} style={stackStyle} {...props} />;
}
