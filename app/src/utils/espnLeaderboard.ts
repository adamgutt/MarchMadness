const ESPN_BASE = 'https://gambit-api.fantasy.espn.com/apis/v1/challenges/tournament-challenge-bracket-2026';
const ESPN_GROUP_URL = `${ESPN_BASE}/groups/39ec1e2c-2fc6-44ac-933e-dcb95c9ab247`;

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
  possibleOutcomes?: EspnPossibleOutcome[];
}

interface EspnChallengeResponse {
  propositions?: EspnProposition[];
}

interface EspnGroupResponse {
  entries: EspnRawEntry[];
}

// Cache the outcome map so we only fetch the challenge endpoint once
let outcomeCache: Record<string, string> | null = null;
let r64PropIdsCache: Set<string> | null = null;

async function getOutcomeMap(): Promise<{ outcomeNames: Record<string, string>; r64PropIds: Set<string> }> {
  if (outcomeCache && r64PropIdsCache) return { outcomeNames: outcomeCache, r64PropIds: r64PropIdsCache };

  const res = await fetch(ESPN_BASE);
  if (!res.ok) throw new Error(`ESPN challenge API error: ${res.status}`);
  const data: EspnChallengeResponse = await res.json();

  const outcomeNames: Record<string, string> = {};
  const r64PropIds = new Set<string>();

  for (const prop of data.propositions || []) {
    r64PropIds.add(prop.id);
    for (const o of prop.possibleOutcomes || []) {
      outcomeNames[o.id] = o.name;
    }
  }

  outcomeCache = outcomeNames;
  r64PropIdsCache = r64PropIds;
  return { outcomeNames, r64PropIds };
}

export async function fetchEspnLeaderboard(): Promise<EspnEntry[]> {
  const [{ outcomeNames, r64PropIds }, groupRes] = await Promise.all([
    getOutcomeMap(),
    fetch(ESPN_GROUP_URL),
  ]);

  if (!groupRes.ok) throw new Error(`ESPN group API error: ${groupRes.status}`);
  const data: EspnGroupResponse = await groupRes.json();

  return data.entries.map((e) => {
    const score = e.score;

    // Champion = the R64 pick with periodReached >= 6 (advanced to championship)
    let champion = '';
    for (const pick of e.picks) {
      if (!r64PropIds.has(pick.propositionId)) continue;
      if (pick.periodReached >= 6) {
        const oid = pick.outcomesPicked?.[0]?.outcomeId;
        champion = (oid && outcomeNames[oid]) || '';
        break;
      }
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
    };
  }).sort((a, b) => a.rank - b.rank || b.points - a.points);
}
