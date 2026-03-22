// Fetches live game results from ESPN proposition API and returns a map of propId -> winnerOutcomeId.
// Used by ScenarioGenerator and EspnLeaderboard to overlay live results onto cached Firebase data.

const ESPN_BASE = 'https://gambit-api.fantasy.espn.com/apis/v1/challenges/tournament-challenge-bracket-2026';

interface EspnProp {
  id: string;
  correctOutcomes?: string[];
}

interface EspnResponse {
  propositions?: EspnProp[];
}

/** Fetch all 63 game results from ESPN. Returns { propId: winnerOutcomeId } for concluded games. */
export async function fetchLiveResults(): Promise<Record<string, string>> {
  const results: Record<string, string> = {};

  const fetches = await Promise.all(
    [1, 2, 3, 4, 5, 6].map(period =>
      fetch(`${ESPN_BASE}?scoringPeriodId=${period}`)
        .then(r => r.json() as Promise<EspnResponse>)
        .then(data => data.propositions || [])
    )
  );

  for (const props of fetches) {
    for (const prop of props) {
      if (prop.correctOutcomes && prop.correctOutcomes.length > 0) {
        results[prop.id] = prop.correctOutcomes[0];
      }
    }
  }

  return results;
}
