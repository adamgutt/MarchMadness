// Full analysis for Avi guttman 2 (Duke champion) in March Madness Pool 26
import fs from 'fs';

const ESPN_BASE = 'https://gambit-api.fantasy.espn.com/apis/v1/challenges/tournament-challenge-bracket-2026';
const API_BASE = 'https://gambit-api.fantasy.espn.com/apis/v1/challenges/277';
const GROUP_ID = '39ec1e2c-2fc6-44ac-933e-dcb95c9ab247';

// ============ STEP 1: Fetch all propositions ============
console.log('=== STEP 1: Fetching propositions ===');
const allOutcomeNames = {};
const propLookup = {};
const propsByPeriod = {};
for (let period = 1; period <= 6; period++) {
  const data = await (await fetch(`${ESPN_BASE}?scoringPeriodId=${period}`)).json();
  propsByPeriod[period] = [];
  for (const prop of data.propositions || []) {
    propLookup[prop.id] = { ...prop, period };
    propsByPeriod[period].push(prop);
    for (const o of prop.possibleOutcomes || []) allOutcomeNames[o.id] = o.name;
  }
  console.log(`  Period ${period}: ${(data.propositions || []).length} propositions`);
}

const pointsPerRound = { 1: 10, 2: 20, 3: 40, 4: 80, 5: 160, 6: 320 };
const roundNames = { 1: 'R64', 2: 'R32', 3: 'S16', 4: 'E8', 5: 'F4', 6: 'Champ' };

// ============ STEP 2: Fetch all group entries via pagination ============
console.log('\n=== STEP 2: Fetching all group entries ===');
const allEntries = [];
for (let offset = 0; offset < 2000; offset += 50) {
  const filter = JSON.stringify({ filterSortId: { value: 0 }, limit: 50, offset });
  const url = `${API_BASE}/groups/${GROUP_ID}/?platform=chui&view=chui_default_group&filter=${encodeURIComponent(filter)}`;
  const data = await (await fetch(url)).json();
  const entries = data.entries || [];
  allEntries.push(...entries);
  if (entries.length < 50) break;
}
console.log(`Total entries: ${allEntries.length}`);

// Find Duke brackets
const dukeEntries = allEntries.filter(e => {
  const champId = e.finalPick?.outcomesPicked?.[0]?.outcomeId;
  return (allOutcomeNames[champId] || '').toLowerCase().includes('duke');
});
console.log(`Duke champion brackets: ${dukeEntries.length}`);

// Find Avi guttman 2
const aviRaw = allEntries.find(e => e.name?.toLowerCase().includes('guttman 2'));
if (!aviRaw) { console.log('ERROR: Avi guttman 2 not found!'); process.exit(1); }
console.log(`\nAvi guttman 2: ${aviRaw.score?.overallScore} pts, rank ${aviRaw.score?.rank}`);

// ============ STEP 3: Save Duke brackets to Firebase + local ============
console.log('\n=== STEP 3: Saving Duke brackets ===');
const dukeSummary = dukeEntries.map(e => {
  const score = e.score || {};
  return {
    id: e.id,
    name: e.name,
    points: score.overallScore || 0,
    maxPoints: score.possiblePointsMax || 0,
    rank: score.rank || 0,
    percentile: score.percentile || 0,
    correct: score.record?.wins || 0,
    wrong: score.record?.losses || 0,
    champion: 'Duke',
  };
}).sort((a, b) => b.points - a.points);

fs.writeFileSync('duke_brackets.json', JSON.stringify(dukeSummary, null, 2));
console.log(`Saved ${dukeSummary.length} Duke brackets to duke_brackets.json`);

const aviSummary = dukeSummary.find(e => e.name?.toLowerCase().includes('guttman 2'));
const aviRankAmongDuke = dukeSummary.indexOf(aviSummary) + 1;
console.log(`Avi guttman 2 among Duke: #${aviRankAmongDuke} of ${dukeSummary.length}`);
console.log(`  ${aviSummary.points} pts | Max: ${aviSummary.maxPoints} | ${aviSummary.correct}✓ ${aviSummary.wrong}✗`);

// Top 20 Duke brackets
console.log('\nTop 20 Duke brackets:');
for (const e of dukeSummary.slice(0, 20)) {
  const marker = e.id === aviSummary.id ? ' <<<< YOU' : '';
  console.log(`  ${e.name}: ${e.points}pts | Max: ${e.maxPoints} | ${e.correct}✓ ${e.wrong}✗${marker}`);
}

// ============ STEP 4: Fetch full picks for Avi + all Duke brackets ============
console.log('\n=== STEP 4: Fetching full picks for all Duke brackets ===');

function buildPickMap(entry) {
  const map = {};
  let currentScore = 0;
  for (const pick of entry.picks) {
    const oid = pick.outcomesPicked?.[0]?.outcomeId;
    const result = pick.outcomesPicked?.[0]?.result;
    const propId = pick.propositionId;
    const period = propLookup[propId]?.period || 0;
    const pts = pointsPerRound[period] || 0;
    map[propId] = { outcomeId: oid, team: allOutcomeNames[oid] || '?', result, period, pts };
    if (result === 'CORRECT') currentScore += pts;
  }
  return { map, currentScore };
}

// Fetch Avi's full entry
const aviEntry = await (await fetch(`${API_BASE}/entries/${aviSummary.id}?platform=chui&view=chui_default`)).json();
const aviPicks = buildPickMap(aviEntry);
console.log(`Avi picks loaded: ${aviEntry.picks.length} picks, ${aviPicks.currentScore} current pts`);

// Fetch all Duke entries
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
  if ((i + 10) % 50 === 0 || i + 10 >= dukeEntries.length) {
    console.log(`  Fetched ${Math.min(i + 10, dukeEntries.length)}/${dukeEntries.length}...`);
  }
}
console.log(`Loaded ${allDukeEntries.length} Duke bracket entries`);

// Build competitor pick maps (everyone except Avi)
const competitors = allDukeEntries
  .filter(e => e.id !== aviEntry.id)
  .map(e => ({ name: e.name, id: e.id, ...buildPickMap(e) }));

console.log(`Competitors: ${competitors.length}`);

// ============ STEP 5: Identify Avi's picks ============
console.log('\n=== STEP 5: Avi guttman 2 bracket breakdown ===');

const aviUndecided = [];
const dukePropIds = [];
const nonDukePropIds = [];

for (const [propId, pick] of Object.entries(aviPicks.map)) {
  if (pick.result === 'UNDECIDED') {
    aviUndecided.push({ propId, ...pick });
    if (pick.team.includes('Duke')) {
      dukePropIds.push(propId);
    } else {
      nonDukePropIds.push({ propId, ...pick });
    }
  }
}
nonDukePropIds.sort((a, b) => b.period - a.period);

console.log(`Undecided picks: ${aviUndecided.length}`);
console.log(`  Duke picks (shared by all Duke brackets): ${dukePropIds.length} = ${dukePropIds.reduce((s, id) => s + (aviPicks.map[id]?.pts || 0), 0)}pts`);
console.log(`  Non-Duke picks (differentiators): ${nonDukePropIds.length}`);

// Round-by-round breakdown
for (let period = 1; period <= 6; period++) {
  const picks = Object.values(aviPicks.map).filter(p => p.period === period);
  const correct = picks.filter(p => p.result === 'CORRECT').length;
  const wrong = picks.filter(p => p.result === 'INCORRECT').length;
  const pending = picks.filter(p => p.result === 'UNDECIDED').length;
  console.log(`  ${roundNames[period]}: ${correct}✓ ${wrong}✗ ${pending}? = ${correct * pointsPerRound[period]}pts`);
}

console.log('\nDifferentiator picks (non-Duke, assuming Duke wins):');
for (const p of nonDukePropIds) {
  console.log(`  ${roundNames[p.period]} (${p.pts}pts): ${p.team}`);
}

// ============ STEP 6: Pick-by-pick comparison vs all Duke competitors ============
console.log('\n' + '='.repeat(80));
console.log('   PICK-BY-PICK COMPARISON vs ALL DUKE COMPETITORS');
console.log('   (Assuming Duke wins the championship)');
console.log('='.repeat(80));

for (const prop of nonDukePropIds) {
  const agree = [];
  const disagree = {};
  for (const comp of competitors) {
    const cp = comp.map[prop.propId];
    if (!cp) continue;
    if (cp.outcomeId === prop.outcomeId) { agree.push(comp.name); }
    else {
      const t = cp.team;
      if (!disagree[t]) disagree[t] = [];
      disagree[t].push(comp.name);
    }
  }
  const teams = Object.entries(disagree).sort((a, b) => b[1].length - a[1].length).map(([t, n]) => `${t}(${n.length})`).join(', ');
  console.log(`\n${roundNames[prop.period]} (${prop.pts}pts): Avi picked ${prop.team}`);
  console.log(`  Same: ${agree.length} | Different: ${Object.values(disagree).reduce((s,a)=>s+a.length,0)} [${teams}]`);
}

// ============ STEP 7: Dream scenario ============
console.log('\n' + '='.repeat(80));
console.log('   DREAM SCENARIO: Duke wins + all Avi non-Duke picks correct');
console.log('='.repeat(80));

const dukePts = dukePropIds.reduce((s, id) => s + (aviPicks.map[id]?.pts || 0), 0);
const nonDukePts = nonDukePropIds.reduce((s, p) => s + p.pts, 0);
const aviDreamScore = aviPicks.currentScore + dukePts + nonDukePts;

console.log(`\nAvi's score: ${aviPicks.currentScore} (current) + ${dukePts} (Duke) + ${nonDukePts} (other) = ${aviDreamScore}`);

function calcCompDreamScore(comp) {
  let score = comp.currentScore;
  for (const propId of dukePropIds) {
    const cp = comp.map[propId];
    if (cp?.result === 'UNDECIDED' && cp.team.includes('Duke')) score += cp.pts;
  }
  for (const prop of nonDukePropIds) {
    const cp = comp.map[prop.propId];
    if (cp?.result === 'UNDECIDED' && cp.outcomeId === prop.outcomeId) score += prop.pts;
  }
  return score;
}

const dreamResults = competitors.map(c => ({
  name: c.name, dreamScore: calcCompDreamScore(c), currentScore: c.currentScore,
})).sort((a, b) => b.dreamScore - a.dreamScore);

let cannotBeat = [];
for (const r of dreamResults) {
  if (aviDreamScore - r.dreamScore <= 0) cannotBeat.push(r);
}

console.log(`\nTop 15 competitors in dream scenario:`);
for (const r of dreamResults.slice(0, 15)) {
  const gap = aviDreamScore - r.dreamScore;
  const icon = gap > 0 ? '✓ +' + gap : gap === 0 ? '= TIE' : '✗ ' + gap;
  console.log(`  ${r.name}: ${r.dreamScore}pts (${icon})`);
}

if (cannotBeat.length === 0) {
  console.log(`\n✓ In dream scenario, Avi BEATS all ${competitors.length} Duke competitors!`);
} else {
  console.log(`\n⚠ Cannot beat in dream scenario:`);
  for (const c of cannotBeat) {
    console.log(`  ${c.name}: ${c.dreamScore} (${c.dreamScore === aviDreamScore ? 'TIE' : `beats Avi by ${c.dreamScore - aviDreamScore}`})`);
  }
}

// Check for exact twins (identical picks)
console.log('\n--- Checking for identical brackets ---');
for (const comp of competitors) {
  let same = 0, diff = 0;
  for (const pick of aviEntry.picks) {
    const propId = pick.propositionId;
    const aviOid = pick.outcomesPicked[0].outcomeId;
    const cp = comp.map[propId];
    if (cp?.outcomeId === aviOid) same++; else diff++;
  }
  if (diff === 0) {
    const compEntry = allDukeEntries.find(e => e.id === comp.id);
    console.log(`  TWIN: ${comp.name} — all ${same} picks identical! Tiebreaker: Avi=${aviEntry.tiebreakAnswers?.[0]?.answer} vs ${comp.name}=${compEntry?.tiebreakAnswers?.[0]?.answer}`);
  }
}

// ============ STEP 8: Loss tolerance ============
console.log('\n' + '='.repeat(80));
console.log('   LOSS TOLERANCE (Duke wins, vs ALL Duke competitors)');
console.log('='.repeat(80));

// Build team -> cascading props
const teamProps = {};
for (const p of nonDukePropIds) {
  if (!teamProps[p.team]) teamProps[p.team] = [];
  teamProps[p.team].push(p);
}
for (const t of Object.keys(teamProps)) teamProps[t].sort((a, b) => a.period - b.period);

function calcWorstGap(lostPropIds) {
  const aviScore = aviDreamScore - lostPropIds.reduce((s, id) => s + (aviPicks.map[id]?.pts || 0), 0);
  let worstGap = Infinity, worstComp = '', worstScore = 0;
  for (const comp of competitors) {
    let cs = comp.currentScore;
    for (const propId of dukePropIds) {
      const cp = comp.map[propId];
      if (cp?.result === 'UNDECIDED' && cp.team.includes('Duke')) cs += cp.pts;
    }
    for (const prop of nonDukePropIds) {
      const cp = comp.map[prop.propId];
      if (!cp || cp.result !== 'UNDECIDED') continue;
      if (lostPropIds.includes(prop.propId)) {
        if (cp.outcomeId !== prop.outcomeId) cs += prop.pts;
      } else {
        if (cp.outcomeId === prop.outcomeId) cs += prop.pts;
      }
    }
    const gap = aviScore - cs;
    if (gap < worstGap) { worstGap = gap; worstComp = comp.name; worstScore = cs; }
  }
  return { aviScore, worstGap, worstComp, worstScore };
}

const lossResults = [];
for (const [team, picks] of Object.entries(teamProps)) {
  for (const pick of picks) {
    const lostIds = picks.filter(p => p.period >= pick.period).map(p => p.propId);
    const ptsLost = lostIds.reduce((s, id) => s + (aviPicks.map[id]?.pts || 0), 0);
    const { aviScore, worstGap, worstComp, worstScore } = calcWorstGap(lostIds);
    lossResults.push({ team, round: roundNames[pick.period], period: pick.period, ptsLost, aviScore, worstGap, worstComp, worstScore, canAfford: worstGap > 0, lostIds });
  }
}

lossResults.sort((a, b) => {
  if (a.canAfford !== b.canAfford) return a.canAfford ? -1 : 1;
  return b.ptsLost - a.ptsLost;
});

const canLose = lossResults.filter(s => s.canAfford);
const mustWin = lossResults.filter(s => !s.canAfford);

console.log('\n--- CAN afford to lose ---');
if (canLose.length === 0) {
  console.log('  None — every single pick matters');
} else {
  for (const s of canLose) {
    const cascade = s.ptsLost > pointsPerRound[s.period] ? ` (cascades: -${s.ptsLost}pts)` : '';
    console.log(`  ✓ ${s.team} loses in ${s.round} (-${s.ptsLost}pts)${cascade}`);
    console.log(`    Avi: ${s.aviScore} | Next-best: ${s.worstComp} at ${s.worstScore} | Margin: +${s.worstGap}pts`);
  }
}

console.log('\n--- CANNOT afford to lose ---');
for (const s of mustWin) {
  const cascade = s.ptsLost > pointsPerRound[s.period] ? ` (cascades: -${s.ptsLost}pts)` : '';
  console.log(`  ✗ ${s.team} loses in ${s.round} (-${s.ptsLost}pts)${cascade}`);
  console.log(`    Avi: ${s.aviScore} | Beaten by: ${s.worstComp} at ${s.worstScore} | Deficit: ${s.worstGap}pts`);
}

// Combo losses
console.log('\n--- COMBO: Can lose both teams? ---');
const teamLoss = {};
for (const [team, picks] of Object.entries(teamProps)) {
  teamLoss[team] = { lostIds: picks.map(p => p.propId), lost: picks.reduce((s, p) => s + p.pts, 0), round: roundNames[picks[0].period] };
}
const teams = Object.keys(teamLoss);
const canLose2 = [];
for (let i = 0; i < teams.length; i++) {
  for (let j = i + 1; j < teams.length; j++) {
    const allLost = [...teamLoss[teams[i]].lostIds, ...teamLoss[teams[j]].lostIds];
    const { aviScore, worstGap, worstComp } = calcWorstGap(allLost);
    if (worstGap > 0) canLose2.push({ teams: [teams[i], teams[j]], totalLost: teamLoss[teams[i]].lost + teamLoss[teams[j]].lost, aviScore, worstGap, worstComp });
  }
}
if (canLose2.length === 0) { console.log('  None'); }
else {
  canLose2.sort((a, b) => b.totalLost - a.totalLost);
  for (const c of canLose2) console.log(`  ✓ ${c.teams.join(' + ')}: -${c.totalLost}pts → Avi ${c.aviScore} | Margin: +${c.worstGap}pts`);
}

// ============ FINAL SUMMARY ============
console.log('\n' + '='.repeat(80));
console.log('   FINAL SUMMARY — Avi guttman 2 (Duke) in March Madness Pool 26');
console.log('='.repeat(80));
console.log(`\nAvi guttman 2: Currently ${aviPicks.currentScore} pts, rank ${aviSummary.rank}, #${aviRankAmongDuke} among ${dukeSummary.length} Duke brackets`);
console.log(`Dream score (Duke wins + all correct): ${aviDreamScore}`);

const nextBest = dreamResults[0];
const cushion = aviDreamScore - nextBest.dreamScore;
console.log(`Closest competitor: ${nextBest.name} at ${nextBest.dreamScore} (${cushion >= 0 ? '+' + cushion : cushion}pts)`);

if (cannotBeat.length === 0) {
  console.log(`\n✓ PATH TO WIN EXISTS — Avi can finish #1 among Duke brackets!`);
} else if (cannotBeat.every(c => c.dreamScore === aviDreamScore)) {
  console.log(`\n= PATH EXISTS but requires tiebreaker win against ${cannotBeat.length} identical scorer(s)`);
} else {
  console.log(`\n✗ CANNOT win #1 among Duke brackets even in best case`);
}

console.log('\nMUST-WIN:');
for (const s of mustWin) {
  if (s.period === Math.min(...lossResults.filter(x => x.team === s.team).map(x => x.period))) {
    console.log(`  ★ ${s.team} — must survive through ${s.round}`);
  }
}
console.log('\nSAFE-TO-LOSE:');
if (canLose.length === 0) { console.log('  None'); }
for (const s of canLose) {
  if (s.period === Math.min(...lossResults.filter(x => x.team === s.team).map(x => x.period))) {
    console.log(`  ○ ${s.team} — can lose entirely, still ahead by ${s.worstGap}pts`);
  }
}
