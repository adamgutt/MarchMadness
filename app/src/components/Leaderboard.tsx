import { useBrackets } from '../context/BracketContext';

interface LeaderboardProps {
  onViewBracket?: (bracketName: string) => void;
}

export function Leaderboard({ onViewBracket }: LeaderboardProps) {
  const { filteredScores, entries, selectedPool } = useBrackets();

  const sorted = Object.entries(filteredScores).sort(
    (a, b) => b[1].points - a[1].points || b[1].correct - a[1].correct
  );

  if (sorted.length === 0) {
    return <div className="empty-state"><p>No brackets loaded.</p></div>;
  }

  return (
    <table className="leaderboard-table">
      <thead>
        <tr>
          <th>Rank</th>
          <th>Name</th>
          <th>Points</th>
          <th>Max</th>
          <th>Correct</th>
          <th>Wrong</th>
          <th>Pending</th>
          <th>Accuracy</th>
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
              <td className="correct">{s.correct}</td>
              <td className="incorrect">{s.incorrect}</td>
              <td className="pending">{s.pending}</td>
              <td>{accuracy}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
