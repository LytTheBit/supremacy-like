import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initLocale } from './i18n';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// Language: the saved choice, else the browser's, else English.
initLocale();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
