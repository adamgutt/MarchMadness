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

  // Helper: count how many active brackets have a specific team advancing in a round+region+position
  // We do this by tracing each bracket's picks through the bracket tree
  function getPickCounts(
    round: string,
    region: string,
    _position: number,
    team1: string | null,
    team2: string | null,
  ): { topCount: number; bottomCount: number; topPickers: string[]; bottomPickers: string[] } {
    const topPickers: string[] = [];
    const bottomPickers: string[] = [];

    if (!team1 && !team2) return { topCount: 0, bottomCount: 0, topPickers, bottomPickers };

    for (const [name, data] of Object.entries(activeBrackets)) {
      // Find this bracket's pick for this specific game
      for (const g of data.games) {
        if (g.round !== round || g.region !== region) continue;
        // Match by teams — the game must contain both teams (in any order)
        const gameTeams = [norm(g.team1), norm(g.team2)].sort();
        const slotTeams = [norm(team1 || ''), norm(team2 || '')].sort();
        if (gameTeams[0] === slotTeams[0] && gameTeams[1] === slotTeams[1]) {
          if (team1 && norm(g.pick) === norm(team1)) {
            topPickers.push(name);
          } else if (team2 && norm(g.pick) === norm(team2)) {
            bottomPickers.push(name);
          }
          break;
        }
      }
    }

    return { topCount: topPickers.length, bottomCount: bottomPickers.length, topPickers, bottomPickers };
  }

  // Same thing but for Final Four / Championship which may have different region labels
  function getPickCountsFF(
    round: string,
    _regionPattern: string,
    team1: string | null,
    team2: string | null,
  ): { topCount: number; bottomCount: number; topPickers: string[]; bottomPickers: string[] } {
    const topPickers: string[] = [];
    const bottomPickers: string[] = [];

    if (!team1 && !team2) return { topCount: 0, bottomCount: 0, topPickers, bottomPickers };

    for (const [name, data] of Object.entries(activeBrackets)) {
      for (const g of data.games) {
        if (g.round !== round) continue;
        // For FF/Championship, match by teams
        const gameTeams = [norm(g.team1), norm(g.team2)].sort();
        const slotTeams = [norm(team1 || ''), norm(team2 || '')].sort();
        if (gameTeams[0] === slotTeams[0] && gameTeams[1] === slotTeams[1]) {
          if (team1 && norm(g.pick) === norm(team1)) {
            topPickers.push(name);
          } else if (team2 && norm(g.pick) === norm(team2)) {
            bottomPickers.push(name);
          }
          break;
        }
      }
    }

    return { topCount: topPickers.length, bottomCount: bottomPickers.length, topPickers, bottomPickers };
  }

  // Build each region
  const regions: RegionBracket[] = REGIONS.map(region => {
    const r64Games = regionR64[region] || [];

    // R64 slots
    const r64: BracketSlot[] = r64Games.map((g, i) => {
      const winner = getWinner(g.team1, g.team2);
      const counts = getPickCounts('Round of 64', region, i, g.team1, g.team2);
      return {
        slotId: `${region}_r64_${i}`,
        round: 'Round of 64',
        region,
        position: i,
        topTeam: g.team1,
        topSeed: g.seed1,
        bottomTeam: g.team2,
        bottomSeed: g.seed2,
        winner,
        ...counts,
        totalBrackets,
      };
    });

    // R32: winners of R64 pairs (0+1, 2+3, 4+5, 6+7)
    const r32: BracketSlot[] = [];
    for (let i = 0; i < 4; i++) {
      const top = r64[i * 2]?.winner || null;
      const bottom = r64[i * 2 + 1]?.winner || null;
      const topSeed = top === r64[i * 2]?.topTeam ? r64[i * 2]?.topSeed || '' : r64[i * 2]?.bottomSeed || '';
      const bottomSeed = bottom === r64[i * 2 + 1]?.topTeam ? r64[i * 2 + 1]?.topSeed || '' : r64[i * 2 + 1]?.bottomSeed || '';
      const winner = top && bottom ? getWinner(top, bottom) : null;
      const counts = getPickCounts('Round of 32', region, i, top, bottom);
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
        ...counts,
        totalBrackets,
      });
    }

    // S16: winners of R32 pairs (0+1, 2+3)
    const s16: BracketSlot[] = [];
    for (let i = 0; i < 2; i++) {
      const top = r32[i * 2]?.winner || null;
      const bottom = r32[i * 2 + 1]?.winner || null;
      const topSeed = getSeedForTeam(top, r32[i * 2]);
      const bottomSeed = getSeedForTeam(bottom, r32[i * 2 + 1]);
      const winner = top && bottom ? getWinner(top, bottom) : null;
      const counts = getPickCounts('Sweet 16', region, i, top, bottom);
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
        ...counts,
        totalBrackets,
      });
    }

    // E8: winner of S16 pair
    const e8Top = s16[0]?.winner || null;
    const e8Bottom = s16[1]?.winner || null;
    const e8TopSeed = getSeedForTeam(e8Top, s16[0]);
    const e8BottomSeed = getSeedForTeam(e8Bottom, s16[1]);
    const e8Winner = e8Top && e8Bottom ? getWinner(e8Top, e8Bottom) : null;
    const e8Counts = getPickCounts('Elite 8', region, 0, e8Top, e8Bottom);
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
      ...e8Counts,
      totalBrackets,
    }];

    return { region, r64, r32, s16, e8 };
  });

  // Final Four: East winner vs South winner, West winner vs Midwest winner
  const eastWinner = regions[0].e8[0].winner;
  const southWinner = regions[1].e8[0].winner;
  const westWinner = regions[2].e8[0].winner;
  const midwestWinner = regions[3].e8[0].winner;

  const ff1Top = eastWinner;
  const ff1Bottom = southWinner;
  const ff1Winner = ff1Top && ff1Bottom ? getWinner(ff1Top, ff1Bottom) : null;
  const ff1Counts = getPickCountsFF('Final Four', 'East/South', ff1Top, ff1Bottom);

  const ff2Top = westWinner;
  const ff2Bottom = midwestWinner;
  const ff2Winner = ff2Top && ff2Bottom ? getWinner(ff2Top, ff2Bottom) : null;
  const ff2Counts = getPickCountsFF('Final Four', 'West/Midwest', ff2Top, ff2Bottom);

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
      ...ff1Counts,
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
      ...ff2Counts,
      totalBrackets,
    },
  ];

  // Championship
  const champTop = ff[0].winner;
  const champBottom = ff[1].winner;
  const champWinner = champTop && champBottom ? getWinner(champTop, champBottom) : null;
  const champCounts = getPickCountsFF('Championship', '', champTop, champBottom);

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
    ...champCounts,
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
        topPickers: [], bottomPickers: [] },
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
      return {
        slotId: `${region}_r64_${i}`, round: 'Round of 64', region, position: i,
        topTeam: g.team1, topSeed: g.seed1, bottomTeam: g.team2, bottomSeed: g.seed2,
        winner, topCount: 0, bottomCount: 0, totalBrackets: 0, topPickers: [], bottomPickers: [],
        personPick: pick,
        pickStatus: getPickStatus(g.team1, g.team2, pick),
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
        topCount: 0, bottomCount: 0, totalBrackets: 0, topPickers: [], bottomPickers: [],
        personPick: pick,
        pickStatus: getPickStatus(topPick, bottomPick, pick),
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
        topCount: 0, bottomCount: 0, totalBrackets: 0, topPickers: [], bottomPickers: [],
        personPick: pick,
        pickStatus: getPickStatus(top, bottom, pick),
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
      winner: e8Winner, topCount: 0, bottomCount: 0, totalBrackets: 0, topPickers: [], bottomPickers: [],
      personPick: e8Pick,
      pickStatus: getPickStatus(e8Top, e8Bottom, e8Pick),
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
      winner: ff1Winner, topCount: 0, bottomCount: 0, totalBrackets: 0, topPickers: [], bottomPickers: [],
      personPick: ff1Pick, pickStatus: getPickStatus(ff1Top, ff1Bottom, ff1Pick),
    },
    {
      slotId: 'ff_1', round: 'Final Four', region: 'West/Midwest', position: 1,
      topTeam: ff2Top, topSeed: getSeedForTeamFromRegion(ff2Top, regions[2], regions[3]),
      bottomTeam: ff2Bottom, bottomSeed: getSeedForTeamFromRegion(ff2Bottom, regions[2], regions[3]),
      winner: ff2Winner, topCount: 0, bottomCount: 0, totalBrackets: 0, topPickers: [], bottomPickers: [],
      personPick: ff2Pick, pickStatus: getPickStatus(ff2Top, ff2Bottom, ff2Pick),
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
    winner: champWinner, topCount: 0, bottomCount: 0, totalBrackets: 0, topPickers: [], bottomPickers: [],
    personPick: champPick, pickStatus: getPickStatus(champTop, champBottom, champPick),
  };

  return { regions, ff, championship };
}
