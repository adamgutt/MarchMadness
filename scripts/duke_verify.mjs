// RIGOROUS verification of Duke dream scenario
// Check: are there propositions where Avi is INCORRECT but competitors are UNDECIDED?
// If so, competitors could score extra points that my original analysis missed.

const ESPN_BASE = 'https://gambit-api.fantasy.espn.com/apis/v1/challenges/tournament-challenge-bracket-2026';
const API_BASE = 'https://gambit-api.fantasy.espn.com/apis/v1/challenges/277';
const GROUP_ID = '39ec1e2c-2fc6-44ac-933e-dcb95c9ab247';

// ============ Fetch propositions ============
console.log('=== Fetching propositions ===');
const allOutcomeNames = {};
const propLookup = {};
for (let period = 1; period <= 6; period++) {
  const data = await (await fetch(`${ESPN_BASE}?scoringPeriodId=${period}`)).json();
  for (const prop of data.propositions || []) {
    propLookup[prop.id] = { ...prop, period };
    for (const o of prop.possibleOutcomes || []) allOutcomeNames[o.id] = o.name;
  }
}

const pointsPerRound = { 1: 10, 2: 20, 3: 40, 4: 80, 5: 160, 6: 320 };
const roundNames = { 1: 'R64', 2: 'R32', 3: 'S16', 4: 'E8', 5: 'F4', 6: 'Champ' };

// ============ Fetch all group entries ============
console.log('=== Fetching all group entries ===');
const allEntries = [];
for (let offset = 0; offset < 2000; offset += 50) {
  const filter = JSON.stringify({ filterSortId: { value: 0 }, limit: 50, offset });
  const url = `${API_BASE}/groups/${GROUP_ID}/?platform=chui&view=chui_default_group&filter=${encodeURIComponent(filter)}`;
  const data = await (await fetch(url)).json();
  const entries = data.entries || [];
  allEntries.push(...entries);
  if (entries.length < 50) break;
}

// Find Duke brackets
const dukeEntries = allEntries.filter(e => {
  const champId = e.finalPick?.outcomesPicked?.[0]?.outcomeId;
  return (allOutcomeNames[champId] || '').toLowerCase().includes('duke');
});

const aviRaw = allEntries.find(e => e.name?.toLowerCase().includes('guttman 2'));
console.log(`Avi: ${aviRaw.name}, ${aviRaw.score?.overallScore} pts`);
console.log(`Duke brackets: ${dukeEntries.length}`);

// ============ Fetch full picks ============
console.log('\n=== Fetching full picks ===');

function buildFullPickMap(entry) {
  const map = {};
  for (const pick of entry.picks) {
    const oid = pick.outcomesPicked?.[0]?.outcomeId;
    const result = pick.outcomesPicked?.[0]?.result;
    const propId = pick.propositionId;
    const period = propLookup[propId]?.period || 0;
    const pts = pointsPerRound[period] || 0;
    map[propId] = { outcomeId: oid, team: allOutcomeNames[oid] || '?', result, period, pts };
  }
  return map;
}

// Fetch Avi
const aviEntry = await (await fetch(`${API_BASE}/entries/${aviRaw.id}?platform=chui&view=chui_default`)).json();
const aviMap = buildFullPickMap(aviEntry);

// Fetch all Duke competitors
const allDukeEntries = [];
for (let i = 0; i < dukeEntries.length; i += 10) {
  const batch = dukeEntries.slice(i, i + 10);
  const results = await Promise.all(batch.map(async (entry) => {
    try {
      const resp = await fetch(`${API_BASE}/entries/${entry.id}?platform=chui&view=chui_default`);
      return resp.ok ? await resp.json() : null;
    } catch { return null; }
  }));
  allDukeEntries.push(...results.filter(Boolean));
  if ((i + 10) % 100 === 0) console.log(`  Fetched ${Math.min(i + 10, dukeEntries.length)}/${dukeEntries.length}...`);
}
console.log(`Loaded ${allDukeEntries.length} entries`);

// ============ STEP 1: Identify "free" propositions ============
// These are props where Avi is INCORRECT but the actual game may not have been played
console.log('\n' + '='.repeat(80));
console.log('   STEP 1: Checking for "free" games (Avi INCORRECT, game possibly unresolved)');
console.log('='.repeat(80));

const aviIncorrectProps = [];
const aviUndecidedProps = [];
const aviCorrectProps = [];

for (const [propId, pick] of Object.entries(aviMap)) {
  if (pick.result === 'INCORRECT') aviIncorrectProps.push({ propId, ...pick });
  else if (pick.result === 'UNDECIDED') aviUndecidedProps.push({ propId, ...pick });
  else if (pick.result === 'CORRECT') aviCorrectProps.push({ propId, ...pick });
}

console.log(`\nAvi's picks: ${aviCorrectProps.length} correct, ${aviIncorrectProps.length} incorrect, ${aviUndecidedProps.length} undecided`);

// For each INCORRECT Avi pick, check if ANY competitor has UNDECIDED on that same prop
console.log(`\nChecking Avi's ${aviIncorrectProps.length} INCORRECT picks for unresolved games:`);

const freeProps = []; // Props where Avi is wrong but competitors might still score

for (const aviPick of aviIncorrectProps) {
  let competitorUndecidedCount = 0;
  let maxCompBonusPts = 0;
  const compUndecidedNames = [];
  
  for (const compEntry of allDukeEntries) {
    if (compEntry.id === aviEntry.id) continue;
    const compMap = buildFullPickMap(compEntry);
    const compPick = compMap[aviPick.propId];
    if (compPick?.result === 'UNDECIDED') {
      competitorUndecidedCount++;
      maxCompBonusPts = compPick.pts;
      if (compUndecidedNames.length < 5) compUndecidedNames.push(`${compEntry.name}(${compPick.team})`);
    }
  }
  
  const gameStatus = competitorUndecidedCount > 0 ? '⚠ UNRESOLVED GAME' : '✓ Game settled';
  console.log(`  ${roundNames[aviPick.period]} ${aviPick.team} (${aviPick.pts}pts): ${gameStatus}`);
  if (competitorUndecidedCount > 0) {
    console.log(`    → ${competitorUndecidedCount} competitors still UNDECIDED on this game (+${maxCompBonusPts}pts each)`);
    console.log(`    → Examples: ${compUndecidedNames.join(', ')}`);
    freeProps.push({ ...aviPick, competitorUndecidedCount, bonusPts: maxCompBonusPts });
  }
}

const totalFreePts = freeProps.reduce((s, p) => s + p.bonusPts, 0);
console.log(`\n==> FREE games found: ${freeProps.length} (max ${totalFreePts}pts extra for competitors)`);

// ============ STEP 2: CORRECTED dream scenario ============
console.log('\n' + '='.repeat(80));
console.log('   STEP 2: CORRECTED dream scenario (accounting for free games)');
console.log('='.repeat(80));

// Avi's dream score stays the same — he can't score on incorrect picks
const aviCurrentScore = Object.values(aviMap).filter(p => p.result === 'CORRECT').reduce((s, p) => s + p.pts, 0);
const aviDreamScore = aviCurrentScore + aviUndecidedProps.reduce((s, p) => s + p.pts, 0);
console.log(`\nAvi dream score: ${aviCurrentScore} (current) + ${aviUndecidedProps.reduce((s,p)=>s+p.pts,0)} (undecided→correct) = ${aviDreamScore}`);

// For each competitor, calculate their WORST-CASE-FOR-AVI score:
// = currentScore + agreed undecided picks + free game bonus picks
const freePropIds = new Set(freeProps.map(p => p.propId));

const correctedResults = [];
for (const compEntry of allDukeEntries) {
  if (compEntry.id === aviEntry.id) continue;
  const compMap = buildFullPickMap(compEntry);
  
  let score = 0;
  // Go through ALL 63 propositions
  for (const [propId, aviPick] of Object.entries(aviMap)) {
    const compPick = compMap[propId];
    if (!compPick) continue;
    
    if (compPick.result === 'CORRECT') {
      // Already scored
      score += compPick.pts;
    } else if (compPick.result === 'INCORRECT') {
      // Already lost, no points
    } else if (compPick.result === 'UNDECIDED') {
      if (aviPick.result === 'UNDECIDED') {
        // Avi's dream: this prop resolves to Avi's pick
        // Competitor gets points only if they agree with Avi
        if (compPick.outcomeId === aviPick.outcomeId) {
          score += compPick.pts;
        }
      } else if (aviPick.result === 'INCORRECT') {
        // FREE GAME: Avi already lost, game outcome NOT determined by dream
        // WORST CASE: competitor gets these points
        score += compPick.pts;
      } else if (aviPick.result === 'CORRECT') {
        // Game already played, Avi won. But comp is UNDECIDED?
        // This shouldn't happen if game is played... let's flag it
        console.log(`  WARNING: Avi CORRECT but comp UNDECIDED on ${propId} (${compEntry.name})`);
        // In theory, if game is played, comp should have a result too
        // But if comp picked a team eliminated earlier, they could be INCORRECT, not UNDECIDED
        // If this happens, it's anomalous - give comp benefit of doubt
        score += compPick.pts;
      }
    }
  }
  
  correctedResults.push({ name: compEntry.name, id: compEntry.id, correctedScore: score });
}

correctedResults.sort((a, b) => b.correctedScore - a.correctedScore);

console.log(`\nTop 20 competitors (CORRECTED worst-case for Avi):`);
for (const r of correctedResults.slice(0, 20)) {
  const gap = aviDreamScore - r.correctedScore;
  const icon = gap > 0 ? `✓ +${gap}` : gap === 0 ? '= TIE' : `✗ ${gap}`;
  console.log(`  ${r.name}: ${r.correctedScore}pts (${icon})`);
}

const cannotBeatCorrected = correctedResults.filter(r => r.correctedScore >= aviDreamScore);
if (cannotBeatCorrected.length === 0) {
  console.log(`\n✓ VERIFIED: Even accounting for free games, Avi BEATS all ${correctedResults.length} Duke competitors!`);
} else {
  console.log(`\n⚠ CORRECTION: ${cannotBeatCorrected.length} competitors can tie or beat Avi:`);
  for (const c of cannotBeatCorrected) {
    console.log(`  ${c.name}: ${c.correctedScore} (${c.correctedScore === aviDreamScore ? 'TIE' : `beats by ${c.correctedScore - aviDreamScore}`})`);
  }
}

// ============ STEP 3: Compare original vs corrected ============
console.log('\n' + '='.repeat(80));
console.log('   STEP 3: Original vs Corrected comparison');
console.log('='.repeat(80));

// Also calculate original (for comparison)
function calcOriginal(compEntry) {
  const compMap = buildFullPickMap(compEntry);
  let score = 0;
  for (const pick of compEntry.picks) {
    const r = pick.outcomesPicked?.[0]?.result;
    if (r === 'CORRECT') score += (pointsPerRound[propLookup[pick.propositionId]?.period] || 0);
  }
  // Add agreed undecided
  for (const aviPick of aviUndecidedProps) {
    const compPick = compMap[aviPick.propId];
    if (compPick?.result === 'UNDECIDED' && compPick.outcomeId === aviPick.outcomeId) {
      score += aviPick.pts;
    }
  }
  return score;
}

let maxDiff = 0;
let maxDiffEntry = '';
for (const compEntry of allDukeEntries) {
  if (compEntry.id === aviEntry.id) continue;
  const orig = calcOriginal(compEntry);
  const corr = correctedResults.find(r => r.id === compEntry.id)?.correctedScore || 0;
  const diff = corr - orig;
  if (diff > maxDiff) { maxDiff = diff; maxDiffEntry = compEntry.name; }
}

console.log(`\nMax difference (corrected - original): ${maxDiff}pts (${maxDiffEntry})`);
console.log(`Original closest gap: ${aviDreamScore - correctedResults.sort((a,b) => b.correctedScore - a.correctedScore)[0]?.correctedScore}`);

if (maxDiff > 0) {
  console.log(`\n⚠ The original analysis UNDERESTIMATED competitor scores by up to ${maxDiff}pts!`);
  console.log(`Original margin: 120pts → Corrected margin: ${aviDreamScore - correctedResults[0].correctedScore}pts`);
} else {
  console.log(`\n✓ No difference — original analysis was correct. All free games already settled.`);
}

// ============ STEP 4: CORRECTED loss tolerance ============
console.log('\n' + '='.repeat(80));
console.log('   STEP 4: CORRECTED loss tolerance');
console.log('='.repeat(80));

// Group Avi's undecided picks by team
const teamProps = {};
for (const pick of aviUndecidedProps) {
  if (pick.team.includes('Duke')) continue; // Duke picks shared
  if (!teamProps[pick.team]) teamProps[pick.team] = [];
  teamProps[pick.team].push(pick);
}
for (const t of Object.keys(teamProps)) teamProps[t].sort((a, b) => a.period - b.period);

function calcCorrectedCompScore(compEntry, lostPropIds) {
  const compMap = buildFullPickMap(compEntry);
  let score = 0;
  const lostSet = new Set(lostPropIds);
  
  for (const [propId, aviPick] of Object.entries(aviMap)) {
    const compPick = compMap[propId];
    if (!compPick) continue;
    
    if (compPick.result === 'CORRECT') {
      score += compPick.pts;
    } else if (compPick.result === 'INCORRECT') {
      // no points
    } else if (compPick.result === 'UNDECIDED') {
      if (aviPick.result === 'INCORRECT') {
        // Free game — competitor gets points (worst case)
        score += compPick.pts;
      } else if (aviPick.result === 'UNDECIDED') {
        if (lostSet.has(propId)) {
          // Avi lost this pick — outcome is NOT Avi's pick
          // If comp picked the SAME as Avi, comp also loses
          // If comp picked DIFFERENT, they MIGHT win (worst case: they do)
          if (compPick.outcomeId !== aviPick.outcomeId) {
            score += compPick.pts;
          }
        } else {
          // Avi wins this pick — comp gets points only if they agree
          if (compPick.outcomeId === aviPick.outcomeId) {
            score += compPick.pts;
          }
        }
      } else if (aviPick.result === 'CORRECT') {
        // Should be settled for comp too, but give benefit of doubt
        score += compPick.pts;
      }
    }
  }
  return score;
}

function calcCorrectedWorstGap(lostPropIds) {
  const lostSet = new Set(lostPropIds);
  const aviScore = aviDreamScore - lostPropIds.reduce((s, id) => s + (aviMap[id]?.pts || 0), 0);
  
  let worstGap = Infinity, worstComp = '', worstScore = 0;
  for (const compEntry of allDukeEntries) {
    if (compEntry.id === aviEntry.id) continue;
    const cs = calcCorrectedCompScore(compEntry, lostPropIds);
    const gap = aviScore - cs;
    if (gap < worstGap) { worstGap = gap; worstComp = compEntry.name; worstScore = cs; }
  }
  return { aviScore, worstGap, worstComp, worstScore };
}

const lossResults = [];
for (const [team, picks] of Object.entries(teamProps)) {
  for (const pick of picks) {
    const lostIds = picks.filter(p => p.period >= pick.period).map(p => p.propId);
    const ptsLost = lostIds.reduce((s, id) => s + (aviMap[id]?.pts || 0), 0);
    const { aviScore, worstGap, worstComp, worstScore } = calcCorrectedWorstGap(lostIds);
    lossResults.push({ team, round: roundNames[pick.period], period: pick.period, ptsLost, aviScore, worstGap, worstComp, worstScore, canAfford: worstGap > 0, lostIds });
  }
}

lossResults.sort((a, b) => {
  if (a.canAfford !== b.canAfford) return a.canAfford ? -1 : 1;
  return b.ptsLost - a.ptsLost;
});

console.log('\n--- CORRECTED: CAN afford to lose ---');
const canLose = lossResults.filter(s => s.canAfford);
if (canLose.length === 0) {
  console.log('  None');
} else {
  for (const s of canLose) {
    console.log(`  ✓ ${s.team} loses in ${s.round} (-${s.ptsLost}pts)`);
    console.log(`    Avi: ${s.aviScore} | Next-best: ${s.worstComp} at ${s.worstScore} | Margin: +${s.worstGap}pts`);
  }
}

console.log('\n--- CORRECTED: CANNOT afford to lose ---');
const mustWin = lossResults.filter(s => !s.canAfford);
for (const s of mustWin) {
  console.log(`  ✗ ${s.team} loses in ${s.round} (-${s.ptsLost}pts)`);
  console.log(`    Avi: ${s.aviScore} | Beaten by: ${s.worstComp} at ${s.worstScore} | Deficit: ${s.worstGap}pts`);
}

// Combo losses
console.log('\n--- CORRECTED: Combo losses ---');
const teamLoss = {};
for (const [team, picks] of Object.entries(teamProps)) {
  teamLoss[team] = { lostIds: picks.map(p => p.propId), lost: picks.reduce((s, p) => s + p.pts, 0) };
}
const teams = Object.keys(teamLoss);
const canLose2 = [];
for (let i = 0; i < teams.length; i++) {
  for (let j = i + 1; j < teams.length; j++) {
    const allLost = [...teamLoss[teams[i]].lostIds, ...teamLoss[teams[j]].lostIds];
    const { aviScore, worstGap, worstComp } = calcCorrectedWorstGap(allLost);
    if (worstGap > 0) canLose2.push({ teams: [teams[i], teams[j]], totalLost: teamLoss[teams[i]].lost + teamLoss[teams[j]].lost, aviScore, worstGap, worstComp });
  }
}
if (canLose2.length === 0) { console.log('  None'); }
else {
  canLose2.sort((a, b) => b.totalLost - a.totalLost);
  for (const c of canLose2) console.log(`  ✓ ${c.teams.join(' + ')}: -${c.totalLost}pts → Avi ${c.aviScore} | Margin: +${c.worstGap}pts`);
}

console.log('\n' + '='.repeat(80));
console.log('   FINAL VERDICT');
console.log('='.repeat(80));
