import { useState, useMemo } from 'react';
import { useBrackets } from '../context/BracketContext';
import { normalizeTeamName } from '../utils/csv';

export function GameBreakdown() {
  const { filteredGames, rounds, results } = useBrackets();
  const [activeRound, setActiveRound] = useState('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    let list = activeRound === 'all' ? filteredGames : filteredGames.filter(g => g.round === activeRound);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(g =>
        g.team1.toLowerCase().includes(q) || g.team2.toLowerCase().includes(q)
      );
    }
    return list;
  }, [filteredGames, activeRound, search]);

  return (
    <div>
      <div className="round-nav">
        <button
          className={`round-btn ${activeRound === 'all' ? 'active' : ''}`}
          onClick={() => setActiveRound('all')}
        >
          All Rounds
        </button>
        {rounds.map(r => (
          <button
            key={r}
            className={`round-btn ${activeRound === r ? 'active' : ''}`}
            onClick={() => setActiveRound(r)}
          >
            {r}
          </button>
        ))}
      </div>

      <div className="filter-row">
        <span className="filter-label">Search:</span>
        <input
          type="text"
          className="search-input"
          placeholder="Filter by team name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state"><p>No games match the current filter.</p></div>
      ) : (
        filtered.map(game => <GameCard key={game.key} game={game} result={results[game.key]} />)
      )}
    </div>
  );
}

import { Game, GameResult } from '../types';

function GameCard({ game, result }: { game: Game; result?: GameResult }) {
  const team1Pickers: string[] = [];
  const team2Pickers: string[] = [];

  for (const [person, pick] of Object.entries(game.picks)) {
    if (normalizeTeamName(pick) === normalizeTeamName(game.team1)) {
      team1Pickers.push(person);
    } else if (normalizeTeamName(pick) === normalizeTeamName(game.team2)) {
      team2Pickers.push(person);
    }
  }

  const total = team1Pickers.length + team2Pickers.length;
  const pct1 = total > 0 ? Math.round((team1Pickers.length / total) * 100) : 50;
  const pct2 = 100 - pct1;

  const getPickClass = (person: string) => {
    if (!result?.winner) return '';
    const pick = game.picks[person];
    return pick && normalizeTeamName(pick) === normalizeTeamName(result.winner) ? 'correct-pick' : 'wrong-pick';
  };

  const seedInfo1 = game.seed1 ? `(${game.seed1}) ` : '';
  const seedInfo2 = game.seed2 ? `(${game.seed2}) ` : '';

  return (
    <div className="game-card">
      <div className="game-header">
        <span className="game-matchup">
          {seedInfo1}{game.team1} vs {seedInfo2}{game.team2}
        </span>
        <span className="game-round">
          {game.round}{game.region ? ` - ${game.region}` : ''}
        </span>
      </div>

      {result?.winner ? (
        <div className="game-result decided">Winner: {result.winner}</div>
      ) : (
        <div className="game-result pending-result">Pending</div>
      )}

      <div className="pick-bars">
        <div className="pick-bar team-a" style={{ flex: pct1 || 1 }}>
          {game.team1} ({team1Pickers.length})
        </div>
        <div className="pick-bar team-b" style={{ flex: pct2 || 1 }}>
          {game.team2} ({team2Pickers.length})
        </div>
      </div>

      <div className="pick-details">
        <div className="pick-detail-group">
          <h4>{game.team1} ({pct1}%)</h4>
          <div className="pick-names">
            {team1Pickers.length > 0
              ? team1Pickers.map(p => (
                  <span key={p} className={`pick-name ${getPickClass(p)}`}>{p}</span>
                ))
              : <span className="pick-name">Nobody</span>}
          </div>
        </div>
        <div className="pick-detail-group" style={{ textAlign: 'right' }}>
          <h4>{game.team2} ({pct2}%)</h4>
          <div className="pick-names" style={{ justifyContent: 'flex-end' }}>
            {team2Pickers.length > 0
              ? team2Pickers.map(p => (
                  <span key={p} className={`pick-name ${getPickClass(p)}`}>{p}</span>
                ))
              : <span className="pick-name">Nobody</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
