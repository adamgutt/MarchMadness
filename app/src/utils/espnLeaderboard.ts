const ESPN_BASE = 'https://gambit-api.fantasy.espn.com/apis/v1/challenges/tournament-challenge-bracket-2026';
const ESPN_GROUP_URL = `${ESPN_BASE}/groups/39ec1e2c-2fc6-44ac-933e-dcb95c9ab247`;

import { BracketSlot } from '../types';
import type { FullBracket, RegionBracket } from './bracket';

export interface EspnEntry {
  name: string;
  rank: number;
  points: number;
  maxPoints: number;
  correct: number;
  wrong: number;
  percentile: number;
  eliminated: boolean;
  champion: string;
  picks: EspnPick[];
  finalPick?: { outcomesPicked: EspnOutcome[] };
}

interface EspnOutcome {
  outcomeId: string;
  result: string;
}

interface EspnPick {
  outcomesPicked: EspnOutcome[];
  propositionId: string;
  periodReached: number;
}

interface EspnScoreRecord {
  wins: number;
  losses: number;
}

interface EspnScore {
  overallScore: number;
  possiblePointsMax: number;
  rank: number;
  percentile: number;
  eliminated: boolean;
  record: EspnScoreRecord;
}

interface EspnRawEntry {
  name: string;
  picks: EspnPick[];
  finalPick?: {
    outcomesPicked: EspnOutcome[];
  };
  score?: EspnScore;
}

interface EspnPossibleOutcome {
  id: string;
  name: string;
}

interface EspnProposition {
  id: string;
  displayOrder?: number;
  possibleOutcomes?: EspnPossibleOutcome[];
}

interface EspnChallengeResponse {
  propositions?: EspnProposition[];
}

interface EspnGroupResponse {
  entries: EspnRawEntry[];
}

// ---------- Proposition Cache ----------

interface PropInfo {
  id: string;
  displayOrder: number;
  outcomes: { id: string; name: string }[];
}

let propDataCache: {
  allOutcomeNames: Record<string, string>;
  propsByPeriod: Record<number, PropInfo[]>;
} | null = null;

async function getPropositionData(): Promise<{
  allOutcomeNames: Record<string, string>;
  propsByPeriod: Record<number, PropInfo[]>;
}> {
  if (propDataCache) return propDataCache;

  const allOutcomeNames: Record<string, string> = {};
  const propsByPeriod: Record<number, PropInfo[]> = {};

  const fetches = await Promise.all(
    [1, 2, 3, 4, 5, 6].map(period =>
      fetch(`${ESPN_BASE}?scoringPeriodId=${period}`)
        .then(r => r.json() as Promise<EspnChallengeResponse>)
        .then(data => ({ period, data }))
    )
  );

  for (const { period, data } of fetches) {
    const props: PropInfo[] = [];
    for (const prop of data.propositions || []) {
      const outcomes = (prop.possibleOutcomes || []).map(o => ({ id: o.id, name: o.name }));
      for (const o of outcomes) {
        allOutcomeNames[o.id] = o.name;
      }
      props.push({
        id: prop.id,
        displayOrder: prop.displayOrder ?? 0,
        outcomes,
      });
    }
    props.sort((a, b) => a.displayOrder - b.displayOrder);
    propsByPeriod[period] = props;
  }

  propDataCache = { allOutcomeNames, propsByPeriod };
  return propDataCache;
}

// ---------- Leaderboard ----------

export async function fetchEspnLeaderboard(): Promise<EspnEntry[]> {
  const [{ allOutcomeNames }, groupRes] = await Promise.all([
    getPropositionData(),
    fetch(ESPN_GROUP_URL),
  ]);

  if (!groupRes.ok) throw new Error(`ESPN group API error: ${groupRes.status}`);
  const data: EspnGroupResponse = await groupRes.json();

  return data.entries.map((e) => {
    const score = e.score;

    // Champion = from finalPick, resolved via the championship proposition outcomes
    let champion = '';
    const finalOid = e.finalPick?.outcomesPicked?.[0]?.outcomeId;
    if (finalOid && allOutcomeNames[finalOid]) {
      champion = allOutcomeNames[finalOid];
    }

    return {
      name: e.name,
      rank: score?.rank ?? 0,
      points: score?.overallScore ?? 0,
      maxPoints: score?.possiblePointsMax ?? 0,
      correct: score?.record?.wins ?? 0,
      wrong: score?.record?.losses ?? 0,
      percentile: score?.percentile ?? 0,
      eliminated: score?.eliminated ?? false,
      champion,
      picks: e.picks,
      finalPick: e.finalPick,
    };
  }).sort((a, b) => a.rank - b.rank || b.points - a.points);
}

// ---------- ESPN Bracket Reconstruction ----------

const SEED_MATCHUPS = [
  [1, 16], [8, 9], [5, 12], [4, 13], [6, 11], [3, 14], [7, 10], [2, 15],
];
const REGION_NAMES = ['East', 'South', 'West', 'Midwest'];

function emptySlot(slotId: string, round: string, region: string, position: number): BracketSlot {
  return {
    slotId, round, region, position,
    topTeam: null, topSeed: '', bottomTeam: null, bottomSeed: '',
    winner: null, topCount: 0, bottomCount: 0, totalBrackets: 0,
    topPickers: [], bottomPickers: [], eliminatedPickers: [],
    personPick: null, pickStatus: null,
    topEliminated: false, bottomEliminated: false,
  };
}

export async function buildEspnFullBracket(entry: EspnEntry): Promise<FullBracket> {
  const { allOutcomeNames, propsByPeriod } = await getPropositionData();

  // Build pick lookup: propositionId -> { team, result }
  const pickMap = new Map<string, { team: string; result: string }>();
  for (const pick of entry.picks) {
    const oid = pick.outcomesPicked?.[0]?.outcomeId;
    pickMap.set(pick.propositionId, {
      team: oid ? (allOutcomeNames[oid] || 'Unknown') : 'Unknown',
      result: pick.outcomesPicked?.[0]?.result || 'UNDECIDED',
    });
  }

  const eliminatedTeams = new Set<string>();
  const teamSeedMap: Record<string, string> = {};
  const norm = (t: string) => t.toLowerCase().trim();

  function getStatus(result?: string): 'correct' | 'incorrect' | 'pending' | null {
    if (!result) return null;
    if (result === 'CORRECT') return 'correct';
    if (result === 'INCORRECT') return 'incorrect';
    return 'pending';
  }

  function getSeed(team: string | null): string {
    if (!team) return '';
    return teamSeedMap[norm(team)] || '';
  }

  // Props are already sorted by displayOrder in propsByPeriod.
  // Use sorted INDEX (not displayOrder) to map to region/position.

  // ----- R64: 32 props, 8 per region -----
  const r64Props = propsByPeriod[1] || [];
  const r64ByRegion: BracketSlot[][] = [[], [], [], []];

  r64Props.forEach((prop, idx) => {
    const regionIdx = Math.floor(idx / 8);
    const position = idx % 8;
    if (regionIdx > 3) return;
    const [topSeedNum, bottomSeedNum] = SEED_MATCHUPS[position] || [0, 0];

    const topTeam = prop.outcomes[0]?.name || null;
    const bottomTeam = prop.outcomes[1]?.name || null;

    if (topTeam) teamSeedMap[norm(topTeam)] = topSeedNum.toString();
    if (bottomTeam) teamSeedMap[norm(bottomTeam)] = bottomSeedNum.toString();

    const pick = pickMap.get(prop.id);
    const personPick = pick?.team || null;
    const pickStatus = getStatus(pick?.result);

    if (pickStatus === 'incorrect' && personPick) {
      eliminatedTeams.add(norm(personPick));
    }

    r64ByRegion[regionIdx].push({
      slotId: `${REGION_NAMES[regionIdx]}_r64_${position}`,
      round: 'Round of 64',
      region: REGION_NAMES[regionIdx],
      position,
      topTeam, topSeed: topSeedNum.toString(),
      bottomTeam, bottomSeed: bottomSeedNum.toString(),
      winner: pickStatus === 'correct' ? personPick : null,
      topCount: 0, bottomCount: 0, totalBrackets: 0,
      topPickers: [], bottomPickers: [], eliminatedPickers: [],
      personPick, pickStatus,
      topEliminated: false, bottomEliminated: false,
    });
  });

  // ----- R32: 16 props, 4 per region -----
  const r32Props = propsByPeriod[2] || [];
  const r32ByRegion: BracketSlot[][] = [[], [], [], []];

  r32Props.forEach((prop, idx) => {
    const regionIdx = Math.floor(idx / 4);
    const position = idx % 4;
    if (regionIdx > 3) return;

    const r64 = r64ByRegion[regionIdx];
    const topTeam = r64[position * 2]?.personPick || null;
    const bottomTeam = r64[position * 2 + 1]?.personPick || null;

    const pick = pickMap.get(prop.id);
    const personPick = pick?.team || null;
    const pickStatus = getStatus(pick?.result);

    if (pickStatus === 'incorrect' && personPick) eliminatedTeams.add(norm(personPick));

    r32ByRegion[regionIdx].push({
      slotId: `${REGION_NAMES[regionIdx]}_r32_${position}`,
      round: 'Round of 32',
      region: REGION_NAMES[regionIdx],
      position,
      topTeam, topSeed: getSeed(topTeam),
      bottomTeam, bottomSeed: getSeed(bottomTeam),
      winner: pickStatus === 'correct' ? personPick : null,
      topCount: 0, bottomCount: 0, totalBrackets: 0,
      topPickers: [], bottomPickers: [], eliminatedPickers: [],
      personPick, pickStatus,
      topEliminated: !!topTeam && eliminatedTeams.has(norm(topTeam)),
      bottomEliminated: !!bottomTeam && eliminatedTeams.has(norm(bottomTeam)),
    });
  });

  // ----- S16: 8 props, 2 per region -----
  const s16Props = propsByPeriod[3] || [];
  const s16ByRegion: BracketSlot[][] = [[], [], [], []];

  s16Props.forEach((prop, idx) => {
    const regionIdx = Math.floor(idx / 2);
    const position = idx % 2;
    if (regionIdx > 3) return;

    const r32 = r32ByRegion[regionIdx];
    const topTeam = r32[position * 2]?.personPick || null;
    const bottomTeam = r32[position * 2 + 1]?.personPick || null;

    const pick = pickMap.get(prop.id);
    const personPick = pick?.team || null;
    const pickStatus = getStatus(pick?.result);

    if (pickStatus === 'incorrect' && personPick) eliminatedTeams.add(norm(personPick));

    s16ByRegion[regionIdx].push({
      slotId: `${REGION_NAMES[regionIdx]}_s16_${position}`,
      round: 'Sweet 16',
      region: REGION_NAMES[regionIdx],
      position,
      topTeam, topSeed: getSeed(topTeam),
      bottomTeam, bottomSeed: getSeed(bottomTeam),
      winner: pickStatus === 'correct' ? personPick : null,
      topCount: 0, bottomCount: 0, totalBrackets: 0,
      topPickers: [], bottomPickers: [], eliminatedPickers: [],
      personPick, pickStatus,
      topEliminated: !!topTeam && eliminatedTeams.has(norm(topTeam)),
      bottomEliminated: !!bottomTeam && eliminatedTeams.has(norm(bottomTeam)),
    });
  });

  // ----- E8: 4 props, 1 per region -----
  const e8Props = propsByPeriod[4] || [];
  const e8ByRegion: BracketSlot[][] = [[], [], [], []];

  e8Props.forEach((prop, idx) => {
    const regionIdx = idx;
    if (regionIdx > 3) return;

    const s16 = s16ByRegion[regionIdx];
    const topTeam = s16[0]?.personPick || null;
    const bottomTeam = s16[1]?.personPick || null;

    const pick = pickMap.get(prop.id);
    const personPick = pick?.team || null;
    const pickStatus = getStatus(pick?.result);

    if (pickStatus === 'incorrect' && personPick) eliminatedTeams.add(norm(personPick));

    e8ByRegion[regionIdx].push({
      slotId: `${REGION_NAMES[regionIdx]}_e8_0`,
      round: 'Elite 8',
      region: REGION_NAMES[regionIdx],
      position: 0,
      topTeam, topSeed: getSeed(topTeam),
      bottomTeam, bottomSeed: getSeed(bottomTeam),
      winner: pickStatus === 'correct' ? personPick : null,
      topCount: 0, bottomCount: 0, totalBrackets: 0,
      topPickers: [], bottomPickers: [], eliminatedPickers: [],
      personPick, pickStatus,
      topEliminated: !!topTeam && eliminatedTeams.has(norm(topTeam)),
      bottomEliminated: !!bottomTeam && eliminatedTeams.has(norm(bottomTeam)),
    });
  });

  // ----- Regions -----
  const regions: RegionBracket[] = REGION_NAMES.map((name, i) => ({
    region: name,
    r64: r64ByRegion[i] || [],
    r32: r32ByRegion[i] || [],
    s16: s16ByRegion[i] || [],
    e8: e8ByRegion[i] || [],
  }));

  // ----- Final Four: 2 props -----
  const ffProps = propsByPeriod[5] || [];
  const ff: BracketSlot[] = [];

  ffProps.forEach((prop, idx) => {
    const topTeam = idx === 0 ? (e8ByRegion[0]?.[0]?.personPick || null) : (e8ByRegion[2]?.[0]?.personPick || null);
    const bottomTeam = idx === 0 ? (e8ByRegion[1]?.[0]?.personPick || null) : (e8ByRegion[3]?.[0]?.personPick || null);

    const pick = pickMap.get(prop.id);
    const personPick = pick?.team || null;
    const pickStatus = getStatus(pick?.result);

    if (pickStatus === 'incorrect' && personPick) eliminatedTeams.add(norm(personPick));

    ff.push({
      slotId: `ff_${idx}`,
      round: 'Final Four',
      region: idx === 0 ? 'East/South' : 'West/Midwest',
      position: idx,
      topTeam, topSeed: getSeed(topTeam),
      bottomTeam, bottomSeed: getSeed(bottomTeam),
      winner: pickStatus === 'correct' ? personPick : null,
      topCount: 0, bottomCount: 0, totalBrackets: 0,
      topPickers: [], bottomPickers: [], eliminatedPickers: [],
      personPick, pickStatus,
      topEliminated: !!topTeam && eliminatedTeams.has(norm(topTeam)),
      bottomEliminated: !!bottomTeam && eliminatedTeams.has(norm(bottomTeam)),
    });
  });

  // ----- Championship -----
  const champTopTeam = ff[0]?.personPick || null;
  const champBottomTeam = ff[1]?.personPick || null;
  const champProps = propsByPeriod[6] || [];
  const champProp = champProps[0];

  let championship: BracketSlot;
  if (champProp) {
    const pick = pickMap.get(champProp.id);
    const personPick = pick?.team || entry.champion || null;
    const pickStatus = getStatus(pick?.result);

    championship = {
      slotId: 'champ', round: 'Championship', region: '', position: 0,
      topTeam: champTopTeam, topSeed: getSeed(champTopTeam),
      bottomTeam: champBottomTeam, bottomSeed: getSeed(champBottomTeam),
      winner: pickStatus === 'correct' ? personPick : null,
      topCount: 0, bottomCount: 0, totalBrackets: 0,
      topPickers: [], bottomPickers: [], eliminatedPickers: [],
      personPick, pickStatus,
      topEliminated: !!champTopTeam && eliminatedTeams.has(norm(champTopTeam)),
      bottomEliminated: !!champBottomTeam && eliminatedTeams.has(norm(champBottomTeam)),
    };
  } else {
    championship = emptySlot('champ', 'Championship', '', 0);
    championship.personPick = entry.champion || null;
  }

  return { regions, ff, championship };
}
