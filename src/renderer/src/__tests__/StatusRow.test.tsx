import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import StatusRow from '@/components/StatusRow';

describe('StatusRow', () => {
  it('renders label and status', () => {
    render(<StatusRow label="Power Lock" status="ACTIVE" />);
    expect(screen.getByText('Power Lock')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
  });

  it('applies accent styles when active', () => {
    render(<StatusRow label="Power Lock" status="ACTIVE" active />);
    const badge = screen.getByText('ACTIVE');
    expect(badge.className).toContain('bg-accent-bg');
    expect(badge.className).toContain('text-accent');
  });

  it('applies surface styles by default', () => {
    render(<StatusRow label="WebSocket" status="OFFLINE" />);
    const badge = screen.getByText('OFFLINE');
    expect(badge.className).toContain('bg-bg-surface');
    expect(badge.className).toContain('text-text-faint');
  });
});
