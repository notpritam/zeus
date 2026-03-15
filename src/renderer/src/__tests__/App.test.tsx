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
});
