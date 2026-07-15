import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Home from './Home';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('Home page', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('renders Sprint Room branding', () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    expect(screen.getByRole('heading', { name: /sprint room/i })).toBeDefined();
  });

  it('renders Create Room button', () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    expect(screen.getByRole('button', { name: /create room/i })).toBeDefined();
  });

  it('navigates to /room/{roomId} on Create Room click', () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: /create room/i }));
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const path = mockNavigate.mock.calls[0][0] as string;
    expect(path).toMatch(/^\/room\/[A-Za-z0-9_-]{10}$/);
  });
});
