// Verifies: REQ-WEB-012
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TranTable, TranTd, TranTh } from './TranTable.js';

describe('TranTable', () => {
  it('renders table semantics with atom classes', () => {
    render(
      <TranTable>
        <thead>
          <tr>
            <TranTh>H</TranTh>
          </tr>
        </thead>
        <tbody>
          <tr>
            <TranTd>cell</TranTd>
          </tr>
        </tbody>
      </TranTable>
    );
    expect(screen.getByRole('table')).toHaveClass('tran-table');
    expect(screen.getByRole('columnheader')).toHaveClass('tran-th');
    expect(screen.getByRole('cell')).toHaveClass('tran-td');
  });
});
