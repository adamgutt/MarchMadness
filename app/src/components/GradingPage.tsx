import { useState, useMemo } from 'react';
import { useBrackets } from '../context/BracketContext';
import { buildFullBracket } from '../utils/bracket';
import { BracketSlot } from '../types';

const ROUND_ORDER = ['Round of 64', 'Round of 32', 'Sweet 16', 'Elite 8', 'Final Four', 'Championship'];

export function GradingPage() {
  const { activeBrackets, results, brackets, setResult } = useBrackets();
  const [activeRound, setActiveRound] = useState(0);

  const bracket = useMemo(
    () => buildFullBracket(activeBrackets, results, brackets),
    [activeBrackets, results, brackets],
  );

  const slotsByRound: BracketSlot[][] = useMemo(() => {
    return [
      bracket.regions.flatMap(r => r.r64),
      bracket.regions.flatMap(r => r.r32),
      bracket.regions.flatMap(r => r.s16),
      bracket.regions.flatMap(r => r.e8),
      bracket.ff,
      [bracket.championship],
    ];
  }, [bracket]);

  const handleSetWinner = (slot: BracketSlot, winner: string) => {
    if (!slot.topTeam || !slot.bottomTeam) return;
    setResult(slot.topTeam, slot.bottomTeam, winner, slot.round);
  };

  const decidedCount = slotsByRound.flat().filter(s => s.winner).length;
  const totalGames = slotsByRound.flat().length;

  return (
    <div className="grading-page">
      <header>
        <h1>GAME GRADING</h1>
        <p className="grading-sub">
          {decidedCount} of {totalGames} games graded
        </p>
      </header>

      <div className="grading-round-tabs">
        {ROUND_ORDER.map((label, i) => {
          const graded = slotsByRound[i]?.filter(s => s.winner).length || 0;
          const total = slotsByRound[i]?.length || 0;
          return (
            <button
              key={label}
              className={`round-btn ${activeRound === i ? 'active' : ''}`}
              onClick={() => setActiveRound(i)}
            >
              {label}
              <span className="round-progress">{graded}/{total}</span>
            </button>
          );
        })}
      </div>

      <div className="grading-games">
        {slotsByRound[activeRound]?.map(slot => (
          <GradeCard key={slot.slotId} slot={slot} onSetWinner={handleSetWinner} />
        ))}
      </div>
    </div>
  );
}

function GradeCard({ slot, onSetWinner }: {
  slot: BracketSlot;
  onSetWinner: (slot: BracketSlot, winner: string) => void;
}) {
  const hasBoth = slot.topTeam && slot.bottomTeam;
  const topWon = slot.winner === slot.topTeam;
  const bottomWon = slot.winner === slot.bottomTeam;

  return (
    <div className={`grade-card ${slot.winner ? 'grade-decided' : ''}`}>
      <div className="grade-region">{slot.region}</div>
      <div className="grade-matchup">
        <button
          className={`grade-team ${topWon ? 'grade-won' : ''} ${slot.winner && !topWon ? 'grade-lost' : ''}`}
          onClick={() => hasBoth && slot.topTeam && onSetWinner(slot, slot.topTeam)}
          disabled={!hasBoth}
        >
          <span className="grade-seed">{slot.topSeed}</span>
          <span className="grade-name">{slot.topTeam || 'TBD'}</span>
        </button>
        <span className="grade-vs">vs</span>
        <button
          className={`grade-team ${bottomWon ? 'grade-won' : ''} ${slot.winner && !bottomWon ? 'grade-lost' : ''}`}
          onClick={() => hasBoth && slot.bottomTeam && onSetWinner(slot, slot.bottomTeam)}
          disabled={!hasBoth}
        >
          <span className="grade-seed">{slot.bottomSeed}</span>
          <span className="grade-name">{slot.bottomTeam || 'TBD'}</span>
        </button>
      </div>
    </div>
  );
}
