import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import App from '@/App';

describe('App', () => {
  it('renders after loading status', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('Zeus')).toBeInTheDocument();
    });
  });

  it('shows power lock as active on load', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    });
  });

  it('shows all status rows', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('Power Lock')).toBeInTheDocument();
      expect(screen.getByText('WebSocket')).toBeInTheDocument();
      expect(screen.getByText('Tunnel')).toBeInTheDocument();
    });
  });

  it('shows services section header', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('Services')).toBeInTheDocument();
    });
  });

  it('uses the shell and panel layout wrappers', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    });

    const shell = screen.getByTestId('app-shell');
    const panel = screen.getByTestId('app-panel');

    expect(shell.className).toContain('justify-center');
    expect(shell.className).toContain('flex-1');
    expect(panel.className).toContain('w-full');
    expect(panel.className).toContain('gap-8');
  });

  it('uses a scrollable content shell', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('app-shell')).toBeInTheDocument();
    });

    const shell = screen.getByTestId('app-shell');

    expect(shell.className).toContain('overflow-y-auto');
    expect(shell.className).toContain('min-h-0');
  });
});
