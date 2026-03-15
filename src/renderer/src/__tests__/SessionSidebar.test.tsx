import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SessionSidebar from '@/components/SessionSidebar';
import type { SessionRecord } from '../../../shared/types';

const makeSession = (
  id: string,
  status: 'active' | 'exited' | 'killed' = 'active',
): SessionRecord => ({
  id,
  shell: '/bin/zsh',
  status,
  cols: 80,
  rows: 24,
  cwd: '/home',
  startedAt: Date.now() - 60000,
  endedAt: status !== 'active' ? Date.now() : null,
  exitCode: status === 'exited' ? 0 : null,
});

const defaultProps = {
  sessions: [] as SessionRecord[],
  activeSessionId: null,
  powerBlock: true,
  websocket: true,
  onNewSession: vi.fn(),
  onSelectSession: vi.fn(),
  onStopSession: vi.fn(),
  onTogglePower: vi.fn(),
};

describe('SessionSidebar', () => {
  it('renders empty state when no sessions', () => {
    render(<SessionSidebar {...defaultProps} />);
    expect(screen.getByTestId('no-sessions')).toBeInTheDocument();
  });

  it('renders new session button', () => {
    render(<SessionSidebar {...defaultProps} />);
    expect(screen.getByTestId('new-session-btn')).toBeInTheDocument();
  });

  it('fires onNewSession callback when button clicked', () => {
    const onNewSession = vi.fn();
    render(<SessionSidebar {...defaultProps} onNewSession={onNewSession} />);
    fireEvent.click(screen.getByTestId('new-session-btn'));
    expect(onNewSession).toHaveBeenCalledOnce();
  });

  it('renders session cards when sessions exist', () => {
    const sessions = [makeSession('s1'), makeSession('s2', 'exited')];
    render(<SessionSidebar {...defaultProps} sessions={sessions} />);
    expect(screen.getByTestId('session-card-s1')).toBeInTheDocument();
    expect(screen.getByTestId('session-card-s2')).toBeInTheDocument();
  });

  it('shows service status rows', () => {
    render(<SessionSidebar {...defaultProps} />);
    expect(screen.getByText('Power Lock')).toBeInTheDocument();
    expect(screen.getByText('WebSocket')).toBeInTheDocument();
  });
});
