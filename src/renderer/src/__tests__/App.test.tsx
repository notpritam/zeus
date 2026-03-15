import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from '@/App';

describe('App', () => {
  it('renders the header with Zeus brand', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('Zeus')).toBeInTheDocument();
    });
  });

  it('renders the sidebar', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('session-sidebar')).toBeInTheDocument();
    });
  });

  it('renders the new session button', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('new-session-btn')).toBeInTheDocument();
    });
  });

  it('shows empty terminal state when no session selected', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('terminal-empty')).toBeInTheDocument();
    });
  });

  it('renders service status rows in sidebar', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('Power Lock')).toBeInTheDocument();
      expect(screen.getByText('WebSocket')).toBeInTheDocument();
    });
  });

  it('has the shell layout with sidebar and main area', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('app-shell')).toBeInTheDocument();
      expect(screen.getByTestId('sidebar-panel')).toBeInTheDocument();
      expect(screen.getByTestId('main-area')).toBeInTheDocument();
    });
  });

  it('renders the new claude session button', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('new-claude-btn')).toBeInTheDocument();
    });
  });
});
