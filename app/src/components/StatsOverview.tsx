import { useBrackets } from '../context/BracketContext';

export function StatsOverview() {
  const { filteredBrackets, filteredScores, filteredGames, results, entries } = useBrackets();
  const people = Object.keys(filteredBrackets);
  const numDecided = filteredGames.filter(g => results[g.key]?.winner).length;

  let mostPoints = '-';
  let mostPointsVal = 0;
  let mostMax = '-';
  let mostMaxVal = 0;

  for (const [name, s] of Object.entries(filteredScores)) {
    if (s.points > mostPointsVal) {
      mostPointsVal = s.points;
      const entry = entries.find(e => e.name === name);
      mostPoints = entry?.person ? `${entry.person}` : name;
    }
    if (s.maxPoints > mostMaxVal) {
      mostMaxVal = s.maxPoints;
      const entry = entries.find(e => e.name === name);
      mostMax = entry?.person ? `${entry.person}` : name;
    }
  }

  return (
    <div className="stats-grid">
      <div className="stat-card">
        <div className="stat-value">{people.length}</div>
        <div className="stat-label">Brackets</div>
      </div>
      <div className="stat-card">
        <div className="stat-value">{numDecided}</div>
        <div className="stat-label">Results In</div>
      </div>
      <div className="stat-card">
        <div className="stat-value stat-leader">{mostPoints}{mostPointsVal > 0 ? ` (${mostPointsVal})` : ''}</div>
        <div className="stat-label">Most Points</div>
      </div>
      <div className="stat-card">
        <div className="stat-value stat-leader">{mostMax}{mostMaxVal > 0 ? ` (${mostMaxVal})` : ''}</div>
        <div className="stat-label">Most Max Points</div>
      </div>
    </div>
  );
}
