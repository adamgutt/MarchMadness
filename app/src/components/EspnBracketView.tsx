import { useState, useEffect } from 'react';
import { EspnEntry, buildEspnFullBracket } from '../utils/espnLeaderboard';
import { BracketView } from './BracketView';
import type { FullBracket } from '../utils/bracket';

interface Props {
  entry: EspnEntry;
  onBack: () => void;
}

export function EspnBracketView({ entry, onBack }: Props) {
  const [bracket, setBracket] = useState<FullBracket | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    buildEspnFullBracket(entry).then(b => {
      setBracket(b);
      setLoading(false);
    });
  }, [entry]);

  if (loading || !bracket) {
    return (
      <div>
        <div className="espn-bracket-back">
          <button className="link-btn" onClick={onBack}>← Back to ESPN Standings</button>
        </div>
        <div className="empty-state"><p>Loading bracket...</p></div>
      </div>
    );
  }

  return (
    <>
      <div className="espn-bracket-back">
        <button className="link-btn" onClick={onBack}>← Back to ESPN Standings</button>
      </div>
      <BracketView
        selectedBracket=""
        selectedPerson=""
        externalBracket={bracket}
        externalInfo={{
          name: entry.name,
          detail: `Rank #${entry.rank} · ${entry.points} pts · Max ${entry.maxPoints}`,
          extra: entry.champion ? `🏆 ${entry.champion}` : undefined,
        }}
      />
    </>
  );
}
