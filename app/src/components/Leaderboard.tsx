import { useBrackets } from '../context/BracketContext';
import { useMemo, useState } from 'react';

type SortField = 'points' | 'maxPoints' | 'correct' | 'incorrect' | 'accuracy';

interface LeaderboardProps {
  onViewBracket?: (bracketName: string) => void;
  selectedPerson?: string;
}

export function Leaderboard({ onViewBracket, selectedPerson }: LeaderboardProps) {
  const { filteredScores, entries, selectedPool, activeBrackets } = useBrackets();
  const [sortField, setSortField] = useState<SortField>('points');
  const [sortAsc, setSortAsc] = useState(false);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(false); }
  };

  const arrow = (field: SortField) => sortField === field ? (sortAsc ? ' ▲' : ' ▼') : '';

  // Get championship pick for each bracket
  const champPicks = useMemo(() => {
    const picks: Record<string, string> = {};
    for (const [name, data] of Object.entries(activeBrackets)) {
      const champGame = data.games.find(g => g.round === 'Championship');
      if (champGame) picks[name] = champGame.pick;
    }
    return picks;
  }, [activeBrackets]);

  const sorted = Object.entries(filteredScores)
    .filter(([name]) => {
      if (!selectedPerson) return true;
      const entry = entries.find(e => e.name === name);
      return entry?.person === selectedPerson;
    })
    .sort((a, b) => {
      const [, sa] = a;
      const [, sb] = b;
      let diff: number;
      if (sortField === 'accuracy') {
        const da = sa.correct + sa.incorrect;
        const db = sb.correct + sb.incorrect;
        const aa = da > 0 ? sa.correct / da : 0;
        const ab = db > 0 ? sb.correct / db : 0;
        diff = ab - aa;
      } else {
        diff = sb[sortField] - sa[sortField];
      }
      if (diff === 0) diff = sb.points - sa.points || sb.correct - sa.correct;
      return sortAsc ? -diff : diff;
    });

  if (sorted.length === 0) {
    return <div className="empty-state"><p>No brackets loaded.</p></div>;
  }

  return (
    <table className="leaderboard-table">
      <thead>
        <tr>
          <th>Rank</th>
          <th>Name</th>
          <th className="sortable-th" onClick={() => toggleSort('points')}>Points{arrow('points')}</th>
          <th className="sortable-th" onClick={() => toggleSort('maxPoints')}>Max{arrow('maxPoints')}</th>
          <th>Champion</th>
          <th className="sortable-th" onClick={() => toggleSort('correct')}>Correct{arrow('correct')}</th>
          <th className="sortable-th" onClick={() => toggleSort('incorrect')}>Wrong{arrow('incorrect')}</th>
          <th className="sortable-th" onClick={() => toggleSort('accuracy')}>Accuracy{arrow('accuracy')}</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map(([name, s], i) => {
          const rankClass = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : '';
          const decided = s.correct + s.incorrect;
          const accuracy = decided > 0 ? Math.round((s.correct / decided) * 100) + '%' : '-';

          const entry = entries.find(e => e.name === name);
          const poolLabel = selectedPool === 'all' && entry ? entry.pool : '';
          const displayName = entry?.person ? `${entry.person} — ${name}` : name;
          return (
            <tr key={name}>
              <td className={rankClass}>{i + 1}</td>
              <td>
                {onViewBracket ? (
                  <button className="leaderboard-name-btn" onClick={() => onViewBracket(name)}>
                    {displayName}
                  </button>
                ) : displayName}
                {poolLabel && <span className="pool-badge">{poolLabel}</span>}
              </td>
              <td style={{ fontWeight: 700, color: 'var(--accent)' }}>{s.points}</td>
              <td className="max-points">{s.maxPoints}</td>
              <td className="champ-col">{champPicks[name] ? `🏆 ${champPicks[name]}` : '-'}</td>
              <td className="correct">{s.correct}</td>
              <td className="incorrect">{s.incorrect}</td>
              <td>{accuracy}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
