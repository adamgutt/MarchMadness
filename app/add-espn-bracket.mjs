/**
 * Import ESPN bracket into Firebase
 * 
 * Usage:
 *   node add-espn-bracket.mjs <entryId> <person> <pool>
 *   node add-espn-bracket.mjs <entryId> <person> <pool> --dry
 * 
 * Example:
 *   node add-espn-bracket.mjs 35a5a4c0-217e-11f1-9e34-991f2faac692 Avi Mandel
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyAKbyio_RFQqltmQaVqgSoSFKMIfRKFWVE',
  authDomain: 'march-madness-7d2f6.firebaseapp.com',
  projectId: 'march-madness-7d2f6',
  storageBucket: 'march-madness-7d2f6.firebasestorage.app',
  messagingSenderId: '478554246498',
  appId: '1:478554246498:web:ceaa8a22a8892342a0ef1c',
};

const ESPN_BASE = 'https://gambit-api.fantasy.espn.com/apis/v1/challenges/tournament-challenge-bracket-2026';
const REGION_NAMES = { 1: 'East', 2: 'South', 3: 'West', 4: 'Midwest' };
const SEED_MATCHUPS = [[1,16],[8,9],[5,12],[4,13],[6,11],[3,14],[7,10],[2,15]];

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

// Cache challenge data across calls
let challengeData = null;
async function getChallenge() {
  if (!challengeData) challengeData = await fetchJSON(ESPN_BASE);
  return challengeData;
}

async function buildEspnGames(entryId) {
  const challenge = await getChallenge();
  const entry = await fetchJSON(`${ESPN_BASE}/entries/${entryId}`);

  const outcomeToTeam = {};
  const propToMatchup = {};
  const regionMatchups = {};

  for (const prop of challenge.propositions || []) {
    const regionId = prop.possibleOutcomes?.[0]?.regionId;
    const info = { propId: prop.id, matchupId: prop.scoringPeriodMatchupId, regionId, outcomes: [] };
    for (const o of prop.possibleOutcomes || []) {
      const mappings = {};
      for (const m of o.mappings || []) mappings[m.type] = m.value;
      outcomeToTeam[o.id] = {
        name: o.name, seed: mappings.SEED || String(o.regionSeed || ''),
        regionId: o.regionId,
      };
      info.outcomes.push(o.id);
    }
    propToMatchup[prop.id] = info;
    if (!regionMatchups[regionId]) regionMatchups[regionId] = [];
    regionMatchups[regionId].push(info);
  }
  for (const rid of Object.keys(regionMatchups))
    regionMatchups[rid].sort((a, b) => a.matchupId - b.matchupId);

  // Extract picks with periodReached
  const r64Map = {};
  for (const pick of entry.picks || []) {
    if (!propToMatchup[pick.propositionId]) continue;
    const oid = pick.outcomesPicked?.[0]?.outcomeId;
    const team = outcomeToTeam[oid];
    r64Map[pick.propositionId] = {
      team: team?.name || '???', seed: team?.seed || '?',
      regionId: team?.regionId, periodReached: pick.periodReached,
    };
  }

  const regionIds = Object.keys(regionMatchups).sort((a, b) => a - b);
  const allRegionData = {};

  for (const rid of regionIds) {
    const matchups = regionMatchups[rid];

    // Build R64 with seed-matchup sorting
    const r64raw = matchups.map(m => {
      const pick = r64Map[m.propId];
      const [oid1, oid2] = m.outcomes;
      const t1 = outcomeToTeam[oid1], t2 = outcomeToTeam[oid2];
      return {
        team1: t1?.name, seed1: t1?.seed, team2: t2?.name, seed2: t2?.seed,
        pick: pick?.team, periodReached: pick?.periodReached || 1,
        propId: m.propId,
      };
    });

    // Sort by SEED_MATCHUPS order (same as website)
    const seedOrder = SEED_MATCHUPS.map(([a]) => a);
    r64raw.sort((a, b) => {
      const aMin = Math.min(Number(a.seed1) || 99, Number(a.seed2) || 99);
      const bMin = Math.min(Number(b.seed1) || 99, Number(b.seed2) || 99);
      return seedOrder.indexOf(aMin) - seedOrder.indexOf(bMin);
    });

    const r64 = r64raw;

    // R32: pair adjacent R64 winners
    const r32 = [];
    for (let i = 0; i < 4; i++) {
      const a = r64[2 * i], b = r64[2 * i + 1];
      const t1 = a.pick, t2 = b.pick;
      const s1 = a.pick === a.team1 ? a.seed1 : a.seed2;
      const s2 = b.pick === b.team1 ? b.seed1 : b.seed2;
      // periodReached >= 3 means picked to win R32
      const pick = a.periodReached >= 3 ? t1 : b.periodReached >= 3 ? t2 : null;
      const pr = a.periodReached >= 3 ? a.periodReached : b.periodReached >= 3 ? b.periodReached : 2;
      r32.push({ team1: t1, seed1: s1, team2: t2, seed2: s2, pick, periodReached: pr });
    }

    // S16: pair adjacent R32 winners
    const s16 = [];
    for (let i = 0; i < 2; i++) {
      const a = r32[2 * i], b = r32[2 * i + 1];
      const t1 = a.pick, t2 = b.pick;
      const s1 = t1 === a.team1 ? a.seed1 : a.seed2;
      const s2 = t2 === b.team1 ? b.seed1 : b.seed2;
      const pick = a.periodReached >= 4 ? t1 : b.periodReached >= 4 ? t2 : null;
      const pr = a.periodReached >= 4 ? a.periodReached : b.periodReached >= 4 ? b.periodReached : 3;
      s16.push({ team1: t1, seed1: s1, team2: t2, seed2: s2, pick, periodReached: pr });
    }

    // E8
    const e8t1 = s16[0].pick, e8t2 = s16[1].pick;
    const e8s1 = e8t1 === s16[0].team1 ? s16[0].seed1 : s16[0].seed2;
    const e8s2 = e8t2 === s16[1].team1 ? s16[1].seed1 : s16[1].seed2;
    const e8pick = s16[0].periodReached >= 5 ? e8t1 : s16[1].periodReached >= 5 ? e8t2 : null;
    const e8pr = s16[0].periodReached >= 5 ? s16[0].periodReached : s16[1].periodReached >= 5 ? s16[1].periodReached : 4;

    allRegionData[rid] = {
      r64, r32, s16,
      e8: { team1: e8t1, seed1: e8s1, team2: e8t2, seed2: e8s2, pick: e8pick, periodReached: e8pr },
    };
  }

  // Build 63-game array
  const games = [];
  const regionOrder = ['1', '2', '3', '4'];

  // R64 (0-31)
  for (const rid of regionOrder)
    for (const g of allRegionData[rid].r64)
      games.push({ round: 'Round of 64', region: REGION_NAMES[rid], team1: g.team1, team2: g.team2, pick: g.pick, seed1: g.seed1, seed2: g.seed2 });

  // R32 (32-47)
  for (const rid of regionOrder)
    for (const g of allRegionData[rid].r32)
      games.push({ round: 'Round of 32', region: REGION_NAMES[rid], team1: g.team1, team2: g.team2, pick: g.pick, seed1: g.seed1, seed2: g.seed2 });

  // S16 (48-55)
  for (const rid of regionOrder)
    for (const g of allRegionData[rid].s16)
      games.push({ round: 'Sweet 16', region: REGION_NAMES[rid], team1: g.team1, team2: g.team2, pick: g.pick, seed1: g.seed1, seed2: g.seed2 });

  // E8 (56-59)
  for (const rid of regionOrder) {
    const g = allRegionData[rid].e8;
    games.push({ round: 'Elite 8', region: REGION_NAMES[rid], team1: g.team1, team2: g.team2, pick: g.pick, seed1: g.seed1, seed2: g.seed2 });
  }

  // FF (60-61)
  const e8 = regionOrder.map(rid => allRegionData[rid].e8);
  const ff = [];
  // FF1: East winner vs South winner
  {
    const t1 = e8[0].pick, t2 = e8[1].pick;
    const s1 = t1 === e8[0].team1 ? e8[0].seed1 : e8[0].seed2;
    const s2 = t2 === e8[1].team1 ? e8[1].seed1 : e8[1].seed2;
    const pick = e8[0].periodReached >= 6 ? t1 : e8[1].periodReached >= 6 ? t2 : null;
    ff.push({ team1: t1, team2: t2, seed1: s1, seed2: s2, pick });
    games.push({ round: 'Final Four', region: 'East/South', team1: t1, team2: t2, pick, seed1: s1, seed2: s2 });
  }
  // FF2: West winner vs Midwest winner
  {
    const t1 = e8[2].pick, t2 = e8[3].pick;
    const s1 = t1 === e8[2].team1 ? e8[2].seed1 : e8[2].seed2;
    const s2 = t2 === e8[3].team1 ? e8[3].seed1 : e8[3].seed2;
    const pick = e8[2].periodReached >= 6 ? t1 : e8[3].periodReached >= 6 ? t2 : null;
    ff.push({ team1: t1, team2: t2, seed1: s1, seed2: s2, pick });
    games.push({ round: 'Final Four', region: 'West/Midwest', team1: t1, team2: t2, pick, seed1: s1, seed2: s2 });
  }

  // Championship (62) — champion from finalPick
  let champPick = null;
  if (entry.finalPick) {
    const oid = entry.finalPick.outcomesPicked?.[0]?.outcomeId;
    const t = outcomeToTeam[oid];
    if (t) {
      champPick = t.name;
    } else {
      // Decode via hex offset
      const champTeamList = [];
      for (const rid of regionOrder)
        for (const matchup of regionMatchups[rid])
          for (const oid2 of matchup.outcomes)
            champTeamList.push(outcomeToTeam[oid2]);
      const propHex = parseInt(entry.finalPick.propositionId.split('-')[0], 16);
      const outHex = parseInt(oid.split('-')[0], 16);
      const offset = outHex - propHex;
      const ct = champTeamList[offset - 1];
      if (ct) champPick = ct.name;
    }
  }
  const champT1 = ff[0].pick, champT2 = ff[1].pick;
  const champS1 = champT1 === ff[0].team1 ? ff[0].seed1 : champT1 === ff[0].team2 ? ff[0].seed2 : '';
  const champS2 = champT2 === ff[1].team1 ? ff[1].seed1 : champT2 === ff[1].team2 ? ff[1].seed2 : '';
  games.push({ round: 'Championship', region: '', team1: champT1, team2: champT2, pick: champPick, seed1: champS1, seed2: champS2 });

  return { games, entryName: entry.name, entryId: entry.id, score: entry.score?.overallScore };
}

// Verify tree consistency
function verifyTree(games) {
  const issues = [];
  // R32 check
  for (let i = 0; i < 16; i++) {
    const r32 = games[32 + i], r64a = games[2 * i], r64b = games[2 * i + 1];
    if (r32.team1 && r64a.pick !== r32.team1) issues.push(`R32[${32+i}] team1="${r32.team1}" ≠ R64[${2*i}].pick="${r64a.pick}"`);
    if (r32.team2 && r64b.pick !== r32.team2) issues.push(`R32[${32+i}] team2="${r32.team2}" ≠ R64[${2*i+1}].pick="${r64b.pick}"`);
  }
  // S16 check
  for (let i = 0; i < 8; i++) {
    const s16 = games[48 + i], r32a = games[32 + 2 * i], r32b = games[32 + 2 * i + 1];
    if (s16.team1 && r32a.pick !== s16.team1) issues.push(`S16[${48+i}] team1="${s16.team1}" ≠ R32[${32+2*i}].pick="${r32a.pick}"`);
    if (s16.team2 && r32b.pick !== s16.team2) issues.push(`S16[${48+i}] team2="${s16.team2}" ≠ R32[${32+2*i+1}].pick="${r32b.pick}"`);
  }
  // E8 check
  for (let i = 0; i < 4; i++) {
    const e8 = games[56 + i], s16a = games[48 + 2 * i], s16b = games[48 + 2 * i + 1];
    if (e8.team1 && s16a.pick !== e8.team1) issues.push(`E8[${56+i}] team1 mismatch`);
    if (e8.team2 && s16b.pick !== e8.team2) issues.push(`E8[${56+i}] team2 mismatch`);
  }
  // FF
  if (games[60].team1 && games[56].pick !== games[60].team1) issues.push(`FF1 team1 mismatch`);
  if (games[60].team2 && games[57].pick !== games[60].team2) issues.push(`FF1 team2 mismatch`);
  if (games[61].team1 && games[58].pick !== games[61].team1) issues.push(`FF2 team1 mismatch`);
  if (games[61].team2 && games[59].pick !== games[61].team2) issues.push(`FF2 team2 mismatch`);
  // Champ
  if (games[62].team1 && games[60].pick !== games[62].team1) issues.push(`Champ team1 mismatch`);
  if (games[62].team2 && games[61].pick !== games[62].team2) issues.push(`Champ team2 mismatch`);
  return issues;
}

// ── Main ──
const args = process.argv.slice(2).filter(a => a !== '--dry');
const dryRun = process.argv.includes('--dry');

if (args.length < 3) {
  console.log('Usage: node add-espn-bracket.mjs <entryId> <person> <pool> [--dry]');
  process.exit(1);
}

const [entryId, person, pool] = args;

console.log(`Fetching ESPN entry ${entryId}...`);
const { games, entryName, score } = await buildEspnGames(entryId);
const bracketName = entryName;

console.log(`  ESPN name: "${entryName}"`);
console.log(`  Person: ${person}`);
console.log(`  Pool: ${pool}`);
console.log(`  Score: ${score}`);
console.log(`  Games: ${games.length}`);
console.log(`  Champion: ${games[62]?.pick || 'none'}`);

// Check null picks
const nullPicks = games.filter(g => g.pick === null);
if (nullPicks.length > 0) {
  console.log(`  ⚠️  ${nullPicks.length} null picks (expected for undecided future rounds)`);
}

// Verify tree consistency
const issues = verifyTree(games);
if (issues.length > 0) {
  console.log(`  ❌ ${issues.length} tree consistency errors:`);
  for (const iss of issues) console.log(`    ${iss}`);
  process.exit(1);
} else {
  console.log(`  ✅ Tree consistent`);
}

// Print bracket summary
console.log('\n  R64 picks:');
for (let i = 0; i < 32; i++) {
  const g = games[i];
  console.log(`    [${i}] ${g.region}: (${g.seed1})${g.team1} vs (${g.seed2})${g.team2} → ${g.pick}`);
}
console.log('  Championship:', games[62].team1, 'vs', games[62].team2, '→', games[62].pick);

if (dryRun) {
  console.log('\n(dry run — not written to Firebase)');
  process.exit(0);
}

// Write to Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const ref = doc(db, 'bracketData', 'main');
const snap = await getDoc(ref);
const data = snap.exists() ? snap.data() : { brackets: {}, entries: [], results: {} };

data.brackets[bracketName] = { games };
// Remove any existing entry with same name, then add
data.entries = (data.entries || []).filter(e => e.name !== bracketName);
data.entries.push({ name: bracketName, person, pool, muted: false, filename: `espn_${entryId}` });

await setDoc(ref, data);
console.log(`\n✅ Wrote "${bracketName}" to Firebase (${Object.keys(data.brackets).length} total brackets)`);
process.exit(0);
