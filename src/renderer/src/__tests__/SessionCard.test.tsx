import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SessionCard from '@/components/SessionCard';
import type { SessionRecord } from '../../../shared/types';

const makeSession = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 'test-session-id-1234',
  shell: '/bin/zsh',
  status: 'active',
  cols: 80,
  rows: 24,
  cwd: '/home',
  startedAt: Date.now() - 120000,
  endedAt: null,
  exitCode: null,
  ...overrides,
});

describe('SessionCard', () => {
  it('renders truncated session id and status badge', () => {
    const session = makeSession();
    render(<SessionCard session={session} active={false} onSelect={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByText('test-ses')).toBeInTheDocument();
    expect(screen.getByTestId(`session-status-${session.id}`)).toHaveTextContent('active');
  });

  it('renders stop button for active sessions', () => {
    const session = makeSession();
    render(<SessionCard session={session} active={false} onSelect={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByTestId(`session-stop-${session.id}`)).toBeInTheDocument();
  });

  it('does not render stop button for exited sessions', () => {
    const session = makeSession({ status: 'exited', exitCode: 0, endedAt: Date.now() });
    render(<SessionCard session={session} active={false} onSelect={vi.fn()} onStop={vi.fn()} />);
    expect(screen.queryByTestId(`session-stop-${session.id}`)).not.toBeInTheDocument();
  });

  it('fires onStop callback when stop button clicked', () => {
    const onStop = vi.fn();
    const session = makeSession();
    render(<SessionCard session={session} active={false} onSelect={vi.fn()} onStop={onStop} />);
    fireEvent.click(screen.getByTestId(`session-stop-${session.id}`));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('fires onSelect callback when card clicked', () => {
    const onSelect = vi.fn();
    const session = makeSession();
    render(<SessionCard session={session} active={false} onSelect={onSelect} onStop={vi.fn()} />);
    fireEvent.click(screen.getByTestId(`session-card-${session.id}`));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
