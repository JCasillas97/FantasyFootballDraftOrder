import { useAppStore } from './state/store';
import { SetupScreen } from './ui/SetupScreen';
import { MatchScreen } from './ui/MatchScreen';
import { ResultsScreen } from './ui/ResultsScreen';

export default function App() {
  const screen = useAppStore((s) => s.screen);

  return (
    <div className="app-shell">
      <h1 className="app-title">Rumble Draft Planner</h1>
      {screen === 'setup' && <SetupScreen />}
      {screen === 'match' && <MatchScreen />}
      {screen === 'results' && <ResultsScreen />}
    </div>
  );
}
