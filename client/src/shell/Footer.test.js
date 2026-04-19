import React from 'react';
import { render, screen } from '@testing-library/react';
import Footer from './Footer';

describe('Footer', () => {
  it('renders version and short SHA', () => {
    render(<Footer />);
    // default env (local dev) shows "local" as sha
    expect(screen.getByText(/v\d/)).toBeInTheDocument();
    expect(screen.getByText(/build/)).toBeInTheDocument();
  });

  it('truncates SHA to 7 chars', () => {
    const prev = process.env.REACT_APP_GIT_SHA;
    process.env.REACT_APP_GIT_SHA = 'abcdef1234567890';
    render(<Footer />);
    // The short SHA must appear, the long one must NOT appear as-is.
    expect(screen.getByText(/build abcdef1/)).toBeInTheDocument();
    expect(screen.queryByText(/abcdef1234567890/)).toBeNull();
    process.env.REACT_APP_GIT_SHA = prev;
  });
});
