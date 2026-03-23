// Shared scenario-data loading and best-rank computation.
// Used by both ScenarioGenerator and Leaderboard to keep "can be #1" logic identical.

import { db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { fetchLiveResults } from './liveResults';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Outcome { id: string; name: string; }

export interface TournamentGame {
  propId: string;
  period: number;
  round: string;
  regionIdx: number;
  region: string;
  position: number;
  outcomes: Outcome[];
  seed1: string;
  seed2: string;
  winnerOutcomeId: string | null;
  concluded: boolean;
}

export interface CompactBracket {
  id: string;
  name: string;
  champion: string;
  tiebreaker: number;
  rank: number;
  picks: Record<string, string>;
}

export const POINTS: Record<number, number> = { 1: 10, 2: 20, 3: 40, 4: 80, 5: 160, 6: 320 };

// ── Data Loading ───────────────────────────────────────────────────────────────

export async function loadScenarioData(): Promise<{ games: TournamentGame[]; brackets: CompactBracket[] } | null> {
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

export function buildOutcomeNameMap(games: TournamentGame[]) {
  const map: Record<string, string> = {};
  for (const g of games) for (const o of g.outcomes) map[o.id] = o.name;
  return map;
}

export function mergeGamesWithLive(baseGames: TournamentGame[], liveResults: Record<string, string>): TournamentGame[] {
  return baseGames.map(g => {
    const liveWinner = liveResults[g.propId];
    if (liveWinner) return { ...g, concluded: true, winnerOutcomeId: liveWinner };
    return g;
  });
}

// ── Score Calculation ──────────────────────────────────────────────────────────

export function calcLeaderboard(
  games: TournamentGame[],
  brackets: CompactBracket[],
  userWinners: Record<string, string>,
  outcomeNames: Record<string, string>,
) {
  const allWinners: Record<string, string> = {};
  for (const g of games) {
    if (g.concluded && g.winnerOutcomeId) allWinners[g.propId] = g.winnerOutcomeId;
    else if (userWinners[g.propId]) allWinners[g.propId] = userWinners[g.propId];
  }

  const eliminated = new Set<string>();
  for (let period = 1; period <= 6; period++) {
    for (const g of games) {
      if (g.period !== period) continue;
      const wId = allWinners[g.propId];
      if (!wId) continue;
      for (const o of g.outcomes) {
        if (o.id !== wId && !eliminated.has(o.name.toLowerCase().trim())) {
          eliminated.add(o.name.toLowerCase().trim());
        }
      }
    }
  }

  return brackets.map(b => {
    let score = 0, maxPoints = 0;
    for (const g of games) {
      const pick = b.picks[g.propId];
      if (!pick) continue;
      const pts = POINTS[g.period] || 0;
      const wId = allWinners[g.propId];
      if (wId) {
        if (pick === wId) { score += pts; maxPoints += pts; }
      } else {
        const team = outcomeNames[pick]?.toLowerCase().trim();
        if (team && !eliminated.has(team)) maxPoints += pts;
      }
    }
    return { name: b.name, champion: b.champion, score, maxPoints, rank: b.rank, tiebreaker: b.tiebreaker };
  }).sort((a, b) => b.score - a.score || b.maxPoints - a.maxPoints);
}

// ── Best-rank simulation ───────────────────────────────────────────────────────

export function calcBestRanks(
  games: TournamentGame[],
  brackets: CompactBracket[],
  targetNames: string[],
  outcomeNames: Record<string, string>,
): Record<string, { rank: number; dreamWinners: Record<string, string> }> {
  const results: Record<string, { rank: number; dreamWinners: Record<string, string> }> = {};

  const pickCounts: Record<string, Record<string, number>> = {};
  for (const g of games) {
    const counts: Record<string, number> = {};
    for (const o of g.outcomes) counts[o.id] = 0;
    for (const b of brackets) {
      const pick = b.picks[g.propId];
      if (pick && counts[pick] !== undefined) counts[pick]++;
    }
    pickCounts[g.propId] = counts;
  }

  for (const mName of targetNames) {
    const bracket = brackets.find(b => b.name.toLowerCase().trim() === mName.toLowerCase().trim());
    if (!bracket) continue;

    const dreamWinners: Record<string, string> = {};
    const eliminated = new Set<string>();

    for (const g of games) {
      if (g.concluded && g.winnerOutcomeId) {
        dreamWinners[g.propId] = g.winnerOutcomeId;
        for (const o of g.outcomes) {
          if (o.id !== g.winnerOutcomeId) eliminated.add(o.name.toLowerCase().trim());
        }
      }
    }

    for (let period = 1; period <= 6; period++) {
      for (const g of games) {
        if (g.period !== period || g.concluded) continue;

        const pick = bracket.picks[g.propId];
        const pickName = pick ? outcomeNames[pick]?.toLowerCase().trim() : null;
        const aliveOutcomes = g.outcomes.filter(o => !eliminated.has(o.name.toLowerCase().trim()));

        if (pick && pickName && !eliminated.has(pickName)) {
          dreamWinners[g.propId] = pick;
          for (const o of g.outcomes) {
            if (o.id !== pick) eliminated.add(o.name.toLowerCase().trim());
          }
        } else if (aliveOutcomes.length >= 2) {
          aliveOutcomes.sort((a, b) => (pickCounts[g.propId]?.[a.id] || 0) - (pickCounts[g.propId]?.[b.id] || 0));
          const winner = aliveOutcomes[0];
          dreamWinners[g.propId] = winner.id;
          for (const o of g.outcomes) {
            if (o.id !== winner.id) eliminated.add(o.name.toLowerCase().trim());
          }
        } else if (aliveOutcomes.length === 1) {
          dreamWinners[g.propId] = aliveOutcomes[0].id;
        }
      }
    }

    const lb = calcLeaderboard(games, brackets, dreamWinners, outcomeNames);
    const entry = lb.find(e => e.name === bracket.name);
    if (entry) {
      const rank = lb.filter(e => e.score > entry.score).length + 1;
      results[mName] = { rank, dreamWinners };
    } else {
      results[mName] = { rank: 9999, dreamWinners };
    }
  }
  return results;
}

// ── Convenience: load everything and return the set of names that can be #1 ───

export async function loadCanWinSet(bracketNames: string[]): Promise<Set<string>> {
  const data = await loadScenarioData();
  if (!data) return new Set();

  let games = data.games;
  try {
    const live = await fetchLiveResults();
    games = mergeGamesWithLive(games, live);
  } catch { /* use cached data */ }

  const outcomeNames = buildOutcomeNameMap(games);
  const ranks = calcBestRanks(games, data.brackets, bracketNames, outcomeNames);

  const canWin = new Set<string>();
  for (const [name, info] of Object.entries(ranks)) {
    if (info.rank === 1) canWin.add(name);
  }
  return canWin;
}
