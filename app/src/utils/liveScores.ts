import { normalizeTeamName } from './csv';

export interface LiveGame {
  id: string;
  team1: string;
  team2: string;
  seed1: string;
  seed2: string;
  score1: number;
  score2: number;
  status: 'pre' | 'in' | 'post'; // pre-game, in-progress, final
  statusDetail: string; // e.g. "Halftime", "2nd Half 5:32", "Final"
  winner: string | null; // only set when status === 'post'
  round: string;
}

// Map ESPN round names/numbers to our internal round names
function mapRound(espnRound: number): string {
  switch (espnRound) {
    case 1: return 'Round of 64';
    case 2: return 'Round of 32';
    case 3: return 'Sweet 16';
    case 4: return 'Elite 8';
    case 5: return 'Final Four';
    case 6: return 'Championship';
    default: return 'Round of 64';
  }
}

// ESPN team name aliases to match our CSV team names
const ESPN_ALIASES: Record<string, string> = {
  'uconn huskies': 'connecticut',
  'ucf knights': 'ucf',
  'mcneese cowboys': 'mcneese state',
  'vcu rams': 'vcu',
  'lsu tigers': 'lsu',
  'smu mustangs': 'smu',
  'byu cougars': 'byu',
  'unlv rebels': 'unlv',
  'utsa roadrunners': 'utsa',
};

function espnTeamName(competitor: { team: { displayName: string; shortDisplayName: string; abbreviation: string } }): string {
  const full = competitor.team.displayName.toLowerCase();
  if (ESPN_ALIASES[full]) return ESPN_ALIASES[full];
  // Use shortDisplayName which is usually just the school name (e.g., "Duke", "Florida")
  return competitor.team.shortDisplayName;
}

export async function fetchLiveScores(): Promise<LiveGame[]> {
  // ESPN public scoreboard API for men's college basketball
  // groups=100 filters to NCAA tournament games
  const url = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?groups=100&limit=100';

  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN API error: ${res.status}`);

  const data = await res.json();
  const liveGames: LiveGame[] = [];

  for (const event of data.events || []) {
    const competition = event.competitions?.[0];
    if (!competition) continue;

    const competitors = competition.competitors || [];
    if (competitors.length !== 2) continue;

    // competitors[0] is usually home, competitors[1] away — but order varies
    // Sort by homeAway to be consistent
    const home = competitors.find((c: { homeAway: string }) => c.homeAway === 'home') || competitors[0];
    const away = competitors.find((c: { homeAway: string }) => c.homeAway === 'away') || competitors[1];

    const statusObj = competition.status || event.status || {};
    const statusType = statusObj.type?.name || '';
    let status: 'pre' | 'in' | 'post' = 'pre';
    if (statusType === 'STATUS_IN_PROGRESS' || statusType === 'STATUS_HALFTIME') {
      status = 'in';
    } else if (statusType === 'STATUS_FINAL') {
      status = 'post';
    }

    const team1Name = espnTeamName(away);
    const team2Name = espnTeamName(home);
    const score1 = parseInt(away.score || '0', 10);
    const score2 = parseInt(home.score || '0', 10);

    let winner: string | null = null;
    if (status === 'post') {
      winner = score1 > score2 ? team1Name : team2Name;
    }

    // Try to extract round from the event notes or competition
    let round = 'Round of 64';
    const notes = event.competitions?.[0]?.notes;
    if (notes && notes.length > 0) {
      const headline = (notes[0].headline || '').toLowerCase();
      if (headline.includes('championship') || headline.includes('final') && !headline.includes('four')) {
        round = 'Championship';
      } else if (headline.includes('final four') || headline.includes('semifinal')) {
        round = 'Final Four';
      } else if (headline.includes('elite')) {
        round = 'Elite 8';
      } else if (headline.includes('sweet')) {
        round = 'Sweet 16';
      } else if (headline.includes('2nd round') || headline.includes('second round') || headline.includes('round of 32')) {
        round = 'Round of 32';
      }
    }

    // Also check season type info for round number
    const seasonRound = event.season?.type || competition.tournamentRound?.number;
    if (typeof seasonRound === 'number' && seasonRound >= 1 && seasonRound <= 6) {
      round = mapRound(seasonRound);
    }

    liveGames.push({
      id: event.id,
      team1: team1Name,
      team2: team2Name,
      seed1: away.curatedRank?.current?.toString() || away.seed || '',
      seed2: home.curatedRank?.current?.toString() || home.seed || '',
      score1,
      score2,
      status,
      statusDetail: statusObj.type?.shortDetail || statusObj.shortDetail || '',
      winner,
      round,
    });
  }

  return liveGames;
}

// Match a live game to our bracket teams
export function matchLiveGame(
  liveGame: LiveGame,
  team1: string | null,
  team2: string | null
): LiveGame | null {
  if (!team1 || !team2) return null;
  const t1 = normalizeTeamName(team1);
  const t2 = normalizeTeamName(team2);
  const l1 = normalizeTeamName(liveGame.team1);
  const l2 = normalizeTeamName(liveGame.team2);

  if ((t1 === l1 && t2 === l2) || (t1 === l2 && t2 === l1)) {
    return liveGame;
  }
  return null;
}
