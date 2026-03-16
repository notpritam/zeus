import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from '@/App';

describe('App', () => {
  it('renders the header', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('header')).toBeInTheDocument();
    });
  });

  it('renders the sidebar', async () => {
    render(<App />);
    await waitFor(() => {
      // Mobile + desktop both render sidebars
      expect(screen.getAllByTestId('session-sidebar').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders the new session button', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getAllByTestId('new-session-btn').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows empty terminal state when no session selected', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getAllByTestId('terminal-empty').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders settings gear in sidebar bottom bar', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getAllByTitle('Settings (⌘,)').length).toBeGreaterThanOrEqual(1);
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
      expect(screen.getAllByTestId('new-claude-btn').length).toBeGreaterThanOrEqual(1);
    });
  });
});
