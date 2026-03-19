import { BracketData, Game, GameResult, PersonScore } from '../types';

// CSV parser that handles quoted fields
function parseLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = parseLine(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]/g, '_'));
  const rows = lines.slice(1).map(l => {
    const vals = parseLine(l);
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
    return obj;
  });

  return { headers, rows };
}

interface ColumnMapping {
  name: string | null;
  round: string | null;
  team1: string | null;
  team2: string | null;
  pick: string | null;
  seed1: string | null;
  seed2: string | null;
  region: string | null;
  matchup: string | null;
  opponent: string | null;
  pick_seed: string | null;
  opponent_seed: string | null;
}

export function detectBracketFormat(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {
    name: null, round: null, team1: null, team2: null,
    pick: null, seed1: null, seed2: null, region: null,
    matchup: null, opponent: null, pick_seed: null, opponent_seed: null,
  };

  for (const h of headers) {
    if (/^(name|person|owner|bracket_name|player|participant)$/.test(h)) mapping.name = h;
    if (/^(round|round_name|round_number|rd)$/.test(h)) mapping.round = h;
    if (/^(team_?1|team_a|higher_seed|top_team|team1)$/.test(h)) mapping.team1 = h;
    if (/^(team_?2|team_b|lower_seed|bottom_team|team2)$/.test(h)) mapping.team2 = h;
    if (/^(pick|winner|selection|picked|chosen|predicted_winner)$/.test(h)) mapping.pick = h;
    if (/^(seed_?1|seed_a|higher_seed_num)$/.test(h)) mapping.seed1 = h;
    if (/^(seed_?2|seed_b|lower_seed_num)$/.test(h)) mapping.seed2 = h;
    if (/^(region|bracket|section)$/.test(h)) mapping.region = h;
    if (/^(matchup|match|game|matchup_name)$/.test(h)) mapping.matchup = h;
    if (/^(opponent|opponent_name|opp|other_team)$/.test(h)) mapping.opponent = h;
    if (/^(pick_seed|pick_seed_num)$/.test(h)) mapping.pick_seed = h;
    if (/^(opponent_seed|opp_seed|opponent_seed_num)$/.test(h)) mapping.opponent_seed = h;
  }

  // Fallback: positional if no specific columns found
  if (!mapping.matchup && !mapping.team1 && !mapping.opponent) {
    if (!mapping.round && headers.length >= 4) mapping.round = headers[0];
    if (headers.length >= 4) mapping.team1 = headers[1];
    if (headers.length >= 4) mapping.team2 = headers[2];
    if (!mapping.pick && headers.length >= 4) mapping.pick = headers[3];
  }

  return mapping;
}

// Canonical lowercase aliases for teams whose CSV Pick column uses a different
// name than the Matchup column.
const TEAM_ALIASES: Record<string, string> = {
  'central florida': 'ucf',
  'mcneese state': 'mcneese',
  'connecticut': 'uconn',
};

/** Normalize a team name to a canonical lowercase form for matching. */
export function normalizeTeamName(name: string): string {
  const lower = name.toLowerCase().trim();
  return TEAM_ALIASES[lower] || lower;
}

export function getGameKey(team1: string, team2: string): string {
  return [normalizeTeamName(team1), normalizeTeamName(team2)].sort().join(' vs ');
}

function parseRow(row: Record<string, string>, mapping: ColumnMapping) {
  const round = row[mapping.round || ''] || 'Unknown';
  const region = row[mapping.region || ''] || '';
  const pick = row[mapping.pick || ''] || '';

  // Skip tiebreaker and non-game rows
  if (/^tiebreaker$/i.test(round)) return null;

  let team1 = '';
  let team2 = '';
  let seed1 = '';
  let seed2 = '';

  // Format: Matchup + Pick + Opponent (user's format)
  if (mapping.matchup || mapping.opponent) {
    const matchupStr = row[mapping.matchup || ''] || '';
    const opponent = row[mapping.opponent || ''] || '';

    if (matchupStr && matchupStr.includes(' vs ')) {
      const parts = matchupStr.split(' vs ').map(s => s.trim());
      team1 = parts[0];
      team2 = parts[1];
    } else if (pick && opponent) {
      // Championship or rows without matchup text
      team1 = pick;
      team2 = opponent;
    }

    // For seeds: pick_seed goes with pick, opponent_seed goes with opponent
    const pickSeed = row[mapping.pick_seed || ''] || '';
    const oppSeed = row[mapping.opponent_seed || ''] || '';
    // Assign seeds to team1 and team2 based on which is the pick
    if (normalizeTeamName(team1) === normalizeTeamName(pick)) {
      seed1 = pickSeed;
      seed2 = oppSeed;
    } else {
      seed1 = oppSeed;
      seed2 = pickSeed;
    }
  } else {
    // Format: Team1, Team2, Pick columns
    team1 = row[mapping.team1 || ''] || '';
    team2 = row[mapping.team2 || ''] || '';
    seed1 = row[mapping.seed1 || ''] || '';
    seed2 = row[mapping.seed2 || ''] || '';
  }

  if (!team1 || !team2) return null;

  return { round, team1, team2, pick, seed1, seed2, region };
}

export function loadBracketCSV(
  name: string,
  text: string,
  existingBrackets: Record<string, BracketData>
): Record<string, BracketData> {
  const { headers, rows } = parseCSV(text);
  if (rows.length === 0) return existingBrackets;

  const mapping = detectBracketFormat(headers);
  const newBrackets = { ...existingBrackets };

  // Always use the provided name (from the upload form)
  newBrackets[name] = { games: [] };
  for (const row of rows) {
    const game = parseRow(row, mapping);
    if (game) newBrackets[name].games.push(game);
  }

  return newBrackets;
}

export function loadResultsFromText(
  text: string,
  existingResults: Record<string, GameResult>
): Record<string, GameResult> {
  const newResults = { ...existingResults };
  const lines = text.split('\n').map(l => l.trim()).filter(l => l);

  for (const line of lines) {
    const parts = line.split(',').map(p => p.trim().replace(/"/g, ''));
    if (parts.length >= 4 && !/^round$/i.test(parts[0])) {
      const [round, team1, team2, winner] = parts;
      const key = getGameKey(team1, team2);
      newResults[key] = { winner, round };
    } else if (parts.length === 3 && !/^round$/i.test(parts[0])) {
      const [team1, team2, winner] = parts;
      const key = getGameKey(team1, team2);
      newResults[key] = { winner, round: '' };
    }
  }

  return newResults;
}

const ROUND_ORDER = [
  'round of 64', 'first round', 'r64', 'round 1', '1',
  'round of 32', 'second round', 'r32', 'round 2', '2',
  'sweet 16', 'sweet sixteen', 's16', 'round 3', '3',
  'elite 8', 'elite eight', 'e8', 'round 4', '4',
  'final 4', 'final four', 'f4', 'round 5', '5', 'semi',
  'championship', 'final', 'finals', 'round 6', '6', 'title',
];

export function roundSortKey(r: string): number {
  const idx = ROUND_ORDER.indexOf(r.toLowerCase());
  return idx >= 0 ? idx : 999;
}

export function buildGameIndex(brackets: Record<string, BracketData>): {
  games: Game[];
  rounds: string[];
} {
  const gameMap: Record<string, Game> = {};

  for (const [person, data] of Object.entries(brackets)) {
    for (const g of data.games) {
      const teamKey = getGameKey(g.team1, g.team2);
      // Use round + team pair as dedup key so same teams in different rounds don't collide
      // (e.g., Arizona vs Michigan in both Final Four and Championship)
      const dedupKey = g.round + '|' + teamKey;
      if (!gameMap[dedupKey]) {
        gameMap[dedupKey] = {
          key: teamKey,
          team1: g.team1,
          team2: g.team2,
          round: g.round,
          seed1: g.seed1,
          seed2: g.seed2,
          region: g.region,
          picks: {},
        };
      }
      gameMap[dedupKey].picks[person] = g.pick;
    }
  }

  const games = Object.values(gameMap).sort(
    (a, b) => roundSortKey(a.round) - roundSortKey(b.round)
  );

  const roundSet = new Set(games.map(g => g.round));
  const rounds = [...roundSet].sort((a, b) => roundSortKey(a) - roundSortKey(b));

  return { games, rounds };
}

export function getScores(
  brackets: Record<string, BracketData>,
  games: Game[],
  rounds: string[],
  results: Record<string, GameResult>
): Record<string, PersonScore> {
  const scores: Record<string, PersonScore> = {};

  const pointsByRound: Record<string, number> = {};
  for (const r of rounds) {
    const key = roundSortKey(r);
    if (key <= 4) pointsByRound[r] = 1;
    else if (key <= 9) pointsByRound[r] = 2;
    else if (key <= 14) pointsByRound[r] = 4;
    else if (key <= 19) pointsByRound[r] = 8;
    else if (key <= 24) pointsByRound[r] = 16;
    else pointsByRound[r] = 32;
  }

  // Build set of eliminated teams (losers of decided games)
  const eliminatedTeams = new Set<string>();
  for (const game of games) {
    const result = results[game.key];
    if (result?.winner) {
      const winnerNorm = normalizeTeamName(result.winner);
      const t1Norm = normalizeTeamName(game.team1);
      const t2Norm = normalizeTeamName(game.team2);
      const loser = winnerNorm === t1Norm ? t2Norm : t1Norm;
      eliminatedTeams.add(loser);
    }
  }

  // Score each bracket from its OWN game list to avoid cross-round key collisions
  // (e.g., a bracket's Championship "A vs B" colliding with its FF "A vs B")
  for (const [person, data] of Object.entries(brackets)) {
    const score: PersonScore = { correct: 0, incorrect: 0, pending: 0, total: 0, points: 0, maxPoints: 0 };

    for (const g of data.games) {
      const key = getGameKey(g.team1, g.team2);
      const result = results[key];
      const pts = pointsByRound[g.round] || 1;

      score.total++;
      if (result?.winner) {
        if (normalizeTeamName(g.pick) === normalizeTeamName(result.winner)) {
          score.correct++;
          score.points += pts;
          score.maxPoints += pts;
        } else {
          score.incorrect++;
        }
      } else {
        score.pending++;
        if (!eliminatedTeams.has(normalizeTeamName(g.pick))) {
          score.maxPoints += pts;
        }
      }
    }

    scores[person] = score;
  }

  return scores;
}
