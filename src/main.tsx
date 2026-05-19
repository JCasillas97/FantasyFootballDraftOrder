import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { readReplayFromUrl } from './lib/seed';
import { useAppStore } from './state/store';
import './index.css';

// If the URL contains a replay payload, hydrate the store before mounting so
// the first render goes straight to the match screen.
const replay = readReplayFromUrl();
if (replay) {
  const store = useAppStore.getState();
  store.setRoster(replay.roster);
  store.setReplaySeed(replay.seed);
  store.setScreen('match');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
