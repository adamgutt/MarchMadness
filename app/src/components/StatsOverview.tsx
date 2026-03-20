import { useBrackets } from '../context/BracketContext';

export function StatsOverview() {
  const { filteredBrackets, filteredScores, filteredGames, results, entries, selectedPool, scores } = useBrackets();
  const people = Object.keys(filteredBrackets);
  const numDecided = filteredGames.filter(g => results[g.key]?.winner).length;

  function getLeader(scoreSet: Record<string, { points: number; maxPoints: number }>, field: 'points' | 'maxPoints') {
    let bestName = '-';
    let bestVal = 0;
    for (const [name, s] of Object.entries(scoreSet)) {
      if (s[field] > bestVal) {
        bestVal = s[field];
        bestName = name;
      }
    }
    return { name: bestName, val: bestVal };
  }

  const overall = getLeader(filteredScores, 'points');
  const overallMax = getLeader(filteredScores, 'maxPoints');

  // Per-pool leaders (only when viewing all)
  const poolLeaders = selectedPool === 'all' ? (['Mandel', 'Aronoff'] as const).map(pool => {
    const poolNames = new Set(entries.filter(e => e.pool === pool).map(e => e.name));
    const poolScores: Record<string, { points: number; maxPoints: number }> = {};
    for (const [name, s] of Object.entries(scores)) {
      if (poolNames.has(name)) poolScores[name] = s;
    }
    return { pool, points: getLeader(poolScores, 'points'), max: getLeader(poolScores, 'maxPoints') };
  }) : null;

  const fmt = (name: string, val: number) => val > 0 ? `${name} (${val})` : '-';

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
        <div className="stat-value stat-leader">{fmt(overall.name, overall.val)}</div>
        <div className="stat-label">Most Points</div>
        {poolLeaders && poolLeaders.map(p => (
          <div key={p.pool} className="stat-pool-line">{p.pool}: {fmt(p.points.name, p.points.val)}</div>
        ))}
      </div>
      <div className="stat-card">
        <div className="stat-value stat-leader">{fmt(overallMax.name, overallMax.val)}</div>
        <div className="stat-label">Most Max Points</div>
        {poolLeaders && poolLeaders.map(p => (
          <div key={p.pool} className="stat-pool-line">{p.pool}: {fmt(p.max.name, p.max.val)}</div>
        ))}
      </div>
    </div>
  );
}
