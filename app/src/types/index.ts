export interface Game {
  key: string;
  team1: string;
  team2: string;
  round: string;
  seed1: string;
  seed2: string;
  region: string;
  picks: Record<string, string>; // bracketName -> picked team
}

export interface GameResult {
  winner: string;
  round: string;
}

export interface BracketGame {
  round: string;
  team1: string;
  team2: string;
  pick: string;
  seed1: string;
  seed2: string;
  region: string;
}

export interface BracketData {
  games: BracketGame[];
}

export interface BracketEntry {
  name: string; // bracket name — unique key
  person: string; // person who submitted the bracket
  pool: string;
  filename: string;
  muted: boolean; // excluded from pick counts
}

export interface PersonScore {
  correct: number;
  incorrect: number;
  pending: number;
  total: number;
  points: number;
  maxPoints: number; // current points + max still earnable
}

// Slot in the visual bracket — represents one game position
export interface BracketSlot {
  slotId: string;     // e.g. "east_r64_1", "east_r32_1", "ff_1", "champ"
  round: string;
  region: string;
  position: number;   // position within the round/region (0-indexed)
  topTeam: string | null;
  topSeed: string;
  bottomTeam: string | null;
  bottomSeed: string;
  winner: string | null;     // actual result
  // Aggregated pick counts from all active brackets
  topCount: number;
  bottomCount: number;
  totalBrackets: number;
  // Who picked which
  topPickers: string[];
  bottomPickers: string[];
  // Brackets whose projected winner isn't in the actual game
  eliminatedPickers: { name: string; team: string }[];
  // Individual bracket view
  personPick?: string | null;         // this person's pick for this game
  pickStatus?: 'correct' | 'incorrect' | 'pending' | null;
  topEliminated?: boolean;   // true if topTeam is already eliminated from the tournament
  bottomEliminated?: boolean; // true if bottomTeam is already eliminated from the tournament
}
