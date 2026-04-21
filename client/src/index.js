import React from 'react';
import ReactDOM from 'react-dom/client';
// Phase 11: self-host the UI typography so the app renders correctly offline
// and without a third-party CDN hop. `@fontsource/*` ships woff2 files + the
// matching @font-face declarations, which CRA will fingerprint + cache-bust.
// Weights mirror the set previously requested from Google Fonts.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/montserrat/600.css';
import '@fontsource/montserrat/700.css';
import '@fontsource/montserrat/800.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import App from './App';
ReactDOM.createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
