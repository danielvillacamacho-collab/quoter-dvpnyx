import '@testing-library/jest-dom';

// Suppress known deprecation warnings that don't affect test correctness
const originalWarn = console.warn;
const originalError = console.error;

beforeAll(() => {
  console.warn = (...args) => {
    if (typeof args[0] === 'string' && args[0].includes('React Router Future Flag')) return;
    originalWarn(...args);
  };
  console.error = (...args) => {
    if (typeof args[0] === 'string' && (
      args[0].includes('ReactDOMTestUtils.act') ||
      args[0].includes('React Router Future Flag')
    )) return;
    originalError(...args);
  };
});

afterAll(() => {
  console.warn = originalWarn;
  console.error = originalError;
});
