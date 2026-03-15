import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import TerminalView from '@/components/TerminalView';

describe('TerminalView', () => {
  it('renders empty state when no sessionId', () => {
    render(<TerminalView sessionId={null} />);
    expect(screen.getByTestId('terminal-empty')).toBeInTheDocument();
    expect(screen.getByText(/No session selected/)).toBeInTheDocument();
  });

  it('renders terminal container when sessionId provided', () => {
    render(<TerminalView sessionId="test-123" />);
    expect(screen.getByTestId('terminal-container')).toBeInTheDocument();
    expect(screen.queryByTestId('terminal-empty')).not.toBeInTheDocument();
  });
});
