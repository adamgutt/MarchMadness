import { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchEspnLeaderboard, EspnEntry } from '../utils/espnLeaderboard';
import { useBrackets } from '../context/BracketContext';

type SortField = 'rank' | 'points' | 'maxPoints' | 'correct' | 'wrong' | 'percentile';

export function EspnLeaderboard() {
  const [entries, setEntries] = useState<EspnEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [sortField, setSortField] = useState<SortField>('rank');
  const [sortAsc, setSortAsc] = useState(true);

  // Our brackets from Firebase (Mandel pool only)
  const { scores, entries: bracketEntries, activeBrackets } = useBrackets();
  const ourMandel = useMemo(() => {
    const mandelNames = new Set(bracketEntries.filter(e => e.pool === 'Mandel').map(e => e.name));
    return Object.entries(scores)
      .filter(([name]) => mandelNames.has(name))
      .map(([name, s]) => {
        const entry = bracketEntries.find(e => e.name === name);
        const champGame = activeBrackets[name]?.games.find(g => g.round === 'Championship');
        return {
          name,
          person: entry?.person || '',
          points: s.points,
          maxPoints: s.maxPoints,
          correct: s.correct,
          incorrect: s.incorrect,
          champion: champGame?.pick || '',
        };
      })
      .sort((a, b) => b.points - a.points || b.maxPoints - a.maxPoints);
  }, [scores, bracketEntries, activeBrackets]);

  const load = useCallback(async () => {
    try {
      const data = await fetchEspnLeaderboard();
      setEntries(data);
      setLastUpdated(new Date());
      setError('');
    } catch (err) {
      setError('Failed to load ESPN leaderboard');
      console.warn(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [load]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else {
      setSortField(field);
      setSortAsc(field === 'rank');
    }
  };

  const arrow = (field: SortField) => sortField === field ? (sortAsc ? ' ▲' : ' ▼') : '';

  const sorted = [...entries].sort((a, b) => {
    let diff: number;
    if (sortField === 'rank') diff = a.rank - b.rank;
    else diff = b[sortField] - a[sortField];
    if (diff === 0) diff = a.rank - b.rank;
    return sortAsc ? diff : -diff;
  });

  return (
    <div className="espn-leaderboard">
      {/* Full ESPN pool leaderboard */}
      <div className="espn-header">
        <h2>Full ESPN Mandel Pool</h2>
        <div className="espn-meta">
          <span className="espn-count">{entries.length} brackets</span>
          {lastUpdated && (
            <span className="espn-updated">Updated {lastUpdated.toLocaleTimeString()}</span>
          )}
          <button className="espn-refresh-btn" onClick={load}>↻ Refresh</button>
        </div>
      </div>

      {loading ? (
        <div className="empty-state"><p>Loading ESPN leaderboard...</p></div>
      ) : error ? (
        <div className="empty-state"><p>{error}</p><button className="btn" onClick={load}>Retry</button></div>
      ) : (
        <table className="leaderboard-table espn-table">
          <thead>
            <tr>
              <th className="sortable-th" onClick={() => toggleSort('rank')}>Rank{arrow('rank')}</th>
              <th>Name</th>
              <th className="sortable-th" onClick={() => toggleSort('points')}>Points{arrow('points')}</th>
              <th className="sortable-th" onClick={() => toggleSort('maxPoints')}>Max{arrow('maxPoints')}</th>
              <th>Champion</th>
              <th className="sortable-th" onClick={() => toggleSort('correct')}>Correct{arrow('correct')}</th>
              <th className="sortable-th" onClick={() => toggleSort('wrong')}>Wrong{arrow('wrong')}</th>
              <th className="sortable-th" onClick={() => toggleSort('percentile')}>Percentile{arrow('percentile')}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((e, i) => {
              const rankClass = e.rank === 1 ? 'rank-1' : e.rank === 2 ? 'rank-2' : e.rank === 3 ? 'rank-3' : '';
              const pctStr = e.percentile > 0 ? (e.percentile * 100).toFixed(1) + '%' : '-';
              return (
                <tr key={`${e.name}-${i}`} className={e.eliminated ? 'espn-eliminated' : ''}>
                  <td className={rankClass}>{e.rank}</td>
                  <td>{e.name}</td>
                  <td style={{ fontWeight: 700, color: 'var(--accent)' }}>{e.points}</td>
                  <td className="max-points">{e.maxPoints}</td>
                  <td className="champ-col">{e.champion ? `🏆 ${e.champion}` : '-'}</td>
                  <td className="correct">{e.correct}</td>
                  <td className="incorrect">{e.wrong}</td>
                  <td>{pctStr}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Our Mandel brackets - from Firebase */}
      {ourMandel.length > 0 && (
        <>
          <div className="espn-header" style={{ marginTop: '2rem' }}>
            <h2>Our Mandel Brackets</h2>
          </div>
          <table className="leaderboard-table espn-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Name</th>
                <th>Points</th>
                <th>Max</th>
                <th>Champion</th>
                <th>Correct</th>
                <th>Wrong</th>
              </tr>
            </thead>
            <tbody>
              {ourMandel.map((e, i) => {
                const rankClass = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : '';
                return (
                  <tr key={e.name}>
                    <td className={rankClass}>{i + 1}</td>
                    <td>{e.person} — {e.name}</td>
                    <td style={{ fontWeight: 700, color: 'var(--accent)' }}>{e.points}</td>
                    <td className="max-points">{e.maxPoints}</td>
                    <td className="champ-col">{e.champion ? `🏆 ${e.champion}` : '-'}</td>
                    <td className="correct">{e.correct}</td>
                    <td className="incorrect">{e.incorrect}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
