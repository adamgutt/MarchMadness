import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { fetchLiveResults } from '../utils/liveResults';
import { useBrackets } from '../context/BracketContext';
import {
  type TournamentGame, type CompactBracket,
  loadScenarioData, buildOutcomeNameMap, mergeGamesWithLive,
  calcLeaderboard, calcBestRanks,
} from '../utils/scenarioRanks';

// ── Types ──────────────────────────────────────────────────────────────────────

interface TreeSlot {
  game: TournamentGame;
  team1: string | null;
  team1OutcomeId: string | null;
  team1Seed: string;
  team2: string | null;
  team2OutcomeId: string | null;
  team2Seed: string;
  winnerId: string | null;
  winnerName: string | null;
  concluded: boolean;
  clickable: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const REGIONS = ['East', 'South', 'West', 'Midwest'];
const SEED_MATCHUPS = [[1,16],[8,9],[5,12],[4,13],[6,11],[3,14],[7,10],[2,15]];

// ── Bracket Tree ───────────────────────────────────────────────────────────────

type RegionTree = { name: string; r64: TreeSlot[]; r32: TreeSlot[]; s16: TreeSlot[]; e8: TreeSlot[] };

function buildTree(games: TournamentGame[], userWinners: Record<string, string>, outcomeNames: Record<string, string>) {
  const byKey: Record<string, TournamentGame> = {};
  for (const g of games) byKey[`${g.period}_${g.regionIdx}_${g.position}`] = g;

  function winnerId(g: TournamentGame): string | null {
    return g.concluded && g.winnerOutcomeId ? g.winnerOutcomeId : userWinners[g.propId] || null;
  }

  function findOid(g: TournamentGame, team: string): string | null {
    const n = team.toLowerCase().trim();
    return g.outcomes.find(o => o.name.toLowerCase().trim() === n)?.id || null;
  }

  function slot(g: TournamentGame, t1: string | null, s1: string, t2: string | null, s2: string): TreeSlot {
    const wid = winnerId(g);
    return {
      game: g,
      team1: t1, team1OutcomeId: t1 ? findOid(g, t1) : null, team1Seed: s1,
      team2: t2, team2OutcomeId: t2 ? findOid(g, t2) : null, team2Seed: s2,
      winnerId: wid, winnerName: wid ? outcomeNames[wid] || null : null,
      concluded: g.concluded,
      clickable: !g.concluded && !!t1 && !!t2,
    };
  }

  function seedOf(team: string, r64: TreeSlot[]): string {
    for (const s of r64) {
      if (s.team1 === team) return s.team1Seed;
      if (s.team2 === team) return s.team2Seed;
    }
    return '';
  }
  function seedAcross(team: string, regions: RegionTree[]): string {
    for (const r of regions) { const s = seedOf(team, r.r64); if (s) return s; }
    return '';
  }

  // Helper: check if all teams from a feeder slot appear in a game's outcomes
  function outcomeSet(g: TournamentGame) {
    return new Set(g.outcomes.map(o => o.name.toLowerCase().trim()));
  }

  const regions: RegionTree[] = REGIONS.map((name, ri) => {
    const r64: TreeSlot[] = [];
    for (let p = 0; p < 8; p++) {
      const g = byKey[`1_${ri}_${p}`]; if (!g) continue;
      const [s1, s2] = SEED_MATCHUPS[p];
      r64.push(slot(g, g.outcomes[0]?.name, s1.toString(), g.outcomes[1]?.name, s2.toString()));
    }

    // Collect all R32 games for this region
    const r32Games: TournamentGame[] = [];
    for (let p = 0; p < 4; p++) { const g = byKey[`2_${ri}_${p}`]; if (g) r32Games.push(g); }

    // Match R32 games to R64 feeder pairs by outcome overlap
    const r32: TreeSlot[] = [];
    for (let pair = 0; pair < 4; pair++) {
      const a = r64[pair * 2], b = r64[pair * 2 + 1];
      if (!a || !b) continue;
      const matched = r32Games.find(g => {
        const names = outcomeSet(g);
        return !!a.team1 && names.has(a.team1.toLowerCase().trim())
            && !!b.team1 && names.has(b.team1.toLowerCase().trim());
      });
      if (!matched) continue;
      const top = a.winnerName, bot = b.winnerName;
      r32.push(slot(matched, top||null, top? seedOf(top, r64):'', bot||null, bot? seedOf(bot, r64):''));
    }

    // Collect all S16 games for this region
    const s16Games: TournamentGame[] = [];
    for (let p = 0; p < 2; p++) { const g = byKey[`3_${ri}_${p}`]; if (g) s16Games.push(g); }

    // Match S16 games to R32 feeder pairs by outcome overlap
    const s16: TreeSlot[] = [];
    for (let pair = 0; pair < 2; pair++) {
      const a = r32[pair * 2], b = r32[pair * 2 + 1];
      if (!a || !b) continue;
      const refA = a.team1 || a.team2, refB = b.team1 || b.team2;
      const matched = s16Games.find(g => {
        const names = outcomeSet(g);
        return !!refA && names.has(refA.toLowerCase().trim())
            && !!refB && names.has(refB.toLowerCase().trim());
      });
      if (!matched) continue;
      const top = a.winnerName, bot = b.winnerName;
      s16.push(slot(matched, top||null, top? seedOf(top, r64):'', bot||null, bot? seedOf(bot, r64):''));
    }

    const e8: TreeSlot[] = [];
    const eg = byKey[`4_${ri}_0`];
    if (eg) {
      const top = s16[0]?.winnerName, bot = s16[1]?.winnerName;
      e8.push(slot(eg, top||null, top? seedOf(top, r64):'', bot||null, bot? seedOf(bot, r64):''));
    }

    return { name, r64, r32, s16, e8 };
  });

  // Collect F4 games and match by outcome overlap with region E8 teams
  const ffGames: TournamentGame[] = [];
  for (let i = 0; i < 2; i++) { const g = byKey[`5_-1_${i}`]; if (g) ffGames.push(g); }

  const ff: TreeSlot[] = [];
  for (let pair = 0; pair < 2; pair++) {
    const rA = regions[pair * 2], rB = regions[pair * 2 + 1];
    const refA = rA?.e8[0]?.team1 || rA?.e8[0]?.team2 || rA?.r64[0]?.team1;
    const refB = rB?.e8[0]?.team1 || rB?.e8[0]?.team2 || rB?.r64[0]?.team1;
    const matched = ffGames.find(g => {
      const names = outcomeSet(g);
      return !!refA && names.has(refA.toLowerCase().trim())
          && !!refB && names.has(refB.toLowerCase().trim());
    });
    if (!matched) continue;
    const top = rA?.e8[0]?.winnerName||null, bot = rB?.e8[0]?.winnerName||null;
    ff.push(slot(matched, top, top? seedAcross(top, regions):'', bot, bot? seedAcross(bot, regions):''));
  }

  const cg = byKey['6_-1_0'] || games[games.length - 1];
  const ct = ff[0]?.winnerName, cb = ff[1]?.winnerName;
  const championship = slot(cg, ct||null, ct? seedAcross(ct, regions):'', cb||null, cb? seedAcross(cb, regions):'');

  return { regions, ff, championship };
}

// ── Downstream clearing ────────────────────────────────────────────────────────

function clearDownstream(propId: string, winners: Record<string, string>, games: TournamentGame[], outcomeNames: Record<string, string>) {
  const game = games.find(g => g.propId === propId);
  if (!game) return;
  const oldId = winners[propId];
  if (!oldId) return;
  const oldName = outcomeNames[oldId]?.toLowerCase().trim();
  if (!oldName) return;
  for (const g of games) {
    if (g.period <= game.period || !winners[g.propId]) continue;
    if (outcomeNames[winners[g.propId]]?.toLowerCase().trim() === oldName) delete winners[g.propId];
  }
}

// ── Slot Component ─────────────────────────────────────────────────────────────

function ScenarioSlot({ slot, onPick }: { slot: TreeSlot; onPick: (p: string, o: string) => void }) {
  const click = (oid: string | null) => { if (slot.clickable && oid) onPick(slot.game.propId, oid); };
  const is1Win = slot.winnerId === slot.team1OutcomeId;
  const is2Win = slot.winnerId === slot.team2OutcomeId;
  const isUser = !slot.concluded && !!slot.winnerId;

  return (
    <div className={`slot-card ${slot.concluded ? 'slot-decided' : ''} ${isUser ? 'slot-user-pick' : ''}`}>
      <div
        className={`slot-team slot-top ${is1Win ? (slot.concluded ? 'team-won' : 'team-user-won') : ''} ${slot.winnerId && !is1Win && slot.team1 ? 'team-lost' : ''} ${slot.clickable ? 'slot-clickable' : ''}`}
        onClick={() => click(slot.team1OutcomeId)}
      >
        <span className="slot-seed">{slot.team1Seed}</span>
        <span className="slot-name">{slot.team1 || 'TBD'}</span>
      </div>
      <div
        className={`slot-team slot-bottom ${is2Win ? (slot.concluded ? 'team-won' : 'team-user-won') : ''} ${slot.winnerId && !is2Win && slot.team2 ? 'team-lost' : ''} ${slot.clickable ? 'slot-clickable' : ''}`}
        onClick={() => click(slot.team2OutcomeId)}
      >
        <span className="slot-seed">{slot.team2Seed}</span>
        <span className="slot-name">{slot.team2 || 'TBD'}</span>
      </div>
    </div>
  );
}

function RegionColumn({ region, side, onPick }: { region: RegionTree; side: 'left' | 'right'; onPick: (p: string, o: string) => void }) {
  const rounds = [region.r64, region.r32, region.s16, region.e8];
  const display = side === 'right' ? [...rounds].reverse() : rounds;
  return (
    <div className={`region-bracket region-${side}`}>
      <div className="region-label">{region.name}</div>
      <div className="region-rounds">
        {display.map((slots, ri) => (
          <div key={ri} className={`round-column round-col-${slots.length}`}>
            {slots.map(s => <ScenarioSlot key={s.game.propId} slot={s} onPick={onPick} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function ScenarioGenerator() {
  const [games, setGames] = useState<TournamentGame[]>([]);
  const [brackets, setBrackets] = useState<CompactBracket[]>([]);
  const [loading, setLoading] = useState(true);
  const [userWinners, setUserWinners] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPrefill, setSelectedPrefill] = useState('');
  const gamesRef = useRef<TournamentGame[]>([]);

  // Clean up userWinners when games change (e.g., new game concludes):
  // 1. Remove picks for now-concluded games (actual result takes over)
  // 2. Remove picks for eliminated teams in later rounds
  useEffect(() => {
    if (!games.length) return;
    setUserWinners(prev => {
      const next = { ...prev };
      let changed = false;

      // Build eliminated team names from concluded games
      const eliminatedNames = new Set<string>();
      for (const g of games) {
        if (!g.concluded || !g.winnerOutcomeId) continue;
        for (const o of g.outcomes) {
          if (o.id !== g.winnerOutcomeId) eliminatedNames.add(o.name.toLowerCase().trim());
        }
      }

      // Build outcomeId -> name lookup
      const oidName: Record<string, string> = {};
      for (const g of games) for (const o of g.outcomes) oidName[o.id] = o.name.toLowerCase().trim();

      for (const propId of Object.keys(next)) {
        const g = games.find(gm => gm.propId === propId);
        // Remove picks for games that are now concluded
        if (g?.concluded) { delete next[propId]; changed = true; continue; }
        // Remove picks for eliminated teams
        const teamName = oidName[next[propId]];
        if (teamName && eliminatedNames.has(teamName)) { delete next[propId]; changed = true; }
      }
      return changed ? next : prev;
    });
  }, [games]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    loadScenarioData().then(async data => {
      if (data) {
        try {
          const live = await fetchLiveResults();
          const merged = mergeGamesWithLive(data.games, live);
          setGames(merged);
          gamesRef.current = data.games;
        } catch {
          setGames(data.games);
          gamesRef.current = data.games;
        }
        setBrackets(data.brackets);

        interval = setInterval(async () => {
          try {
            const live = await fetchLiveResults();
            const merged = mergeGamesWithLive(gamesRef.current, live);
            setGames(merged);
          } catch { /* silent */ }
        }, 30000);
      }
      setLoading(false);
    });
    return () => { if (interval) clearInterval(interval); };
  }, []);

  const outcomeNames = useMemo(() => buildOutcomeNameMap(games), [games]);

  // Get Mandel bracket entries for prefill dropdown
  const { entries: bracketEntries } = useBrackets();
  const mandelEntries = useMemo(() =>
    bracketEntries
      .filter(e => e.pool === 'Mandel')
      .sort((a, b) => `${a.person} ${a.name}`.localeCompare(`${b.person} ${b.name}`))
  , [bracketEntries]);

  // Best possible rank for each Mandel bracket (dream scenario simulation)
  const bestRanks = useMemo(() => {
    if (!games.length || !brackets.length || !mandelEntries.length) return {};
    return calcBestRanks(games, brackets, mandelEntries.map(e => e.name), outcomeNames);
  }, [games, brackets, mandelEntries, outcomeNames]);

  // Prefill user picks from a Mandel bracket's best-case (dream) scenario
  const handlePrefill = useCallback((bracketName: string) => {
    setSelectedPrefill(bracketName);
    if (!bracketName) { setUserWinners({}); return; }

    // Use the pre-computed dream scenario to fill ALL remaining games (no TBDs)
    const bestInfo = bestRanks[bracketName];
    if (bestInfo?.dreamWinners) {
      const prefilled: Record<string, string> = {};
      for (const g of games) {
        if (g.concluded) continue;
        const dw = bestInfo.dreamWinners[g.propId];
        if (dw) prefilled[g.propId] = dw;
      }
      setUserWinners(prefilled);
      return;
    }

    // Fallback: just prefill bracket's own alive picks
    const match = brackets.find(b => b.name.toLowerCase().trim() === bracketName.toLowerCase().trim());
    if (!match) return;
    const oidToName: Record<string, string> = {};
    for (const g of games) {
      for (const o of g.outcomes) oidToName[o.id] = o.name.toLowerCase().trim();
    }
    const eliminatedNames = new Set<string>();
    for (const g of games) {
      if (!g.concluded || !g.winnerOutcomeId) continue;
      for (const o of g.outcomes) {
        if (o.id !== g.winnerOutcomeId) eliminatedNames.add(o.name.toLowerCase().trim());
      }
    }
    const prefilled: Record<string, string> = {};
    const sorted = [...games].sort((a, b) => a.period - b.period);
    for (const g of sorted) {
      if (g.concluded) continue;
      const pick = match.picks[g.propId];
      if (!pick) continue;
      const teamName = oidToName[pick];
      if (teamName && eliminatedNames.has(teamName)) continue;
      prefilled[g.propId] = pick;
    }
    setUserWinners(prefilled);
  }, [bestRanks, brackets, games]);

  const handlePick = useCallback((propId: string, outcomeId: string) => {
    setUserWinners(prev => {
      const next = { ...prev };
      if (next[propId] === outcomeId) {
        delete next[propId];
        clearDownstream(propId, next, games, outcomeNames);
        return next;
      }
      if (next[propId]) clearDownstream(propId, next, games, outcomeNames);
      next[propId] = outcomeId;
      return next;
    });
  }, [games, outcomeNames]);

  const tree = useMemo(() => {
    if (!games.length) return null;
    return buildTree(games, userWinners, outcomeNames);
  }, [games, userWinners, outcomeNames]);

  const leaderboard = useMemo(() => {
    if (!games.length || !brackets.length) return [];
    return calcLeaderboard(games, brackets, userWinners, outcomeNames);
  }, [games, brackets, userWinners, outcomeNames]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return leaderboard;
    const q = searchQuery.toLowerCase();
    return leaderboard.filter(e => e.name.toLowerCase().includes(q) || e.champion.toLowerCase().includes(q));
  }, [leaderboard, searchQuery]);

  const userCount = Object.keys(userWinners).length;
  const remaining = games.filter(g => !g.concluded).length - userCount;

  if (loading) return <div className="scenario-page"><div className="scenario-loading">Loading Mandel pool brackets...</div></div>;
  if (!tree) return <div className="scenario-page"><div className="scenario-loading">No data found.</div></div>;

  return (
    <div className="scenario-page">
      <div className="scenario-page-header">
        <h2>Mandel Pool — Scenario Generator</h2>
        <p>Click a team to advance them. Leaderboard updates live across all {brackets.length.toLocaleString()} Mandel brackets.</p>
      </div>

      <div className="scenario-controls">
        <select
          className="filter-select"
          value={selectedPrefill}
          onChange={e => handlePrefill(e.target.value)}
        >
          <option value="">Prefill from bracket...</option>
          {mandelEntries.map(e => {
            const best = bestRanks[e.name]?.rank;
            const tag = best ? ` (Best: #${best})` : '';
            return <option key={e.name} value={e.name}>{e.person} — {e.name}{tag}</option>;
          })}
        </select>
        <button className="btn btn-scenario-reset" onClick={() => { setUserWinners({}); setSelectedPrefill(''); }}>Reset All</button>
        <div className="scenario-counts">
          <span className="count-win">{userCount} set</span>
          <span className="count-undecided">{remaining} remaining</span>
        </div>
      </div>

      <div className="bracket-container">
        <div className="bracket-desktop">
          <div className="bracket-half bracket-left">
            <RegionColumn region={tree.regions[0]} side="left" onPick={handlePick} />
            <RegionColumn region={tree.regions[1]} side="left" onPick={handlePick} />
          </div>
          <div className="bracket-center">
            <div className="ff-column">
              <ScenarioSlot slot={tree.ff[0]} onPick={handlePick} />
              <div className="champ-slot">
                <ScenarioSlot slot={tree.championship} onPick={handlePick} />
                {tree.championship.winnerName && <div className="champ-banner">🏆 {tree.championship.winnerName}</div>}
              </div>
              <ScenarioSlot slot={tree.ff[1]} onPick={handlePick} />
            </div>
          </div>
          <div className="bracket-half bracket-right">
            <RegionColumn region={tree.regions[2]} side="right" onPick={handlePick} />
            <RegionColumn region={tree.regions[3]} side="right" onPick={handlePick} />
          </div>
        </div>
      </div>

      <div className="scenario-leaderboard">
        <div className="scenario-lb-header">
          <h3>Leaderboard</h3>
          <input className="search-input" type="text" placeholder="Search brackets..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
          <span className="scenario-lb-count">{brackets.length} brackets</span>
        </div>
        <div className="scenario-lb-table">
          <div className="scenario-lb-row scenario-lb-head">
            <span className="lb-col-rank">#</span>
            <span className="lb-col-name">Bracket</span>
            <span className="lb-col-champ">Champion</span>
            <span className="lb-col-score">Score</span>
            <span className="lb-col-max">Max</span>
            <span className="lb-col-tb">TB</span>
          </div>
          {filtered.slice(0, 100).map((entry, i) => {
            const isAvi = entry.name.toLowerCase().includes('guttman');
            return (
              <div key={entry.name + i} className={`scenario-lb-row ${isAvi ? 'scenario-lb-highlight' : ''}`}>
                <span className="lb-col-rank">{i + 1}</span>
                <span className="lb-col-name">{entry.name}</span>
                <span className="lb-col-champ">{entry.champion}</span>
                <span className="lb-col-score">{entry.score}</span>
                <span className="lb-col-max">{entry.maxPoints}</span>
                <span className="lb-col-tb">{entry.tiebreaker}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
