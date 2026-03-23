import { useEffect, useMemo, useState } from 'react';
import { useBrackets } from '../context/BracketContext';
import { buildFullBracket, buildPersonBracket, FullBracket, RegionBracket } from '../utils/bracket';
import { BracketSlot } from '../types';
import { normalizeTeamName } from '../utils/csv';
import { LiveGame, matchLiveGame } from '../utils/liveScores';
import { loadCanWinSet } from '../utils/scenarioRanks';

interface BracketViewProps {
  selectedBracket: string;
  selectedPerson: string;
  externalBracket?: FullBracket;
  externalInfo?: { name: string; detail: string; extra?: string };
}

export function BracketView({ selectedBracket, selectedPerson, externalBracket, externalInfo }: BracketViewProps) {
  const { activeBrackets, filteredBrackets, results, entries, liveGames, filteredScores } = useBrackets();
  const [selectedSlot, setSelectedSlot] = useState<BracketSlot | null>(null);
  const [showOnlyCanWin, setShowOnlyCanWin] = useState(false);
  const [canWinBrackets, setCanWinBrackets] = useState<Set<string>>(new Set());
  const [canWinLoading, setCanWinLoading] = useState(true);
  const isPersonView = selectedBracket !== '' || !!externalBracket;

  // Load can-win set
  const allBracketNames = useMemo(() => Object.keys(activeBrackets), [activeBrackets]);
  useEffect(() => {
    if (!allBracketNames.length) { setCanWinLoading(false); return; }
    setCanWinLoading(true);
    loadCanWinSet(allBracketNames).then(set => {
      setCanWinBrackets(set);
      setCanWinLoading(false);
    });
  }, [allBracketNames]);

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

  // Further filter to only can-win brackets when toggle is on
  const displayActive = useMemo(() => {
    if (!showOnlyCanWin) return effectiveActive;
    const filtered: Record<string, typeof effectiveActive[string]> = {};
    for (const [name, data] of Object.entries(effectiveActive)) {
      if (canWinBrackets.has(name)) filtered[name] = data;
    }
    return filtered;
  }, [effectiveActive, showOnlyCanWin, canWinBrackets]);

  const bracket = useMemo(() => {
    if (externalBracket) return externalBracket;
    if (isPersonView) {
      return buildPersonBracket(selectedBracket, filteredBrackets, results);
    }
    return buildFullBracket(displayActive, results, filteredBrackets);
  }, [displayActive, results, filteredBrackets, selectedBracket, isPersonView, externalBracket]);

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

  if (!externalBracket && Object.keys(filteredBrackets).length === 0) {
    return <div className="empty-state"><h3>Upload brackets to see the bracket view</h3></div>;
  }

  return (
    <div className="bracket-container">
      {/* Person banner when viewing individual bracket */}
      {isPersonView && personStats && (externalInfo || personEntry) && (
        <div className="bracket-selector">
          <div className="person-banner">
            {externalInfo ? (
              <>
                <span className="person-banner-name">{externalInfo.name}</span>
                <span className="person-banner-bracket">{externalInfo.detail}</span>
                {externalInfo.extra && <span className="person-banner-bracket">{externalInfo.extra}</span>}
              </>
            ) : personEntry ? (
              <>
                <span className="person-banner-name">{personEntry.person}</span>
                <span className="person-banner-bracket">{personEntry.name} ({personEntry.pool})</span>
              </>
            ) : null}
            <div className="person-banner-stats">
              <span className="pbs correct">{personStats.correct}✓</span>
              <span className="pbs incorrect">{personStats.incorrect}✗</span>
              <span className="pbs pending">{personStats.pending}?</span>
            </div>
          </div>
        </div>
      )}

      {/* Can-win filter (aggregate view only) */}
      {!isPersonView && (
        <div className="can-win-filter" style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: '0.9rem' }}>
            <input
              type="checkbox"
              checked={showOnlyCanWin}
              onChange={() => setShowOnlyCanWin(v => !v)}
            />
            Only brackets that can finish 1st
            {canWinLoading ? (
              <span style={{ color: '#999', fontSize: '0.8rem' }}>(loading…)</span>
            ) : (
              <span style={{ color: '#999', fontSize: '0.8rem' }}>
                ({canWinBrackets.size} of {Object.keys(effectiveActive).length})
              </span>
            )}
          </label>
        </div>
      )}

      {/* Mobile: round-by-round view */}
      <div className="bracket-mobile">
        <MobileBracket bracket={bracket} onSelect={setSelectedSlot} isPersonView={isPersonView} liveGames={liveGames} />
      </div>

      {/* Desktop: classic bracket tree */}
      <div className="bracket-desktop">
        <div className="bracket-half bracket-left">
          <RegionColumn region={bracket.regions[0]} side="left" onSelect={setSelectedSlot} isPersonView={isPersonView} liveGames={liveGames} />
          <RegionColumn region={bracket.regions[1]} side="left" onSelect={setSelectedSlot} isPersonView={isPersonView} liveGames={liveGames} />
        </div>

        <div className="bracket-center">
          <div className="ff-column">
            <SlotCard slot={bracket.ff[0]} onSelect={setSelectedSlot} compact isPersonView={isPersonView} liveGames={liveGames} />
            <div className="champ-slot">
              <SlotCard slot={bracket.championship} onSelect={setSelectedSlot} compact isPersonView={isPersonView} liveGames={liveGames} />
              {bracket.championship.winner && (
                <div className="champ-banner">🏆 {bracket.championship.winner}</div>
              )}
              {isPersonView && bracket.championship.personPick && !bracket.championship.winner && (
                <div className="champ-banner champ-pick">🏆 {bracket.championship.personPick}</div>
              )}
            </div>
            <SlotCard slot={bracket.ff[1]} onSelect={setSelectedSlot} compact isPersonView={isPersonView} liveGames={liveGames} />
          </div>
        </div>

        <div className="bracket-half bracket-right">
          <RegionColumn region={bracket.regions[2]} side="right" onSelect={setSelectedSlot} isPersonView={isPersonView} liveGames={liveGames} />
          <RegionColumn region={bracket.regions[3]} side="right" onSelect={setSelectedSlot} isPersonView={isPersonView} liveGames={liveGames} />
        </div>
      </div>

      {/* Detail panel when a game is clicked */}
      {selectedSlot && (
        <GameDetailPanel slot={selectedSlot} onClose={() => setSelectedSlot(null)} isPersonView={isPersonView} liveGames={liveGames} scores={filteredScores} entries={entries} />
      )}
    </div>
  );
}

function RegionColumn({ region, side, onSelect, isPersonView, liveGames }: {
  region: RegionBracket;
  side: 'left' | 'right';
  onSelect: (s: BracketSlot) => void;
  isPersonView: boolean;
  liveGames: LiveGame[];
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
              <SlotCard key={slot.slotId} slot={slot} onSelect={onSelect} isPersonView={isPersonView} liveGames={liveGames} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function SlotCard({ slot, onSelect, compact, isPersonView, liveGames }: {
  slot: BracketSlot;
  onSelect: (s: BracketSlot) => void;
  compact?: boolean;
  isPersonView: boolean;
  liveGames: LiveGame[];
}) {
  const hasResult = !!slot.winner;
  const topWon = hasResult && slot.winner === slot.topTeam;
  const bottomWon = hasResult && slot.winner === slot.bottomTeam;
  const total = slot.topCount + slot.bottomCount;
  const topPct = total > 0 ? Math.round((slot.topCount / total) * 100) : 0;
  const bottomPct = total > 0 ? Math.round((slot.bottomCount / total) * 100) : 0;

  // Find live game for this slot
  const liveGame = useMemo(() => {
    if (hasResult) return null;
    for (const lg of liveGames) {
      if (matchLiveGame(lg, slot.topTeam, slot.bottomTeam)) return lg;
    }
    return null;
  }, [liveGames, slot.topTeam, slot.bottomTeam, hasResult]);

  const isLive = liveGame?.status === 'in';

  // Get scores oriented correctly (top team = which live team?)
  const topScore = liveGame ? (
    normalizeTeamName(liveGame.team1) === normalizeTeamName(slot.topTeam || '')
      ? liveGame.score1 : liveGame.score2
  ) : null;
  const bottomScore = liveGame ? (
    normalizeTeamName(liveGame.team1) === normalizeTeamName(slot.bottomTeam || '')
      ? liveGame.score1 : liveGame.score2
  ) : null;

  // Person view: highlight picked team
  const topIsPick = isPersonView && slot.personPick && slot.topTeam &&
    normalizeTeamName(slot.personPick) === normalizeTeamName(slot.topTeam);
  const bottomIsPick = isPersonView && slot.personPick && slot.bottomTeam &&
    normalizeTeamName(slot.personPick) === normalizeTeamName(slot.bottomTeam);

  const pickStatusClass = slot.pickStatus || '';

  // In person view, color the picked team by pick status instead of actual winner
  const topClass = isPersonView
    ? (topIsPick ? `team-pick-${pickStatusClass}` : '')
    : `${topWon ? 'team-won' : ''} ${hasResult && !topWon ? 'team-lost' : ''}`;
  const bottomClass = isPersonView
    ? (bottomIsPick ? `team-pick-${pickStatusClass}` : '')
    : `${bottomWon ? 'team-won' : ''} ${hasResult && !bottomWon ? 'team-lost' : ''}`;

  return (
    <div
      className={`slot-card ${compact ? 'slot-compact' : ''} ${hasResult ? 'slot-decided' : ''} ${isLive ? 'slot-live' : ''} ${isPersonView ? 'slot-person' : ''} ${isPersonView ? `slot-pick-${pickStatusClass}` : ''}`}
      onClick={() => onSelect(slot)}
    >
      <div className={`slot-team slot-top ${topClass} ${topIsPick ? 'team-picked' : ''} ${isPersonView && slot.topEliminated ? 'team-eliminated' : ''}`}>
        <span className="slot-seed">{slot.topSeed}</span>
        <span className="slot-name">{slot.topTeam || 'TBD'}</span>
        {isLive && topScore !== null && (
          <span className="slot-score">{topScore}</span>
        )}
        {!isPersonView && total > 0 && (
          <span className={`slot-count ${topPct >= 70 ? 'count-hot' : topPct <= 30 ? 'count-cold' : ''}`}>
            {slot.topCount}
          </span>
        )}
        {topIsPick && <span className="pick-marker">◄</span>}
      </div>
      <div className={`slot-team slot-bottom ${bottomClass} ${bottomIsPick ? 'team-picked' : ''} ${isPersonView && slot.bottomEliminated ? 'team-eliminated' : ''}`}>
        <span className="slot-seed">{slot.bottomSeed}</span>
        <span className="slot-name">{slot.bottomTeam || 'TBD'}</span>
        {isLive && bottomScore !== null && (
          <span className="slot-score">{bottomScore}</span>
        )}
        {!isPersonView && total > 0 && (
          <span className={`slot-count ${bottomPct >= 70 ? 'count-hot' : bottomPct <= 30 ? 'count-cold' : ''}`}>
            {slot.bottomCount}
          </span>
        )}
        {bottomIsPick && <span className="pick-marker">◄</span>}
      </div>
      {isLive && liveGame && (
        <div className="slot-live-status">{liveGame.statusDetail}</div>
      )}
    </div>
  );
}

function GameDetailPanel({ slot, onClose, isPersonView, liveGames, scores, entries }: {
  slot: BracketSlot;
  onClose: () => void;
  isPersonView: boolean;
  liveGames: LiveGame[];
  scores: Record<string, import('../types').PersonScore>;
  entries: import('../types').BracketEntry[];
}) {
  const poolMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of entries) m[e.name] = e.pool;
    return m;
  }, [entries]);
  const poolClass = (name: string) => {
    const pool = poolMap[name]?.toLowerCase() || '';
    if (pool === 'mandel') return 'picker-tag-mandel';
    if (pool === 'aronoff') return 'picker-tag-aronoff';
    return '';
  };
  const total = slot.topCount + slot.bottomCount;
  const topPct = total > 0 ? Math.round((slot.topCount / total) * 100) : 0;
  const bottomPct = total > 0 ? Math.round((slot.bottomCount / total) * 100) : 0;

  const topIsPick = isPersonView && slot.personPick && slot.topTeam &&
    normalizeTeamName(slot.personPick) === normalizeTeamName(slot.topTeam);
  const bottomIsPick = isPersonView && slot.personPick && slot.bottomTeam &&
    normalizeTeamName(slot.personPick) === normalizeTeamName(slot.bottomTeam);

  // Find live game
  const liveGame = useMemo(() => {
    if (slot.winner) return null;
    for (const lg of liveGames) {
      if (matchLiveGame(lg, slot.topTeam, slot.bottomTeam)) return lg;
    }
    return null;
  }, [liveGames, slot.topTeam, slot.bottomTeam, slot.winner]);

  const topLiveScore = liveGame ? (
    normalizeTeamName(liveGame.team1) === normalizeTeamName(slot.topTeam || '') ? liveGame.score1 : liveGame.score2
  ) : null;
  const bottomLiveScore = liveGame ? (
    normalizeTeamName(liveGame.team1) === normalizeTeamName(slot.bottomTeam || '') ? liveGame.score1 : liveGame.score2
  ) : null;

  return (
    <div className="detail-overlay" onClick={onClose}>
      <div className="detail-panel" onClick={(e) => e.stopPropagation()}>
        <button className="detail-close" onClick={onClose}>&times;</button>
        <div className="detail-header">
          <span className="detail-round">{slot.round}</span>
          {slot.region && <span className="detail-region">{slot.region}</span>}
          {liveGame?.status === 'in' && (
            <span className="detail-live-badge">🔴 LIVE — {liveGame.statusDetail}</span>
          )}
          {liveGame?.status === 'pre' && (
            <span className="detail-pre-badge">⏳ {liveGame.statusDetail}</span>
          )}
          {isPersonView && slot.pickStatus && (
            <span className={`detail-pick-badge pick-${slot.pickStatus}`}>
              {slot.pickStatus === 'correct' ? '✓ Correct' : slot.pickStatus === 'incorrect' ? '✗ Wrong' : '? Pending'}
            </span>
          )}
        </div>

        {/* Pool color legend */}
        {!isPersonView && (
          <div className="detail-pool-legend">
            <span className="picker-tag picker-tag-mandel">Mandel</span>
            <span className="picker-tag picker-tag-aronoff">Aronoff</span>
          </div>
        )}

        {/* Live scoreboard */}
        {liveGame && (liveGame.status === 'in' || liveGame.status === 'pre') && (
          <div className="detail-live-scoreboard">
            <div className="live-score-row">
              <span className="live-score-team">{slot.topSeed} {slot.topTeam}</span>
              <span className="live-score-num">{topLiveScore ?? '-'}</span>
            </div>
            <div className="live-score-row">
              <span className="live-score-team">{slot.bottomSeed} {slot.bottomTeam}</span>
              <span className="live-score-num">{bottomLiveScore ?? '-'}</span>
            </div>
          </div>
        )}

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
                {slot.topPickers.map(p => <span key={p} className={`picker-tag ${poolClass(p)}`}>{p}{scores[p] ? ` (${scores[p].maxPoints})` : ''}</span>)}
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
                {slot.bottomPickers.map(p => <span key={p} className={`picker-tag ${poolClass(p)}`}>{p}{scores[p] ? ` (${scores[p].maxPoints})` : ''}</span>)}
              </div>
            )}
          </div>
        </div>

        {/* Eliminated brackets — team they needed isn't in this game */}
        {!isPersonView && slot.eliminatedPickers.length > 0 && (
          <div className="detail-eliminated">
            <div className="detail-eliminated-header">
              <span className="eliminated-icon">✗</span>
              <span>Eliminated ({slot.eliminatedPickers.length}) — picked a team not in this game</span>
            </div>
            <div className="detail-pickers">
              {slot.eliminatedPickers.map(p => (
                <span key={p.name} className="picker-tag picker-tag-eliminated">
                  {p.name} <span className="eliminated-team">({p.team})</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Mobile: show rounds as tabs, each tab shows that round's games
function MobileBracket({ bracket, onSelect, isPersonView, liveGames }: {
  bracket: ReturnType<typeof buildFullBracket>;
  onSelect: (s: BracketSlot) => void;
  isPersonView: boolean;
  liveGames: LiveGame[];
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
          <SlotCard key={slot.slotId} slot={slot} onSelect={onSelect} isPersonView={isPersonView} liveGames={liveGames} />
        ))}
      </div>
    </div>
  );
}
