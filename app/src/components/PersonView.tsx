import { useState } from 'react';
import { useBrackets } from '../context/BracketContext';
import { getGameKey, normalizeTeamName } from '../utils/csv';

export function PersonView() {
  const { filteredBrackets, results, filteredScores, entries } = useBrackets();
  const [selected, setSelected] = useState('');
  const bracketNames = Object.keys(filteredBrackets).sort();

  const data = selected ? filteredBrackets[selected] : null;
  const s = selected ? filteredScores[selected] : null;

  return (
    <div>
      <select
        className="person-select"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
      >
        <option value="">-- Select a bracket --</option>
        {bracketNames.map(name => {
          const entry = entries.find(e => e.name === name);
          const label = entry?.person ? `${entry.person} — ${name}` : name;
          return <option key={name} value={name}>{label}</option>;
        })}
      </select>

      {data && s && (
        <>
          <div className="stats-grid" style={{ marginBottom: '1rem' }}>
            <div className="stat-card">
              <div className="stat-value" style={{ color: 'var(--green)' }}>{s.correct}</div>
              <div className="stat-label">Correct</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: 'var(--red)' }}>{s.incorrect}</div>
              <div className="stat-label">Wrong</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{s.points}</div>
              <div className="stat-label">Points</div>
            </div>
            <div className="stat-card">
              <div className="stat-value" style={{ color: 'var(--muted)' }}>{s.pending}</div>
              <div className="stat-label">Pending</div>
            </div>
          </div>

          <div className="person-picks-grid">
            {data.games.map(g => {
              const key = getGameKey(g.team1, g.team2);
              const result = results[key];
              let statusClass = 'pending';
              if (result?.winner) {
                statusClass = normalizeTeamName(g.pick) === normalizeTeamName(result.winner)
                  ? 'correct' : 'incorrect';
              }

              const pickColor =
                statusClass === 'correct' ? 'var(--green)' :
                statusClass === 'incorrect' ? 'var(--red)' : 'var(--text)';

              return (
                <div key={key} className="person-pick-card">
                  <div>
                    <div className="matchup">{g.round}: {g.team1} vs {g.team2}</div>
                    <div className="pick" style={{ color: pickColor }}>
                      Picked: {g.pick}
                    </div>
                  </div>
                  <div title={statusClass}>
                    <span className={`status-dot ${statusClass}`} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {!data && (
        <div className="empty-state"><p>Select a person above to see their picks.</p></div>
      )}
    </div>
  );
}
