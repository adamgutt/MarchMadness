// Cross-reference Mandel brackets in brackets_final_v2 with scenario_data picks
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';

const envFile = readFileSync('app/.env', 'utf8');
const env = {};
for (const line of envFile.split('\n')) {
  const m = line.match(/^(\w+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

const app = initializeApp({
  apiKey: env.VITE_FB_API_KEY,
  authDomain: env.VITE_FB_AUTH_DOMAIN,
  projectId: env.VITE_FB_PROJECT_ID,
});
const db = getFirestore(app);

// Load brackets_final_v2
const v2Snap = await getDoc(doc(db, 'brackets_final_v2', 'main'));
const v2Data = v2Snap.data();
const v2Entries = v2Data.entries; // BracketEntry[]
const v2Brackets = v2Data.brackets; // { [name]: { games: [...] } }

console.log(`=== brackets_final_v2 ===`);
console.log(`Entries: ${v2Entries.length}`);
console.log(`Bracket names: ${Object.keys(v2Brackets).length}`);

// Filter to Mandel pool only
const mandelEntries = v2Entries.filter(e => e.pool === 'Mandel');
console.log(`Mandel entries: ${mandelEntries.length}`);
console.log('');

// Load scenario_data
const [tournamentSnap, metaSnap] = await Promise.all([
  getDoc(doc(db, 'scenario_data', 'tournament')),
  getDoc(doc(db, 'scenario_data', 'meta')),
]);
const games = tournamentSnap.data().games;
const totalBatches = metaSnap.data().totalBatches;

// Build outcome name map: outcomeId -> teamName
const outcomeNames = {};
for (const g of games) {
  for (const o of g.outcomes) outcomeNames[o.id] = o.name;
}

// Load all scenario picks
const allBrackets = [];
for (let i = 0; i < totalBatches; i++) {
  const snap = await getDoc(doc(db, 'scenario_data', `picks_${i}`));
  if (snap.exists()) allBrackets.push(...snap.data().brackets);
}
console.log(`=== scenario_data ===`);
console.log(`Total brackets: ${allBrackets.length}`);
console.log(`Total games: ${games.length}`);
console.log('');

// Build propId -> { period, round, regionIdx, position } lookup
const gameInfo = {};
for (const g of games) {
  gameInfo[g.propId] = { period: g.period, round: g.round, region: g.region, position: g.position };
}

// Cross-reference each Mandel bracket
const POINTS = { 1: 10, 2: 20, 3: 40, 4: 80, 5: 160, 6: 320 };
const roundToPeriod = { 'Round of 64': 1, 'Round of 32': 2, 'Sweet 16': 3, 'Elite 8': 4, 'Final Four': 5, 'Championship': 6 };

let allMatch = true;

for (const entry of mandelEntries) {
  const v2Bracket = v2Brackets[entry.name];
  if (!v2Bracket) {
    console.log(`❌ ${entry.name}: NOT FOUND in v2 brackets`);
    allMatch = false;
    continue;
  }

  // Find in scenario_data
  const scenarioBracket = allBrackets.find(b => b.name.toLowerCase().trim() === entry.name.toLowerCase().trim());
  if (!scenarioBracket) {
    console.log(`❌ ${entry.name}: NOT FOUND in scenario_data`);
    allMatch = false;
    continue;
  }

  // Compare: v2 bracket has games[] with { round, team1, team2, pick, region }
  // scenario bracket has picks: { propId: outcomeId }
  const v2Games = v2Bracket.games;
  const scenPicks = scenarioBracket.picks;

  // Build v2 picks by round+region+teams -> picked team
  const v2Picks = {};
  for (const g of v2Games) {
    const key = `${g.round}|${g.region}|${g.team1}|${g.team2}`;
    v2Picks[key] = g.pick;
  }

  // Build scenario picks by propId -> team name
  const scenPickNames = {};
  let scenPickCount = 0;
  for (const [propId, oid] of Object.entries(scenPicks)) {
    scenPickNames[propId] = outcomeNames[oid] || 'Unknown';
    scenPickCount++;
  }

  // Compare concluded games only (where we can verify)
  let matches = 0, mismatches = 0, skipped = 0;
  const mismatchDetails = [];

  for (const g of games) {
    const scenTeam = scenPickNames[g.propId];
    if (!scenTeam) { skipped++; continue; }

    // Try to find matching v2 game
    // v2 games use round names like "Round of 64", scenario uses "R64"
    const roundMap = { 'R64': 'Round of 64', 'R32': 'Round of 32', 'S16': 'Sweet 16', 'E8': 'Elite 8', 'F4': 'Final Four', 'Championship': 'Championship' };
    const v2Round = roundMap[g.round] || g.round;

    // Find v2 game by matching the team name in the pick
    let foundV2 = false;
    for (const vg of v2Games) {
      if (vg.round !== v2Round) continue;
      // Check if this scenario game could match: the picked team should be one of the outcomes
      const scenOutcomeNames = g.outcomes.map(o => o.name.toLowerCase().trim());
      const v2Team1 = vg.team1?.toLowerCase().trim();
      const v2Team2 = vg.team2?.toLowerCase().trim();

      // Only match if both v2 teams appear in the scenario game outcomes
      if (scenOutcomeNames.includes(v2Team1) && scenOutcomeNames.includes(v2Team2)) {
        foundV2 = true;
        const v2Pick = vg.pick?.toLowerCase().trim();
        const scenPick = scenTeam.toLowerCase().trim();
        if (v2Pick === scenPick) {
          matches++;
        } else {
          mismatches++;
          mismatchDetails.push(`  ${g.round} ${g.region}: v2="${vg.pick}" vs scen="${scenTeam}"`);
        }
        break;
      }
    }
    if (!foundV2) skipped++;
  }

  const status = mismatches === 0 ? '✅' : '❌';
  console.log(`${status} ${entry.person} — ${entry.name}: ${matches} match, ${mismatches} mismatch, ${skipped} skipped (v2 games: ${v2Games.length}, scen picks: ${scenPickCount})`);
  if (mismatchDetails.length > 0) {
    for (const d of mismatchDetails) console.log(d);
    allMatch = false;
  }
}

console.log('');
if (allMatch) {
  console.log('🎉 ALL Mandel brackets match between v2 and scenario_data!');
} else {
  console.log('⚠️  Some mismatches found — see above');
}

process.exit(0);
