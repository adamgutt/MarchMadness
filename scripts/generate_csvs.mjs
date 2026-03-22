// Generate precise CSV data for both brackets
const ESPN_BASE = 'https://gambit-api.fantasy.espn.com/apis/v1/challenges/tournament-challenge-bracket-2026';
const API_BASE = 'https://gambit-api.fantasy.espn.com/apis/v1/challenges/277';
const GROUP_ID = '39ec1e2c-2fc6-44ac-933e-dcb95c9ab247';

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
const roundNames = { 1: 'R64', 2: 'R32', 3: 'S16', 4: 'E8', 5: 'F4', 6: 'Championship' };

// Fetch all entries
const allEntries = [];
for (let offset = 0; offset < 2000; offset += 50) {
  const filter = JSON.stringify({ filterSortId: { value: 0 }, limit: 50, offset });
  const url = `${API_BASE}/groups/${GROUP_ID}/?platform=chui&view=chui_default_group&filter=${encodeURIComponent(filter)}`;
  const data = await (await fetch(url)).json();
  allEntries.push(...(data.entries || []));
  if ((data.entries || []).length < 50) break;
}
console.log(`Fetched ${allEntries.length} entries`);

function buildPickMap(entry) {
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

async function analyzeBracket(bracketNameSearch, championSearch, excludeTwinName) {
  const champEntries = allEntries.filter(e => {
    const champId = e.finalPick?.outcomesPicked?.[0]?.outcomeId;
    return (allOutcomeNames[champId] || '').toLowerCase().includes(championSearch);
  });

  const aviRaw = allEntries.find(e => e.name?.toLowerCase().includes(bracketNameSearch));
  console.log(`\n=== ${aviRaw.name} (${championSearch} champion) ===`);
  console.log(`Champion brackets: ${champEntries.length}`);

  // Fetch Avi's picks
  const aviEntry = await (await fetch(`${API_BASE}/entries/${aviRaw.id}?platform=chui&view=chui_default`)).json();
  const aviMap = buildPickMap(aviEntry);

  // Fetch all champion bracket picks
  const compEntries = [];
  for (let i = 0; i < champEntries.length; i += 10) {
    const batch = champEntries.slice(i, i + 10);
    const results = await Promise.all(batch.map(async (entry) => {
      try {
        const resp = await fetch(`${API_BASE}/entries/${entry.id}?platform=chui&view=chui_default`);
        return resp.ok ? await resp.json() : null;
      } catch { return null; }
    }));
    compEntries.push(...results.filter(Boolean));
    if ((i + 10) % 100 === 0) process.stdout.write('.');
  }
  console.log(`\nLoaded ${compEntries.length} entries`);

  // Filter out Avi + optional twin
  const competitors = compEntries.filter(e => {
    if (e.id === aviEntry.id) return false;
    if (excludeTwinName && e.name?.toLowerCase().includes(excludeTwinName)) return false;
    return true;
  });
  console.log(`Competitors (excluding self${excludeTwinName ? ' + twin' : ''}): ${competitors.length}`);

  // Avi's undecided picks
  const aviUndecided = [];
  const champPropIds = [];
  const nonChampProps = [];

  for (const [propId, pick] of Object.entries(aviMap)) {
    if (pick.result === 'UNDECIDED') {
      aviUndecided.push({ propId, ...pick });
      if (pick.team.toLowerCase().includes(championSearch)) {
        champPropIds.push(propId);
      } else {
        nonChampProps.push({ propId, ...pick });
      }
    }
  }
  nonChampProps.sort((a, b) => b.period - a.period);

  const aviCurrentScore = Object.values(aviMap).filter(p => p.result === 'CORRECT').reduce((s, p) => s + p.pts, 0);
  const aviDreamScore = aviCurrentScore + aviUndecided.reduce((s, p) => s + p.pts, 0);

  // Group by team
  const teamProps = {};
  for (const p of nonChampProps) {
    if (!teamProps[p.team]) teamProps[p.team] = [];
    teamProps[p.team].push(p);
  }
  for (const t of Object.keys(teamProps)) teamProps[t].sort((a, b) => a.period - b.period);

  function calcCompScoreForLoss(compEntry, lostPropIds) {
    const compMap = buildPickMap(compEntry);
    const lostSet = new Set(lostPropIds);
    let score = 0;
    for (const [propId, aviPick] of Object.entries(aviMap)) {
      const compPick = compMap[propId];
      if (!compPick) continue;
      if (compPick.result === 'CORRECT') { score += compPick.pts; }
      else if (compPick.result === 'INCORRECT') { /* nothing */ }
      else if (compPick.result === 'UNDECIDED') {
        if (aviPick.result === 'INCORRECT') {
          score += compPick.pts; // free game
        } else if (aviPick.result === 'UNDECIDED') {
          if (lostSet.has(propId)) {
            if (compPick.outcomeId !== aviPick.outcomeId) score += compPick.pts;
          } else {
            if (compPick.outcomeId === aviPick.outcomeId) score += compPick.pts;
          }
        } else if (aviPick.result === 'CORRECT') {
          score += compPick.pts;
        }
      }
    }
    return score;
  }

  function calcWorstGap(lostPropIds) {
    const aviScore = aviDreamScore - lostPropIds.reduce((s, id) => s + (aviMap[id]?.pts || 0), 0);
    let worstGap = Infinity, worstComp = '', worstScore = 0;
    for (const comp of competitors) {
      const cs = calcCompScoreForLoss(comp, lostPropIds);
      const gap = aviScore - cs;
      if (gap < worstGap) { worstGap = gap; worstComp = comp.name; worstScore = cs; }
    }
    return { aviScore, worstGap, worstComp, worstScore };
  }

  // Calculate loss results for each team
  const results = [];
  for (const [team, picks] of Object.entries(teamProps)) {
    // "Lose entirely" = first round appearance and all subsequent
    const allLostIds = picks.map(p => p.propId);
    const totalPtsLost = allLostIds.reduce((s, id) => s + (aviMap[id]?.pts || 0), 0);
    const firstRound = picks[0].period;
    const lastRound = picks[picks.length - 1].period;
    const { aviScore, worstGap, worstComp, worstScore } = calcWorstGap(allLostIds);

    const roundsStr = picks.length === 1
      ? roundNames[firstRound]
      : `${roundNames[firstRound]} through ${roundNames[lastRound]}`;

    results.push({
      team,
      rounds: roundsStr,
      firstRound,
      totalPtsLost,
      aviScore,
      worstComp,
      worstScore,
      margin: worstGap,
      canAfford: worstGap > 0,
    });
  }

  results.sort((a, b) => {
    if (a.canAfford !== b.canAfford) return a.canAfford ? 1 : -1; // must-win first
    return b.totalPtsLost - a.totalPtsLost;
  });

  return { name: aviRaw.name, champion: championSearch, dreamScore: aviDreamScore, currentScore: aviCurrentScore, results, excludeTwinName };
}

import fs from 'fs';

function generateCSV(analysis) {
  const lines = [];
  lines.push('Team,Rounds Picked,Status,Points at Stake,My Dream Score,My Score if Lost,Closest Competitor,Competitor Score,Margin,Result');

  for (const r of analysis.results) {
    const status = r.canAfford ? 'SAFE TO LOSE' : 'MUST WIN';
    const result = r.canAfford ? `Still win by ${r.margin}pts` : (r.margin === 0 ? 'Tied (lose on tiebreak scenario)' : `Lose by ${Math.abs(r.margin)}pts`);
    lines.push(`${r.team},${r.rounds},${status},${r.totalPtsLost},${analysis.dreamScore},${r.aviScore},${r.worstComp},${r.worstScore},${r.margin >= 0 ? '+' : ''}${r.margin},${result}`);
  }

  // Add summary rows
  lines.push('');
  lines.push(`BRACKET SUMMARY`);
  lines.push(`Bracket Name,${analysis.name}`);
  lines.push(`Champion Pick,${analysis.champion.charAt(0).toUpperCase() + analysis.champion.slice(1)}`);
  lines.push(`Current Score,${analysis.currentScore}`);
  lines.push(`Dream Score (all correct),${analysis.dreamScore}`);
  if (analysis.excludeTwinName) {
    lines.push(`Note,"Excludes identical twin bracket (${analysis.excludeTwinName}) — tied on picks; win/lose depends on tiebreaker"`);
  }

  return lines.join('\n');
}

// Run Arizona analysis
console.log('Analyzing Arizona bracket...');
const arizonaAnalysis = await analyzeBracket('guttman 3', 'arizona', 'joseph ammar 2');

// Run Duke analysis
console.log('\nAnalyzing Duke bracket...');
const dukeAnalysis = await analyzeBracket('guttman 2', 'duke', null);

// Write CSVs
fs.writeFileSync('arizona_bracket_needs.csv', generateCSV(arizonaAnalysis));
console.log('\nWrote arizona_bracket_needs.csv');

fs.writeFileSync('duke_bracket_needs.csv', generateCSV(dukeAnalysis));
console.log('Wrote duke_bracket_needs.csv');

// Print summaries
for (const a of [arizonaAnalysis, dukeAnalysis]) {
  console.log(`\n--- ${a.name} (${a.champion}) ---`);
  console.log(`Dream: ${a.dreamScore} | Current: ${a.currentScore}`);
  const must = a.results.filter(r => !r.canAfford);
  const safe = a.results.filter(r => r.canAfford);
  console.log(`MUST WIN: ${must.map(r => `${r.team} (${r.rounds})`).join(', ')}`);
  console.log(`SAFE: ${safe.map(r => `${r.team}`).join(', ')}`);
}
