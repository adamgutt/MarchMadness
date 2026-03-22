import { useState, useEffect, useMemo, useRef } from 'react';
import { db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { fetchLiveResults } from '../utils/liveResults';
import { useBrackets } from '../context/BracketContext';

// ── Types (mirrors scenario_data structure) ────────────────────────────────────

interface Outcome { id: string; name: string; }

interface TournamentGame {
  propId: string;
  period: number;
  outcomes: Outcome[];
  winnerOutcomeId: string | null;
  concluded: boolean;
}

interface CompactBracket {
  id: string;
  name: string;
  champion: string;
  rank: number;
  picks: Record<string, string>;   // propId -> outcomeId
}

interface LeaderboardRow {
  name: string;
  champion: string;
  rank: number;
  points: number;
  maxPoints: number;
  correct: number;
  wrong: number;
}

// ── Scoring ────────────────────────────────────────────────────────────────────

const POINTS: Record<number, number> = { 1: 10, 2: 20, 3: 40, 4: 80, 5: 160, 6: 320 };

function scoreAll(games: TournamentGame[], brackets: CompactBracket[]): LeaderboardRow[] {
  // Build outcome name map for elimination tracking
  const outcomeNames: Record<string, string> = {};
  for (const g of games) for (const o of g.outcomes) outcomeNames[o.id] = o.name;

  // Concluded winners
  const winners: Record<string, string> = {};
  for (const g of games) {
    if (g.concluded && g.winnerOutcomeId) winners[g.propId] = g.winnerOutcomeId;
  }

  // Track eliminated teams
  const eliminated = new Set<string>();
  for (let period = 1; period <= 6; period++) {
    for (const g of games) {
      if (g.period !== period) continue;
      const wId = winners[g.propId];
      if (!wId) continue;
      for (const o of g.outcomes) {
        if (o.id !== wId) eliminated.add(o.name.toLowerCase().trim());
      }
    }
  }

  return brackets.map(b => {
    let points = 0, maxPoints = 0, correct = 0, wrong = 0;
    for (const g of games) {
      const pick = b.picks[g.propId];
      if (!pick) continue;
      const pts = POINTS[g.period] || 0;
      const wId = winners[g.propId];
      if (wId) {
        if (pick === wId) { points += pts; maxPoints += pts; correct++; }
        else { wrong++; }
      } else {
        const team = outcomeNames[pick]?.toLowerCase().trim();
        if (team && !eliminated.has(team)) maxPoints += pts;
      }
    }
    return { name: b.name, champion: b.champion, rank: b.rank, points, maxPoints, correct, wrong };
  }).sort((a, b) => b.points - a.points || b.maxPoints - a.maxPoints);
}

// ── Data Loading ───────────────────────────────────────────────────────────────

async function loadFromFirebase() {
  const [tournamentSnap, metaSnap] = await Promise.all([
    getDoc(doc(db, 'scenario_data', 'tournament')),
    getDoc(doc(db, 'scenario_data', 'meta')),
  ]);
  if (!tournamentSnap.exists() || !metaSnap.exists()) return null;

  const games = tournamentSnap.data().games as TournamentGame[];
  const totalBatches = (metaSnap.data() as { totalBatches: number }).totalBatches;

  const batchSnaps = await Promise.all(
    Array.from({ length: totalBatches }, (_, i) => getDoc(doc(db, 'scenario_data', `picks_${i}`)))
  );
  const brackets: CompactBracket[] = [];
  for (const snap of batchSnaps) {
    if (snap.exists()) brackets.push(...(snap.data().brackets as CompactBracket[]));
  }

  return { games, brackets };
}

// ── Sort ───────────────────────────────────────────────────────────────────────

type SortField = 'rank' | 'points' | 'maxPoints' | 'correct' | 'wrong';

// ── Component ──────────────────────────────────────────────────────────────────

export function EspnLeaderboard({ onViewBracket }: {
  onViewBracket?: (name: string) => void;
  onViewEspnBracket?: unknown;
}) {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sortField, setSortField] = useState<SortField>('points');
  const [sortAsc, setSortAsc] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(100);
  const cachedRef = useRef<{ games: TournamentGame[]; brackets: CompactBracket[] } | null>(null);

  // Our brackets from Firebase (Mandel pool only — for the "Our Mandel" section)
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

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;

    const mergeAndScore = (baseGames: TournamentGame[], brackets: CompactBracket[], liveResults: Record<string, string>) => {
      const merged = baseGames.map(g => {
        const liveWinner = liveResults[g.propId];
        if (liveWinner) return { ...g, concluded: true, winnerOutcomeId: liveWinner };
        return g;
      });
      return scoreAll(merged, brackets);
    };

    loadFromFirebase().then(async data => {
      if (data) {
        cachedRef.current = data;
        try {
          const live = await fetchLiveResults();
          setRows(mergeAndScore(data.games, data.brackets, live));
        } catch {
          setRows(scoreAll(data.games, data.brackets));
        }

        // Poll for live updates every 30 seconds
        interval = setInterval(async () => {
          if (!cachedRef.current) return;
          try {
            const live = await fetchLiveResults();
            setRows(mergeAndScore(cachedRef.current.games, cachedRef.current.brackets, live));
          } catch { /* silent */ }
        }, 30000);
      } else {
        setError('No data found in Firebase');
      }
      setLoading(false);
    }).catch(err => {
      console.warn(err);
      setError('Failed to load leaderboard');
      setLoading(false);
    });

    return () => { if (interval) clearInterval(interval); };
  }, []);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else {
      setSortField(field);
      setSortAsc(field === 'rank');
    }
  };

  const arrow = (field: SortField) => sortField === field ? (sortAsc ? ' ▲' : ' ▼') : '';

  const filtered = useMemo(() => {
    let list = rows;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(e => e.name.toLowerCase().includes(q) || e.champion.toLowerCase().includes(q));
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      let diff: number;
      if (sortField === 'rank') diff = a.rank - b.rank;
      else diff = b[sortField] - a[sortField];
      if (diff === 0) diff = b.points - a.points;
      return sortAsc ? -diff : diff;
    });
    return sorted;
  }, [rows, sortField, sortAsc, searchQuery]);

  return (
    <div className="espn-leaderboard">
      {/* Full ESPN pool leaderboard */}
      <div className="espn-header">
        <h2>Mandel Pool Standings</h2>
        <div className="espn-meta">
          <span className="espn-count">{rows.length} brackets</span>
          <input
            className="search-input"
            type="text"
            placeholder="Search brackets..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="empty-state"><p>Loading leaderboard...</p></div>
      ) : error ? (
        <div className="empty-state"><p>{error}</p></div>
      ) : (
        <>
        <table className="leaderboard-table espn-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th className="sortable-th" onClick={() => toggleSort('points')}>Points{arrow('points')}</th>
              <th className="sortable-th" onClick={() => toggleSort('maxPoints')}>Max{arrow('maxPoints')}</th>
              <th>Champion</th>
              <th className="sortable-th" onClick={() => toggleSort('correct')}>Correct{arrow('correct')}</th>
              <th className="sortable-th" onClick={() => toggleSort('wrong')}>Wrong{arrow('wrong')}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, visibleCount).map((e, i) => {
              const isGuttman = e.name.toLowerCase().includes('guttman');
              const rankClass = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : '';
              return (
                <tr key={`${e.name}-${i}`} className={`espn-row-clickable ${isGuttman ? 'espn-highlight-row' : ''}`}>
                  <td className={rankClass}>{i + 1}</td>
                  <td className="espn-name-cell">{e.name}</td>
                  <td style={{ fontWeight: 700, color: 'var(--accent)' }}>{e.points}</td>
                  <td className="max-points">{e.maxPoints}</td>
                  <td className="champ-col">{e.champion ? `🏆 ${e.champion}` : '-'}</td>
                  <td className="correct">{e.correct}</td>
                  <td className="incorrect">{e.wrong}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length > visibleCount && (
          <div style={{ textAlign: 'center', marginTop: '1rem' }}>
            <button className="btn" onClick={() => setVisibleCount(prev => prev + 100)}>
              Load More ({filtered.length - visibleCount} remaining)
            </button>
          </div>
        )}
        </>
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
                    <td>
                      {onViewBracket ? (
                        <button className="link-btn bracket-link" onClick={() => onViewBracket(e.name)}>
                          {e.person} — {e.name}
                        </button>
                      ) : (
                        <>{e.person} — {e.name}</>
                      )}
                    </td>
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
