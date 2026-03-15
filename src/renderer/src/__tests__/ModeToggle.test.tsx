import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ModeToggle from '@/components/ModeToggle';

describe('ModeToggle', () => {
  it('shows RUNNING when active', () => {
    render(<ModeToggle active onToggle={() => {}} />);
    expect(screen.getByText('RUNNING')).toBeInTheDocument();
  });

  it('shows PAUSED when inactive', () => {
    render(<ModeToggle active={false} onToggle={() => {}} />);
    expect(screen.getByText('PAUSED')).toBeInTheDocument();
  });

  it('calls onToggle when clicked', () => {
    const onToggle = vi.fn();
    render(<ModeToggle active onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('shows Server Mode label', () => {
    render(<ModeToggle active onToggle={() => {}} />);
    expect(screen.getByText('Server Mode')).toBeInTheDocument();
  });
});
