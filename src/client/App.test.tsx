import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import RoomPage from './pages/RoomPage';

// Render the app routes using MemoryRouter for testability
// (BrowserRouter can't be used in tests; MemoryRouter replicates the same route config)
function renderWithRouter(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:roomId" element={<RoomPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('App routing', () => {
  it('renders the Home page at /', () => {
    renderWithRouter('/');
    expect(screen.getByRole('heading', { name: /sprint room/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /create room/i })).toBeDefined();
  });

  it('renders the RoomPage at /room/:roomId', () => {
    renderWithRouter('/room/abc1234567');
    expect(screen.getByRole('heading', { name: /join sprint room/i })).toBeDefined();
    expect(screen.getByLabelText(/display name/i)).toBeDefined();
  });

  it('redirects unknown paths to the Home page', () => {
    renderWithRouter('/unknown/path');
    expect(screen.getByRole('heading', { name: /sprint room/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /create room/i })).toBeDefined();
  });

  it('redirects /about (non-existent route) to Home', () => {
    renderWithRouter('/about');
    expect(screen.getByRole('heading', { name: /sprint room/i })).toBeDefined();
  });

  it('redirects deeply nested unknown paths to Home', () => {
    renderWithRouter('/foo/bar/baz');
    expect(screen.getByRole('heading', { name: /sprint room/i })).toBeDefined();
  });
});
