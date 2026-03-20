/**
 * Import ESPN bracket into Firebase
 * Usage: node import-espn.mjs <entryId> <person> <pool>
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

let challengeData = null;
async function buildEspnGames(entryId) {
  if (!challengeData) challengeData = await fetchJSON(ESPN_BASE);
  const entry = await fetchJSON(`${ESPN_BASE}/entries/${entryId}`);

  const outcomeToTeam = {};
  const propToMatchup = {};
  const regionMatchups = {};

  for (const prop of challengeData.propositions || []) {
    const regionId = prop.possibleOutcomes?.[0]?.regionId;
    const info = { propId: prop.id, matchupId: prop.scoringPeriodMatchupId, regionId, outcomes: [] };
    for (const o of prop.possibleOutcomes || []) {
      const mappings = {};
      for (const m of o.mappings || []) mappings[m.type] = m.value;
      outcomeToTeam[o.id] = { name: o.name, seed: mappings.SEED || String(o.regionSeed || ''), regionId: o.regionId };
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

  const regionOrder = ['1','2','3','4'];
  const allRegionR64 = {};
  const seedOrder = SEED_MATCHUPS.map(([a]) => a);

  for (const rid of regionOrder) {
    const matchups = regionMatchups[rid];
    const r64raw = matchups.map(m => {
      const pick = r64Map[m.propId];
      const [oid1, oid2] = m.outcomes;
      const t1 = outcomeToTeam[oid1], t2 = outcomeToTeam[oid2];
      return {
        team1: t1?.name, seed1: t1?.seed, team2: t2?.name, seed2: t2?.seed,
        pick: pick?.team, periodReached: pick?.periodReached || 1,
      };
    });
    r64raw.sort((a, b) => {
      const aMin = Math.min(Number(a.seed1) || 99, Number(a.seed2) || 99);
      const bMin = Math.min(Number(b.seed1) || 99, Number(b.seed2) || 99);
      return seedOrder.indexOf(aMin) - seedOrder.indexOf(bMin);
    });
    allRegionR64[rid] = r64raw;
  }

  const games = [];
  const regionR32 = {};
  const regionS16 = {};
  const regionE8 = {};

  // Build advancement map
  const teamAdvancement = {};
  for (const rid of regionOrder) {
    for (const g of allRegionR64[rid]) {
      if (g.pick) teamAdvancement[g.pick] = g.periodReached;
    }
  }

  // R64 (0-31)
  for (const rid of regionOrder) {
    for (const g of allRegionR64[rid]) {
      games.push({ round: 'Round of 64', region: REGION_NAMES[rid], team1: g.team1, team2: g.team2, pick: g.pick, seed1: g.seed1, seed2: g.seed2 });
    }
  }

  // R32 (32-47)
  for (const rid of regionOrder) {
    const r64 = allRegionR64[rid];
    const r32 = [];
    for (let i = 0; i < 4; i++) {
      const team1 = r64[2*i].pick;
      const team2 = r64[2*i+1].pick;
      const seed1 = team1 === r64[2*i].team1 ? r64[2*i].seed1 : r64[2*i].seed2;
      const seed2 = team2 === r64[2*i+1].team1 ? r64[2*i+1].seed1 : r64[2*i+1].seed2;
      const adv1 = teamAdvancement[team1] || 1;
      const adv2 = teamAdvancement[team2] || 1;
      const pick = adv1 >= 3 ? team1 : adv2 >= 3 ? team2 : null;
      r32.push({ team1, seed1, team2, seed2, pick });
      games.push({ round: 'Round of 32', region: REGION_NAMES[rid], team1, team2, pick, seed1, seed2 });
    }
    regionR32[rid] = r32;
  }

  // S16 (48-55)
  for (const rid of regionOrder) {
    const r32 = regionR32[rid];
    const s16 = [];
    for (let i = 0; i < 2; i++) {
      const team1 = r32[2*i].pick;
      const team2 = r32[2*i+1].pick;
      const seed1 = team1 === r32[2*i].team1 ? r32[2*i].seed1 : r32[2*i].seed2;
      const seed2 = team2 === r32[2*i+1].team1 ? r32[2*i+1].seed1 : r32[2*i+1].seed2;
      const adv1 = teamAdvancement[team1] || 2;
      const adv2 = teamAdvancement[team2] || 2;
      const pick = adv1 >= 4 ? team1 : adv2 >= 4 ? team2 : null;
      s16.push({ team1, seed1, team2, seed2, pick });
      games.push({ round: 'Sweet 16', region: REGION_NAMES[rid], team1, team2, pick, seed1, seed2 });
    }
    regionS16[rid] = s16;
  }

  // E8 (56-59)
  for (const rid of regionOrder) {
    const s16 = regionS16[rid];
    const team1 = s16[0].pick;
    const team2 = s16[1].pick;
    const seed1 = team1 === s16[0].team1 ? s16[0].seed1 : s16[0].seed2;
    const seed2 = team2 === s16[1].team1 ? s16[1].seed1 : s16[1].seed2;
    const adv1 = teamAdvancement[team1] || 3;
    const adv2 = teamAdvancement[team2] || 3;
    const pick = adv1 >= 5 ? team1 : adv2 >= 5 ? team2 : null;
    regionE8[rid] = { team1, seed1, team2, seed2, pick };
    games.push({ round: 'Elite 8', region: REGION_NAMES[rid], team1, team2, pick, seed1, seed2 });
  }

  // FF (60-61)
  const e8 = regionOrder.map(rid => regionE8[rid]);
  const ff = [];
  {
    const team1 = e8[0].pick, team2 = e8[1].pick;
    const seed1 = team1 === e8[0].team1 ? e8[0].seed1 : e8[0].seed2;
    const seed2 = team2 === e8[1].team1 ? e8[1].seed1 : e8[1].seed2;
    const adv1 = teamAdvancement[team1] || 4;
    const adv2 = teamAdvancement[team2] || 4;
    const pick = adv1 >= 6 ? team1 : adv2 >= 6 ? team2 : null;
    ff.push({ team1, seed1, team2, seed2, pick });
    games.push({ round: 'Final Four', region: 'East/South', team1, team2, pick, seed1, seed2 });
  }
  {
    const team1 = e8[2].pick, team2 = e8[3].pick;
    const seed1 = team1 === e8[2].team1 ? e8[2].seed1 : e8[2].seed2;
    const seed2 = team2 === e8[3].team1 ? e8[3].seed1 : e8[3].seed2;
    const adv1 = teamAdvancement[team1] || 4;
    const adv2 = teamAdvancement[team2] || 4;
    const pick = adv1 >= 6 ? team1 : adv2 >= 6 ? team2 : null;
    ff.push({ team1, seed1, team2, seed2, pick });
    games.push({ round: 'Final Four', region: 'West/Midwest', team1, team2, pick, seed1, seed2 });
  }

  // Championship (62)
  {
    const team1 = ff[0].pick, team2 = ff[1].pick;
    const seed1 = team1 === ff[0].team1 ? ff[0].seed1 : ff[0].seed2;
    const seed2 = team2 === ff[1].team1 ? ff[1].seed1 : ff[1].seed2;
    let champPick = null;
    if (entry.finalPick) {
      const oid = entry.finalPick.outcomesPicked?.[0]?.outcomeId;
      const t = outcomeToTeam[oid];
      if (t) {
        champPick = t.name;
      } else {
        const champTeamList = [];
        for (const rid2 of regionOrder) {
          for (const matchup of regionMatchups[rid2]) {
            for (const oid2 of matchup.outcomes) {
              champTeamList.push(outcomeToTeam[oid2]);
            }
          }
        }
        const propHex = parseInt(entry.finalPick.propositionId.split('-')[0], 16);
        const outHex = parseInt(oid.split('-')[0], 16);
        const offset = outHex - propHex;
        const ct = champTeamList[offset - 1];
        if (ct) champPick = ct.name;
      }
    }
    games.push({ round: 'Championship', region: '', team1, team2, pick: champPick, seed1, seed2 });
  }

  return { games, entryName: entry.name, entryId: entry.id };
}

// Verify tree consistency
function verifyTree(games) {
  const issues = [];
  for (let i = 0; i < 16; i++) {
    const r32 = games[32 + i], r64a = games[2 * i], r64b = games[2 * i + 1];
    if (r32.team1 && r64a.pick !== r32.team1) issues.push(`R32[${32+i}] team1="${r32.team1}" != R64[${2*i}].pick="${r64a.pick}"`);
    if (r32.team2 && r64b.pick !== r32.team2) issues.push(`R32[${32+i}] team2="${r32.team2}" != R64[${2*i+1}].pick="${r64b.pick}"`);
  }
  for (let i = 0; i < 8; i++) {
    const s16 = games[48+i], r32a = games[32+2*i], r32b = games[32+2*i+1];
    if (s16.team1 && r32a.pick !== s16.team1) issues.push(`S16[${48+i}] team1 mismatch`);
    if (s16.team2 && r32b.pick !== s16.team2) issues.push(`S16[${48+i}] team2 mismatch`);
  }
  for (let i = 0; i < 4; i++) {
    const e8 = games[56+i], s16a = games[48+2*i], s16b = games[48+2*i+1];
    if (e8.team1 && s16a.pick !== e8.team1) issues.push(`E8 team1 mismatch`);
    if (e8.team2 && s16b.pick !== e8.team2) issues.push(`E8 team2 mismatch`);
  }
  if (games[60].team1 && games[56].pick !== games[60].team1) issues.push(`FF1 team1`);
  if (games[60].team2 && games[57].pick !== games[60].team2) issues.push(`FF1 team2`);
  if (games[61].team1 && games[58].pick !== games[61].team1) issues.push(`FF2 team1`);
  if (games[61].team2 && games[59].pick !== games[61].team2) issues.push(`FF2 team2`);
  if (games[62].team1 && games[60].pick !== games[62].team1) issues.push(`Champ team1`);
  if (games[62].team2 && games[61].pick !== games[62].team2) issues.push(`Champ team2`);
  // Check no null picks
  for (let i = 0; i < 63; i++) {
    if (games[i].pick === null || games[i].pick === undefined) issues.push(`Game ${i} (${games[i].round}) has null pick`);
  }
  return issues;
}

// ── Main ──
const entryId = process.argv[2];
const person = process.argv[3];
const pool = process.argv[4] || 'Mandel';

if (!entryId || !person) {
  console.error('Usage: node import-espn.mjs <entryId> <person> [pool]');
  process.exit(1);
}

console.log(`Fetching ESPN entry ${entryId}...`);
const { games, entryName } = await buildEspnGames(entryId);
console.log(`ESPN name: "${entryName}"`);
console.log(`Games: ${games.length}`);
console.log(`Champion pick: ${games[62]?.pick}`);

const issues = verifyTree(games);
if (issues.length > 0) {
  console.log(`\n⚠️  Tree issues (${issues.length}):`);
  for (const iss of issues) console.log(`  ${iss}`);
} else {
  console.log('✅ Tree consistency verified');
}

// Write to Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const ref = doc(db, 'bracketData', 'main');
const snap = await getDoc(ref);
const fullData = snap.exists() ? snap.data() : { brackets: {}, entries: [], results: {} };

const bracketName = entryName;
fullData.brackets[bracketName] = { games };
const existingEntry = (fullData.entries || []).find(e => e.name === bracketName);
if (!existingEntry) {
  fullData.entries = [...(fullData.entries || []), { name: bracketName, person, pool, muted: false, filename: `espn_${entryId}` }];
} else {
  fullData.entries = fullData.entries.map(e => e.name === bracketName ? { ...e, person, pool } : e);
}

await setDoc(ref, fullData);
console.log(`\n✅ Imported "${bracketName}" for ${person} (${pool}) into Firebase`);
console.log(`Total brackets: ${Object.keys(fullData.brackets).length}`);
process.exit(0);
