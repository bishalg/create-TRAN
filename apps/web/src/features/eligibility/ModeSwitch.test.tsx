import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ModeSwitch } from './ModeSwitch.js';

describe('ModeSwitch', () => {
  it('renders two radios in a named group and reports changes', async () => {
    const onChange = vi.fn();
    render(<ModeSwitch mode="device" onChange={onChange} locale="en" />);

    expect(screen.getByRole('group', { name: 'Where should the check run?' })).toBeVisible();
    expect(screen.getByRole('radio', { name: /On this device/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Ask the server/ })).not.toBeChecked();

    await userEvent.click(screen.getByRole('radio', { name: /Ask the server/ }));
    expect(onChange).toHaveBeenCalledWith('server');
  });

  it('is localised', () => {
    render(<ModeSwitch mode="server" onChange={() => {}} locale="ne" />);
    expect(screen.getByRole('radio', { name: /सर्भरलाई सोध्नुहोस्/ })).toBeChecked();
  });
});
