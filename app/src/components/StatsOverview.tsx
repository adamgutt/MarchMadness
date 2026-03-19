import { useBrackets } from '../context/BracketContext';

export function StatsOverview() {
  const { filteredBrackets, filteredScores, filteredGames, results } = useBrackets();
  const people = Object.keys(filteredBrackets);
  const numDecided = filteredGames.filter(g => results[g.key]?.winner).length;

  let leader = '-';
  if (numDecided > 0 && people.length > 0) {
    const sorted = [...people].sort((a, b) => (filteredScores[b]?.points || 0) - (filteredScores[a]?.points || 0));
    leader = sorted[0];
  }

  return (
    <div className="stats-grid">
      <div className="stat-card">
        <div className="stat-value">{people.length}</div>
        <div className="stat-label">Brackets</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{filteredGames.length}</div>
        <div className="stat-label">Games Tracked</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{numDecided}</div>
        <div className="stat-label">Results In</div>
      </div>
      <div className="stat-card">
        <div className="stat-value stat-leader">{leader}</div>
        <div className="stat-label">Current Leader</div>
      </div>
    </div>
  );
}
