import { BracketData, BracketSlot, GameResult } from '../types';
import { getGameKey, normalizeTeamName } from './csv';

const norm = normalizeTeamName;

// Fixed NCAA tournament bracket structure per region
// Position in R64 determines matchup flow: games 0+1 feed R32 game 0, games 2+3 feed R32 game 1, etc.
const SEED_MATCHUPS = [
  [1, 16], [8, 9], [5, 12], [4, 13], [6, 11], [3, 14], [7, 10], [2, 15],
];

export const REGIONS = ['East', 'South', 'West', 'Midwest'] as const;

export interface RegionBracket {
  region: string;
  r64: BracketSlot[];  // 8 games
  r32: BracketSlot[];  // 4 games
  s16: BracketSlot[];  // 2 games
  e8: BracketSlot[];   // 1 game
}

export interface FullBracket {
  regions: RegionBracket[];
  ff: BracketSlot[];   // 2 games (East/South winner vs West/Midwest winner — depends on bracket)
  championship: BracketSlot; // 1 game
}

/**
 * Build the visual bracket from uploaded brackets and results.
 * 
 * The R64 matchups are fixed by seed. From R32 onward, the "teams" in each slot
 * are determined by the actual results (if a winner is known) or just shown as TBD.
 * 
 * For each slot, we count how many active brackets have each team advancing to that position.
 */
export function buildFullBracket(
  activeBrackets: Record<string, BracketData>,
  results: Record<string, GameResult>,
  allBrackets: Record<string, BracketData>, // to get the R64 matchup info from any bracket
): FullBracket {
  const bracketNames = Object.keys(activeBrackets);
  const totalBrackets = bracketNames.length;

  // First, figure out the R64 matchups from any bracket (they're the same for all)
  // Build a lookup: region -> list of R64 matchups in seed order
  const regionR64: Record<string, { team1: string; seed1: string; team2: string; seed2: string }[]> = {};
  
  // Use any bracket to get the fixed matchups
  const anyBracket = Object.values(allBrackets)[0];
  if (anyBracket) {
    for (const g of anyBracket.games) {
      if (g.round !== 'Round of 64') continue;
      const region = g.region;
      if (!regionR64[region]) regionR64[region] = [];
      regionR64[region].push({ team1: g.team1, team2: g.team2, seed1: g.seed1, seed2: g.seed2 });
    }
  }

  // Sort each region's R64 by seed order (1v16, 8v9, 5v12, 4v13, 6v11, 3v14, 7v10, 2v15)
  const seedOrder = SEED_MATCHUPS.map(([a]) => a);
  for (const region of Object.keys(regionR64)) {
    regionR64[region].sort((a, b) => {
      const aMin = Math.min(Number(a.seed1) || 99, Number(a.seed2) || 99);
      const bMin = Math.min(Number(b.seed1) || 99, Number(b.seed2) || 99);
      return seedOrder.indexOf(aMin) - seedOrder.indexOf(bMin);
    });
  }

  // Helper: get actual winner of a matchup
  function getWinner(team1: string, team2: string): string | null {
    if (!team1 || !team2) return null;
    const key = getGameKey(team1, team2);
    return results[key]?.winner || null;
  }

  // Helper: find a bracket's pick for a game matching two teams in a round/region
  function findBracketPick(data: BracketData, round: string, region: string, t1: string, t2: string): string | null {
    for (const g of data.games) {
      if (g.round !== round) continue;
      if (region && g.region !== region) continue;
      const gt = [norm(g.team1), norm(g.team2)].sort();
      const st = [norm(t1), norm(t2)].sort();
      if (gt[0] === st[0] && gt[1] === st[1]) return g.pick;
    }
    return null;
  }

  // Precompute each bracket's projected advancement through the entire tree.
  // For each tree position, store who they picked to advance (win that game).
  const traces: Record<string, {
    regions: Record<string, {
      r64: (string | null)[];
      r32: (string | null)[];
      s16: (string | null)[];
      e8: string | null;
    }>;
    ff: (string | null)[];
    champ: string | null;
  }> = {};

  for (const [name, data] of Object.entries(activeBrackets)) {
    const trace: typeof traces[string] = { regions: {}, ff: [null, null], champ: null };

    for (const region of REGIONS) {
      const r64Games = regionR64[region] || [];

      const r64: (string | null)[] = r64Games.map(g =>
        findBracketPick(data, 'Round of 64', region, g.team1, g.team2)
      );

      const r32: (string | null)[] = [];
      for (let i = 0; i < 4; i++) {
        const t1 = r64[2 * i], t2 = r64[2 * i + 1];
        r32.push(t1 && t2 ? findBracketPick(data, 'Round of 32', region, t1, t2) : null);
      }

      const s16: (string | null)[] = [];
      for (let i = 0; i < 2; i++) {
        const t1 = r32[2 * i], t2 = r32[2 * i + 1];
        s16.push(t1 && t2 ? findBracketPick(data, 'Sweet 16', region, t1, t2) : null);
      }

      const e8 = s16[0] && s16[1] ? findBracketPick(data, 'Elite 8', region, s16[0], s16[1]) : null;

      trace.regions[region] = { r64, r32, s16, e8 };
    }

    const eastE8 = trace.regions['East']?.e8;
    const southE8 = trace.regions['South']?.e8;
    const westE8 = trace.regions['West']?.e8;
    const midwestE8 = trace.regions['Midwest']?.e8;

    trace.ff[0] = eastE8 && southE8 ? findBracketPick(data, 'Final Four', '', eastE8, southE8) : null;
    trace.ff[1] = westE8 && midwestE8 ? findBracketPick(data, 'Final Four', '', westE8, midwestE8) : null;
    trace.champ = trace.ff[0] && trace.ff[1] ? findBracketPick(data, 'Championship', '', trace.ff[0], trace.ff[1]) : null;

    traces[name] = trace;
  }

  // Count how many brackets project a specific team to a tree position.
  function countProjected(
    team: string | null,
    accessor: (t: typeof traces[string]) => string | null,
  ): { count: number; pickers: string[] } {
    if (!team) return { count: 0, pickers: [] };
    const teamNorm = norm(team);
    const pickers: string[] = [];
    for (const [name, trace] of Object.entries(traces)) {
      const projected = accessor(trace);
      if (projected && norm(projected) === teamNorm) pickers.push(name);
    }
    return { count: pickers.length, pickers };
  }

  // Find brackets whose projected winner for a position isn't either actual team.
  function getEliminated(
    topTeam: string | null,
    bottomTeam: string | null,
    accessor: (t: typeof traces[string]) => string | null,
  ): { name: string; team: string }[] {
    if (!topTeam && !bottomTeam) return [];
    const topNorm = topTeam ? norm(topTeam) : null;
    const bottomNorm = bottomTeam ? norm(bottomTeam) : null;
    const result: { name: string; team: string }[] = [];
    for (const [name, trace] of Object.entries(traces)) {
      const projected = accessor(trace);
      if (!projected) continue;
      const projNorm = norm(projected);
      if (projNorm !== topNorm && projNorm !== bottomNorm) {
        result.push({ name, team: projected });
      }
    }
    return result;
  }

  // Build each region
  const regions: RegionBracket[] = REGIONS.map(region => {
    const r64Games = regionR64[region] || [];

    // R64 slots — count who picked each team (same matchups for all brackets)
    const r64: BracketSlot[] = r64Games.map((g, i) => {
      const winner = getWinner(g.team1, g.team2);
      const accessor = (t: typeof traces[string]) => t.regions[region]?.r64[i] ?? null;
      const topResult = countProjected(g.team1, accessor);
      const bottomResult = countProjected(g.team2, accessor);
      const [seedA, seedB] = SEED_MATCHUPS[i] || [0, 0];
      return {
        slotId: `${region}_r64_${i}`,
        round: 'Round of 64',
        region,
        position: i,
        topTeam: g.team1,
        topSeed: g.seed1 || seedA.toString(),
        bottomTeam: g.team2,
        bottomSeed: g.seed2 || seedB.toString(),
        winner,
        topCount: topResult.count,
        bottomCount: bottomResult.count,
        topPickers: topResult.pickers,
        bottomPickers: bottomResult.pickers,
        eliminatedPickers: [],
        totalBrackets,
      };
    });

    // R32: count = how many brackets project each team to this tree position
    const r32: BracketSlot[] = [];
    for (let i = 0; i < 4; i++) {
      const top = r64[i * 2]?.winner || null;
      const bottom = r64[i * 2 + 1]?.winner || null;
      const topSeed = top === r64[i * 2]?.topTeam ? r64[i * 2]?.topSeed || '' : r64[i * 2]?.bottomSeed || '';
      const bottomSeed = bottom === r64[i * 2 + 1]?.topTeam ? r64[i * 2 + 1]?.topSeed || '' : r64[i * 2 + 1]?.bottomSeed || '';
      const winner = top && bottom ? getWinner(top, bottom) : null;
      const r32Accessor = (t: typeof traces[string]) => t.regions[region]?.r32[i] ?? null;
      const topResult = countProjected(top, r32Accessor);
      const bottomResult = countProjected(bottom, r32Accessor);
      r32.push({
        slotId: `${region}_r32_${i}`,
        round: 'Round of 32',
        region,
        position: i,
        topTeam: top,
        topSeed,
        bottomTeam: bottom,
        bottomSeed,
        winner,
        topCount: topResult.count,
        bottomCount: bottomResult.count,
        topPickers: topResult.pickers,
        bottomPickers: bottomResult.pickers,
        eliminatedPickers: getEliminated(top, bottom, r32Accessor),
        totalBrackets,
      });
    }

    // S16
    const s16: BracketSlot[] = [];
    for (let i = 0; i < 2; i++) {
      const top = r32[i * 2]?.winner || null;
      const bottom = r32[i * 2 + 1]?.winner || null;
      const topSeed = getSeedForTeam(top, r32[i * 2]);
      const bottomSeed = getSeedForTeam(bottom, r32[i * 2 + 1]);
      const winner = top && bottom ? getWinner(top, bottom) : null;
      const s16Accessor = (t: typeof traces[string]) => t.regions[region]?.s16[i] ?? null;
      const topResult = countProjected(top, s16Accessor);
      const bottomResult = countProjected(bottom, s16Accessor);
      s16.push({
        slotId: `${region}_s16_${i}`,
        round: 'Sweet 16',
        region,
        position: i,
        topTeam: top,
        topSeed,
        bottomTeam: bottom,
        bottomSeed,
        winner,
        topCount: topResult.count,
        bottomCount: bottomResult.count,
        topPickers: topResult.pickers,
        bottomPickers: bottomResult.pickers,
        eliminatedPickers: getEliminated(top, bottom, s16Accessor),
        totalBrackets,
      });
    }

    // E8
    const e8Top = s16[0]?.winner || null;
    const e8Bottom = s16[1]?.winner || null;
    const e8TopSeed = getSeedForTeam(e8Top, s16[0]);
    const e8BottomSeed = getSeedForTeam(e8Bottom, s16[1]);
    const e8Winner = e8Top && e8Bottom ? getWinner(e8Top, e8Bottom) : null;
    const e8Accessor = (t: typeof traces[string]) => t.regions[region]?.e8 ?? null;
    const e8TopResult = countProjected(e8Top, e8Accessor);
    const e8BottomResult = countProjected(e8Bottom, e8Accessor);
    const e8: BracketSlot[] = [{
      slotId: `${region}_e8_0`,
      round: 'Elite 8',
      region,
      position: 0,
      topTeam: e8Top,
      topSeed: e8TopSeed,
      bottomTeam: e8Bottom,
      bottomSeed: e8BottomSeed,
      winner: e8Winner,
      topCount: e8TopResult.count,
      bottomCount: e8BottomResult.count,
      topPickers: e8TopResult.pickers,
      bottomPickers: e8BottomResult.pickers,
      eliminatedPickers: getEliminated(e8Top, e8Bottom, e8Accessor),
      totalBrackets,
    }];

    return { region, r64, r32, s16, e8 };
  });

  // Final Four
  const eastWinner = regions[0].e8[0].winner;
  const southWinner = regions[1].e8[0].winner;
  const westWinner = regions[2].e8[0].winner;
  const midwestWinner = regions[3].e8[0].winner;

  const ff1Top = eastWinner;
  const ff1Bottom = southWinner;
  const ff1Winner = ff1Top && ff1Bottom ? getWinner(ff1Top, ff1Bottom) : null;
  const ff1Accessor = (t: typeof traces[string]) => t.ff[0];
  const ff1TopResult = countProjected(ff1Top, ff1Accessor);
  const ff1BottomResult = countProjected(ff1Bottom, ff1Accessor);

  const ff2Top = westWinner;
  const ff2Bottom = midwestWinner;
  const ff2Winner = ff2Top && ff2Bottom ? getWinner(ff2Top, ff2Bottom) : null;
  const ff2Accessor = (t: typeof traces[string]) => t.ff[1];
  const ff2TopResult = countProjected(ff2Top, ff2Accessor);
  const ff2BottomResult = countProjected(ff2Bottom, ff2Accessor);

  const ff: BracketSlot[] = [
    {
      slotId: 'ff_0',
      round: 'Final Four',
      region: 'East/South',
      position: 0,
      topTeam: ff1Top,
      topSeed: getSeedForTeamFromRegion(ff1Top, regions[0], regions[1]),
      bottomTeam: ff1Bottom,
      bottomSeed: getSeedForTeamFromRegion(ff1Bottom, regions[0], regions[1]),
      winner: ff1Winner,
      topCount: ff1TopResult.count,
      bottomCount: ff1BottomResult.count,
      topPickers: ff1TopResult.pickers,
      bottomPickers: ff1BottomResult.pickers,
      eliminatedPickers: getEliminated(ff1Top, ff1Bottom, ff1Accessor),
      totalBrackets,
    },
    {
      slotId: 'ff_1',
      round: 'Final Four',
      region: 'West/Midwest',
      position: 1,
      topTeam: ff2Top,
      topSeed: getSeedForTeamFromRegion(ff2Top, regions[2], regions[3]),
      bottomTeam: ff2Bottom,
      bottomSeed: getSeedForTeamFromRegion(ff2Bottom, regions[2], regions[3]),
      winner: ff2Winner,
      topCount: ff2TopResult.count,
      bottomCount: ff2BottomResult.count,
      topPickers: ff2TopResult.pickers,
      bottomPickers: ff2BottomResult.pickers,
      eliminatedPickers: getEliminated(ff2Top, ff2Bottom, ff2Accessor),
      totalBrackets,
    },
  ];

  // Championship
  const champTop = ff[0].winner;
  const champBottom = ff[1].winner;
  const champWinner = champTop && champBottom ? getWinner(champTop, champBottom) : null;
  const champAccessor = (t: typeof traces[string]) => t.champ;
  const champTopResult = countProjected(champTop, champAccessor);
  const champBottomResult = countProjected(champBottom, champAccessor);

  const championship: BracketSlot = {
    slotId: 'champ',
    round: 'Championship',
    region: '',
    position: 0,
    topTeam: champTop,
    topSeed: ff[0].winner ? getSeedForTeamFromRegion(champTop, ...regions) : '',
    bottomTeam: champBottom,
    bottomSeed: ff[1].winner ? getSeedForTeamFromRegion(champBottom, ...regions) : '',
    winner: champWinner,
    topCount: champTopResult.count,
    bottomCount: champBottomResult.count,
    topPickers: champTopResult.pickers,
    bottomPickers: champBottomResult.pickers,
    eliminatedPickers: getEliminated(champTop, champBottom, champAccessor),
    totalBrackets,
  };

  return { regions, ff, championship };
}

function getSeedForTeam(team: string | null, slot: BracketSlot | undefined): string {
  if (!team || !slot) return '';
  if (team === slot.topTeam) return slot.topSeed;
  if (team === slot.bottomTeam) return slot.bottomSeed;
  return '';
}

function getSeedForTeamFromRegion(team: string | null, ...regions: RegionBracket[]): string {
  if (!team) return '';
  for (const reg of regions) {
    for (const slot of reg.r64) {
      if (slot.topTeam === team) return slot.topSeed;
      if (slot.bottomTeam === team) return slot.bottomSeed;
    }
  }
  return '';
}

/**
 * For each bracket entry, count who they have winning the championship.
 * Returns map: teamName -> count
 */
export function getChampionPicks(activeBrackets: Record<string, BracketData>): Record<string, string[]> {
  const picks: Record<string, string[]> = {};
  for (const [name, data] of Object.entries(activeBrackets)) {
    const champGame = data.games.find(g => g.round === 'Championship');
    if (champGame) {
      const team = champGame.pick;
      if (!picks[team]) picks[team] = [];
      picks[team].push(name);
    }
  }
  return picks;
}

/**
 * Build a bracket view for a single person, showing their picks through every round.
 * Instead of using actual results to determine advancement, uses the person's picks.
 * Each slot gets personPick (their chosen team) and pickStatus (correct/incorrect/pending).
 */
export function buildPersonBracket(
  bracketName: string,
  allBrackets: Record<string, BracketData>,
  results: Record<string, GameResult>,
): FullBracket {
  const personData = allBrackets[bracketName];
  if (!personData) {
    // Return empty bracket
    const emptyRegion: RegionBracket = { region: '', r64: [], r32: [], s16: [], e8: [] };
    return {
      regions: [emptyRegion, emptyRegion, emptyRegion, emptyRegion],
      ff: [],
      championship: { slotId: 'champ', round: 'Championship', region: '', position: 0,
        topTeam: null, topSeed: '', bottomTeam: null, bottomSeed: '',
        winner: null, topCount: 0, bottomCount: 0, totalBrackets: 0,
        topPickers: [], bottomPickers: [], eliminatedPickers: [] },
    };
  }

  // Build set of eliminated teams from all results
  const eliminatedTeams = new Set<string>();
  for (const key of Object.keys(results)) {
    const result = results[key];
    if (!result?.winner) continue;
    const parts = key.split(' vs ');
    if (parts.length === 2) {
      const loser = norm(parts[0]) === norm(result.winner) ? parts[1] : parts[0];
      eliminatedTeams.add(norm(loser));
    }
  }

  // Build lookup: round+region+teams -> person's pick
  function findPick(round: string, region: string, team1: string | null, team2: string | null): string | null {
    if (!team1 && !team2) return null;
    for (const g of personData.games) {
      if (g.round !== round) continue;
      if (region && g.region !== region) continue;
      const gt = [norm(g.team1), norm(g.team2)].sort();
      const st = [norm(team1 || ''), norm(team2 || '')].sort();
      if (gt[0] === st[0] && gt[1] === st[1]) return g.pick;
    }
    return null;
  }

  function getPickStatus(team1: string | null, team2: string | null, pick: string | null): 'correct' | 'incorrect' | 'pending' | null {
    if (!pick || !team1 || !team2) return null;
    const key = getGameKey(team1, team2);
    const result = results[key];
    if (result?.winner) {
      return norm(result.winner) === norm(pick) ? 'correct' : 'incorrect';
    }
    // Game hasn't been played — but if the picked team is already eliminated, mark incorrect
    if (eliminatedTeams.has(norm(pick))) return 'incorrect';
    return 'pending';
  }

  function getWinner(team1: string, team2: string): string | null {
    if (!team1 || !team2) return null;
    const key = getGameKey(team1, team2);
    return results[key]?.winner || null;
  }

  // Get R64 matchups from this bracket
  const regionR64: Record<string, { team1: string; seed1: string; team2: string; seed2: string }[]> = {};
  for (const g of personData.games) {
    if (g.round !== 'Round of 64') continue;
    if (!regionR64[g.region]) regionR64[g.region] = [];
    regionR64[g.region].push({ team1: g.team1, team2: g.team2, seed1: g.seed1, seed2: g.seed2 });
  }
  const seedOrder = SEED_MATCHUPS.map(([a]) => a);
  for (const region of Object.keys(regionR64)) {
    regionR64[region].sort((a, b) => {
      const aMin = Math.min(Number(a.seed1) || 99, Number(a.seed2) || 99);
      const bMin = Math.min(Number(b.seed1) || 99, Number(b.seed2) || 99);
      return seedOrder.indexOf(aMin) - seedOrder.indexOf(bMin);
    });
  }

  const regions: RegionBracket[] = REGIONS.map(region => {
    const r64Games = regionR64[region] || [];

    // R64
    const r64: BracketSlot[] = r64Games.map((g, i) => {
      const winner = getWinner(g.team1, g.team2);
      const pick = findPick('Round of 64', region, g.team1, g.team2);
      const [seedA, seedB] = SEED_MATCHUPS[i] || [0, 0];
      return {
        slotId: `${region}_r64_${i}`, round: 'Round of 64', region, position: i,
        topTeam: g.team1, topSeed: g.seed1 || seedA.toString(), bottomTeam: g.team2, bottomSeed: g.seed2 || seedB.toString(),
        winner, topCount: 0, bottomCount: 0, totalBrackets: 0, topPickers: [], bottomPickers: [], eliminatedPickers: [],
        personPick: pick,
        pickStatus: getPickStatus(g.team1, g.team2, pick),
        topEliminated: false,
        bottomEliminated: false,
      };
    });

    // R32: use person's picks to determine who they have advancing
    const r32: BracketSlot[] = [];
    for (let i = 0; i < 4; i++) {
      // Person's pick from R64 determines who they have here
      const topPick = r64[i * 2]?.personPick || null;
      const bottomPick = r64[i * 2 + 1]?.personPick || null;
      const topSeed = topPick === r64[i * 2]?.topTeam ? r64[i * 2]?.topSeed || '' : r64[i * 2]?.bottomSeed || '';
      const bottomSeed = bottomPick === r64[i * 2 + 1]?.topTeam ? r64[i * 2 + 1]?.topSeed || '' : r64[i * 2 + 1]?.bottomSeed || '';
      const winner = topPick && bottomPick ? getWinner(topPick, bottomPick) : null;
      const pick = findPick('Round of 32', region, topPick, bottomPick);
      r32.push({
        slotId: `${region}_r32_${i}`, round: 'Round of 32', region, position: i,
        topTeam: topPick, topSeed, bottomTeam: bottomPick, bottomSeed, winner,
        topCount: 0, bottomCount: 0, totalBrackets: 0, topPickers: [], bottomPickers: [], eliminatedPickers: [],
        personPick: pick,
        pickStatus: getPickStatus(topPick, bottomPick, pick),
        topEliminated: !!topPick && eliminatedTeams.has(norm(topPick)),
        bottomEliminated: !!bottomPick && eliminatedTeams.has(norm(bottomPick)),
      });
    }

    // S16
    const s16: BracketSlot[] = [];
    for (let i = 0; i < 2; i++) {
      const top = r32[i * 2]?.personPick || null;
      const bottom = r32[i * 2 + 1]?.personPick || null;
      const topSeed = getSeedForTeam(top, r32[i * 2]);
      const bottomSeed = getSeedForTeam(bottom, r32[i * 2 + 1]);
      const winner = top && bottom ? getWinner(top, bottom) : null;
      const pick = findPick('Sweet 16', region, top, bottom);
      s16.push({
        slotId: `${region}_s16_${i}`, round: 'Sweet 16', region, position: i,
        topTeam: top, topSeed, bottomTeam: bottom, bottomSeed, winner,
        topCount: 0, bottomCount: 0, totalBrackets: 0, topPickers: [], bottomPickers: [], eliminatedPickers: [],
        personPick: pick,
        pickStatus: getPickStatus(top, bottom, pick),
        topEliminated: !!top && eliminatedTeams.has(norm(top)),
        bottomEliminated: !!bottom && eliminatedTeams.has(norm(bottom)),
      });
    }

    // E8
    const e8Top = s16[0]?.personPick || null;
    const e8Bottom = s16[1]?.personPick || null;
    const e8TopSeed = getSeedForTeam(e8Top, s16[0]);
    const e8BottomSeed = getSeedForTeam(e8Bottom, s16[1]);
    const e8Winner = e8Top && e8Bottom ? getWinner(e8Top, e8Bottom) : null;
    const e8Pick = findPick('Elite 8', region, e8Top, e8Bottom);
    const e8: BracketSlot[] = [{
      slotId: `${region}_e8_0`, round: 'Elite 8', region, position: 0,
      topTeam: e8Top, topSeed: e8TopSeed, bottomTeam: e8Bottom, bottomSeed: e8BottomSeed,
      winner: e8Winner, topCount: 0, bottomCount: 0, totalBrackets: 0, topPickers: [], bottomPickers: [], eliminatedPickers: [],
      personPick: e8Pick,
      pickStatus: getPickStatus(e8Top, e8Bottom, e8Pick),
      topEliminated: !!e8Top && eliminatedTeams.has(norm(e8Top)),
      bottomEliminated: !!e8Bottom && eliminatedTeams.has(norm(e8Bottom)),
    }];

    return { region, r64, r32, s16, e8 };
  });

  // Final Four
  const ff1Top = regions[0].e8[0]?.personPick || null;
  const ff1Bottom = regions[1].e8[0]?.personPick || null;
  const ff1Winner = ff1Top && ff1Bottom ? getWinner(ff1Top, ff1Bottom) : null;
  const ff1Pick = findPick('Final Four', '', ff1Top, ff1Bottom);

  const ff2Top = regions[2].e8[0]?.personPick || null;
  const ff2Bottom = regions[3].e8[0]?.personPick || null;
  const ff2Winner = ff2Top && ff2Bottom ? getWinner(ff2Top, ff2Bottom) : null;
  const ff2Pick = findPick('Final Four', '', ff2Top, ff2Bottom);

  const ff: BracketSlot[] = [
    {
      slotId: 'ff_0', round: 'Final Four', region: 'East/South', position: 0,
      topTeam: ff1Top, topSeed: getSeedForTeamFromRegion(ff1Top, regions[0], regions[1]),
      bottomTeam: ff1Bottom, bottomSeed: getSeedForTeamFromRegion(ff1Bottom, regions[0], regions[1]),
      winner: ff1Winner, topCount: 0, bottomCount: 0, totalBrackets: 0, topPickers: [], bottomPickers: [], eliminatedPickers: [],
      personPick: ff1Pick, pickStatus: getPickStatus(ff1Top, ff1Bottom, ff1Pick),
      topEliminated: !!ff1Top && eliminatedTeams.has(norm(ff1Top)),
      bottomEliminated: !!ff1Bottom && eliminatedTeams.has(norm(ff1Bottom)),
    },
    {
      slotId: 'ff_1', round: 'Final Four', region: 'West/Midwest', position: 1,
      topTeam: ff2Top, topSeed: getSeedForTeamFromRegion(ff2Top, regions[2], regions[3]),
      bottomTeam: ff2Bottom, bottomSeed: getSeedForTeamFromRegion(ff2Bottom, regions[2], regions[3]),
      winner: ff2Winner, topCount: 0, bottomCount: 0, totalBrackets: 0, topPickers: [], bottomPickers: [], eliminatedPickers: [],
      personPick: ff2Pick, pickStatus: getPickStatus(ff2Top, ff2Bottom, ff2Pick),
      topEliminated: !!ff2Top && eliminatedTeams.has(norm(ff2Top)),
      bottomEliminated: !!ff2Bottom && eliminatedTeams.has(norm(ff2Bottom)),
    },
  ];

  // Championship
  const champTop = ff[0].personPick || null;
  const champBottom = ff[1].personPick || null;
  const champWinner = champTop && champBottom ? getWinner(champTop, champBottom) : null;
  const champPick = findPick('Championship', '', champTop, champBottom);

  const championship: BracketSlot = {
    slotId: 'champ', round: 'Championship', region: '', position: 0,
    topTeam: champTop, topSeed: champTop ? getSeedForTeamFromRegion(champTop, ...regions) : '',
    bottomTeam: champBottom, bottomSeed: champBottom ? getSeedForTeamFromRegion(champBottom, ...regions) : '',
    winner: champWinner, topCount: 0, bottomCount: 0, totalBrackets: 0, topPickers: [], bottomPickers: [], eliminatedPickers: [],
    personPick: champPick, pickStatus: getPickStatus(champTop, champBottom, champPick),
    topEliminated: !!champTop && eliminatedTeams.has(norm(champTop)),
    bottomEliminated: !!champBottom && eliminatedTeams.has(norm(champBottom)),
  };

  return { regions, ff, championship };
}
