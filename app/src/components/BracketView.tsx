import { useMemo, useState } from 'react';
import { useBrackets } from '../context/BracketContext';
import { buildFullBracket, buildPersonBracket, RegionBracket } from '../utils/bracket';
import { BracketSlot } from '../types';
import { normalizeTeamName } from '../utils/csv';

interface BracketViewProps {
  selectedBracket: string;
  selectedPerson: string;
}

export function BracketView({ selectedBracket, selectedPerson }: BracketViewProps) {
  const { activeBrackets, filteredBrackets, results, entries } = useBrackets();
  const [selectedSlot, setSelectedSlot] = useState<BracketSlot | null>(null);
  const isPersonView = selectedBracket !== '';

  // When a person is selected but no specific bracket, narrow activeBrackets to just that person's
  const effectiveActive = useMemo(() => {
    if (!selectedPerson) return activeBrackets;
    const personBracketNames = new Set(
      entries.filter(e => e.person === selectedPerson).map(e => e.name)
    );
    const filtered: Record<string, typeof activeBrackets[string]> = {};
    for (const [name, data] of Object.entries(activeBrackets)) {
      if (personBracketNames.has(name)) filtered[name] = data;
    }
    return filtered;
  }, [activeBrackets, entries, selectedPerson]);

  const bracket = useMemo(() => {
    if (isPersonView) {
      return buildPersonBracket(selectedBracket, filteredBrackets, results);
    }
    return buildFullBracket(effectiveActive, results, filteredBrackets);
  }, [effectiveActive, results, filteredBrackets, selectedBracket, isPersonView]);

  // Score for selected person
  const personEntry = isPersonView ? entries.find(e => e.name === selectedBracket) : null;

  // Count correct/incorrect/pending for person view
  const personStats = useMemo(() => {
    if (!isPersonView) return null;
    const allSlots = [
      ...bracket.regions.flatMap(r => [...r.r64, ...r.r32, ...r.s16, ...r.e8]),
      ...bracket.ff,
      bracket.championship,
    ];
    let correct = 0, incorrect = 0, pending = 0;
    for (const s of allSlots) {
      if (s.pickStatus === 'correct') correct++;
      else if (s.pickStatus === 'incorrect') incorrect++;
      else if (s.pickStatus === 'pending') pending++;
    }
    return { correct, incorrect, pending };
  }, [bracket, isPersonView]);

  if (Object.keys(filteredBrackets).length === 0) {
    return <div className="empty-state"><h3>Upload brackets to see the bracket view</h3></div>;
  }

  return (
    <div className="bracket-container">
      {/* Person banner when viewing individual bracket */}
      {isPersonView && personEntry && personStats && (
        <div className="bracket-selector">
          <div className="person-banner">
            <span className="person-banner-name">{personEntry.person}</span>
            <span className="person-banner-bracket">{personEntry.name} ({personEntry.pool})</span>
            <div className="person-banner-stats">
              <span className="pbs correct">{personStats.correct}✓</span>
              <span className="pbs incorrect">{personStats.incorrect}✗</span>
              <span className="pbs pending">{personStats.pending}?</span>
            </div>
          </div>
        </div>
      )}

      {/* Mobile: round-by-round view */}
      <div className="bracket-mobile">
        <MobileBracket bracket={bracket} onSelect={setSelectedSlot} isPersonView={isPersonView} />
      </div>

      {/* Desktop: classic bracket tree */}
      <div className="bracket-desktop">
        <div className="bracket-half bracket-left">
          <RegionColumn region={bracket.regions[0]} side="left" onSelect={setSelectedSlot} isPersonView={isPersonView} />
          <RegionColumn region={bracket.regions[1]} side="left" onSelect={setSelectedSlot} isPersonView={isPersonView} />
        </div>

        <div className="bracket-center">
          <div className="ff-column">
            <SlotCard slot={bracket.ff[0]} onSelect={setSelectedSlot} compact isPersonView={isPersonView} />
            <div className="champ-slot">
              <SlotCard slot={bracket.championship} onSelect={setSelectedSlot} compact isPersonView={isPersonView} />
              {bracket.championship.winner && (
                <div className="champ-banner">🏆 {bracket.championship.winner}</div>
              )}
              {isPersonView && bracket.championship.personPick && !bracket.championship.winner && (
                <div className="champ-banner champ-pick">🏆 {bracket.championship.personPick}</div>
              )}
            </div>
            <SlotCard slot={bracket.ff[1]} onSelect={setSelectedSlot} compact isPersonView={isPersonView} />
          </div>
        </div>

        <div className="bracket-half bracket-right">
          <RegionColumn region={bracket.regions[2]} side="right" onSelect={setSelectedSlot} isPersonView={isPersonView} />
          <RegionColumn region={bracket.regions[3]} side="right" onSelect={setSelectedSlot} isPersonView={isPersonView} />
        </div>
      </div>

      {/* Detail panel when a game is clicked */}
      {selectedSlot && (
        <GameDetailPanel slot={selectedSlot} onClose={() => setSelectedSlot(null)} isPersonView={isPersonView} />
      )}
    </div>
  );
}

function RegionColumn({ region, side, onSelect, isPersonView }: {
  region: RegionBracket;
  side: 'left' | 'right';
  onSelect: (s: BracketSlot) => void;
  isPersonView: boolean;
}) {
  const rounds = [region.r64, region.r32, region.s16, region.e8];
  const displayRounds = side === 'right' ? [...rounds].reverse() : rounds;

  return (
    <div className={`region-bracket region-${side}`}>
      <div className="region-label">{region.region}</div>
      <div className="region-rounds">
        {displayRounds.map((roundSlots, ri) => (
          <div key={ri} className={`round-column round-col-${roundSlots.length}`}>
            {roundSlots.map(slot => (
              <SlotCard key={slot.slotId} slot={slot} onSelect={onSelect} isPersonView={isPersonView} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function SlotCard({ slot, onSelect, compact, isPersonView }: {
  slot: BracketSlot;
  onSelect: (s: BracketSlot) => void;
  compact?: boolean;
  isPersonView: boolean;
}) {
  const hasResult = !!slot.winner;
  const topWon = hasResult && slot.winner === slot.topTeam;
  const bottomWon = hasResult && slot.winner === slot.bottomTeam;
  const total = slot.topCount + slot.bottomCount;
  const topPct = total > 0 ? Math.round((slot.topCount / total) * 100) : 0;
  const bottomPct = total > 0 ? Math.round((slot.bottomCount / total) * 100) : 0;

  // Person view: highlight picked team
  const topIsPick = isPersonView && slot.personPick && slot.topTeam &&
    normalizeTeamName(slot.personPick) === normalizeTeamName(slot.topTeam);
  const bottomIsPick = isPersonView && slot.personPick && slot.bottomTeam &&
    normalizeTeamName(slot.personPick) === normalizeTeamName(slot.bottomTeam);

  const pickStatusClass = slot.pickStatus || '';

  return (
    <div
      className={`slot-card ${compact ? 'slot-compact' : ''} ${hasResult ? 'slot-decided' : ''} ${isPersonView ? 'slot-person' : ''} ${isPersonView ? `slot-pick-${pickStatusClass}` : ''}`}
      onClick={() => onSelect(slot)}
    >
      <div className={`slot-team slot-top ${topWon ? 'team-won' : ''} ${hasResult && !topWon ? 'team-lost' : ''} ${topIsPick ? 'team-picked' : ''}`}>
        <span className="slot-seed">{slot.topSeed}</span>
        <span className="slot-name">{slot.topTeam || 'TBD'}</span>
        {!isPersonView && total > 0 && (
          <span className={`slot-count ${topPct >= 70 ? 'count-hot' : topPct <= 30 ? 'count-cold' : ''}`}>
            {slot.topCount}
          </span>
        )}
        {topIsPick && <span className="pick-marker">◄</span>}
      </div>
      <div className={`slot-team slot-bottom ${bottomWon ? 'team-won' : ''} ${hasResult && !bottomWon ? 'team-lost' : ''} ${bottomIsPick ? 'team-picked' : ''}`}>
        <span className="slot-seed">{slot.bottomSeed}</span>
        <span className="slot-name">{slot.bottomTeam || 'TBD'}</span>
        {!isPersonView && total > 0 && (
          <span className={`slot-count ${bottomPct >= 70 ? 'count-hot' : bottomPct <= 30 ? 'count-cold' : ''}`}>
            {slot.bottomCount}
          </span>
        )}
        {bottomIsPick && <span className="pick-marker">◄</span>}
      </div>
    </div>
  );
}

function GameDetailPanel({ slot, onClose, isPersonView }: {
  slot: BracketSlot;
  onClose: () => void;
  isPersonView: boolean;
}) {
  const total = slot.topCount + slot.bottomCount;
  const topPct = total > 0 ? Math.round((slot.topCount / total) * 100) : 0;
  const bottomPct = total > 0 ? Math.round((slot.bottomCount / total) * 100) : 0;

  const topIsPick = isPersonView && slot.personPick && slot.topTeam &&
    normalizeTeamName(slot.personPick) === normalizeTeamName(slot.topTeam);
  const bottomIsPick = isPersonView && slot.personPick && slot.bottomTeam &&
    normalizeTeamName(slot.personPick) === normalizeTeamName(slot.bottomTeam);

  return (
    <div className="detail-overlay" onClick={onClose}>
      <div className="detail-panel" onClick={(e) => e.stopPropagation()}>
        <button className="detail-close" onClick={onClose}>&times;</button>
        <div className="detail-header">
          <span className="detail-round">{slot.round}</span>
          {slot.region && <span className="detail-region">{slot.region}</span>}
          {isPersonView && slot.pickStatus && (
            <span className={`detail-pick-badge pick-${slot.pickStatus}`}>
              {slot.pickStatus === 'correct' ? '✓ Correct' : slot.pickStatus === 'incorrect' ? '✗ Wrong' : '? Pending'}
            </span>
          )}
        </div>

        <div className="detail-matchup">
          <div className={`detail-team ${slot.winner === slot.topTeam ? 'detail-winner' : ''} ${topIsPick ? 'detail-picked' : ''}`}>
            <div className="detail-team-info">
              <span className="detail-seed">{slot.topSeed}</span>
              <span className="detail-name">{slot.topTeam || 'TBD'}</span>
              {topIsPick && <span className="detail-pick-label">PICK</span>}
            </div>
            {!isPersonView && (
              <div className="detail-stats">
                <div className="detail-bar-wrap">
                  <div className="detail-bar detail-bar-top" style={{ width: `${topPct}%` }} />
                </div>
                <span className="detail-count">{slot.topCount} ({topPct}%)</span>
              </div>
            )}
            {!isPersonView && slot.topPickers.length > 0 && (
              <div className="detail-pickers">
                {slot.topPickers.map(p => <span key={p} className="picker-tag">{p}</span>)}
              </div>
            )}
          </div>

          <div className="detail-vs">VS</div>

          <div className={`detail-team ${slot.winner === slot.bottomTeam ? 'detail-winner' : ''} ${bottomIsPick ? 'detail-picked' : ''}`}>
            <div className="detail-team-info">
              <span className="detail-seed">{slot.bottomSeed}</span>
              <span className="detail-name">{slot.bottomTeam || 'TBD'}</span>
              {bottomIsPick && <span className="detail-pick-label">PICK</span>}
            </div>
            {!isPersonView && (
              <div className="detail-stats">
                <div className="detail-bar-wrap">
                  <div className="detail-bar detail-bar-bottom" style={{ width: `${bottomPct}%` }} />
                </div>
                <span className="detail-count">{slot.bottomCount} ({bottomPct}%)</span>
              </div>
            )}
            {!isPersonView && slot.bottomPickers.length > 0 && (
              <div className="detail-pickers">
                {slot.bottomPickers.map(p => <span key={p} className="picker-tag">{p}</span>)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Mobile: show rounds as tabs, each tab shows that round's games
function MobileBracket({ bracket, onSelect, isPersonView }: {
  bracket: ReturnType<typeof buildFullBracket>;
  onSelect: (s: BracketSlot) => void;
  isPersonView: boolean;
}) {
  const [activeRound, setActiveRound] = useState(0);
  const roundLabels = ['R64', 'R32', 'S16', 'E8', 'F4', 'Final'];

  const allSlotsByRound = useMemo(() => {
    const rounds: BracketSlot[][] = [];
    rounds.push(bracket.regions.flatMap(r => r.r64));
    rounds.push(bracket.regions.flatMap(r => r.r32));
    rounds.push(bracket.regions.flatMap(r => r.s16));
    rounds.push(bracket.regions.flatMap(r => r.e8));
    rounds.push(bracket.ff);
    rounds.push([bracket.championship]);
    return rounds;
  }, [bracket]);

  return (
    <div>
      <div className="mobile-round-tabs">
        {roundLabels.map((label, i) => (
          <button
            key={label}
            className={`round-btn ${activeRound === i ? 'active' : ''}`}
            onClick={() => setActiveRound(i)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="mobile-games">
        {allSlotsByRound[activeRound]?.map(slot => (
          <SlotCard key={slot.slotId} slot={slot} onSelect={onSelect} isPersonView={isPersonView} />
        ))}
      </div>
    </div>
  );
}
