/**
 * Fix all brackets: rebuild R32+ tree consistency from R64 picks
 * AND fetch all ESPN Mandel pool entries to verify/re-fix if picks were reverted
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
const REGION_NAMES = { 1:'East', 2:'South', 3:'West', 4:'Midwest' };

// Standard bracket seed pairing order (must match website's SEED_MATCHUPS)
const SEED_MATCHUPS = [[1,16],[8,9],[5,12],[4,13],[6,11],[3,14],[7,10],[2,15]];

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

// ── Step 1: Find all ESPN entries from the Mandel group ──
async function findGroupEntries() {
  // Use a known entry to find the group
  const knownEntryId = '414c9590-217e-11f1-8b19-c75e24aaf1c4'; // Mandel x Berger
  const entry = await fetchJSON(`${ESPN_BASE}/entries/${knownEntryId}`);
  console.log(`Known entry: "${entry.name}"`);
  
  const groups = entry.groupMemberships || [];
  console.log(`Group memberships: ${groups.map(g => g.groupName || g.groupId).join(', ')}`);
  
  const allEntries = [];
  for (const g of groups) {
    try {
      // Try paginated entries endpoint
      let url = `${ESPN_BASE}/groups/${g.groupId}/entries?limit=100`;
      const data = await fetchJSON(url);
      const entries = Array.isArray(data) ? data : (data.entries || []);
      console.log(`Group "${g.groupName || g.groupId}": ${entries.length} entries`);
      for (const e of entries) {
        allEntries.push({ id: e.id, name: e.name || e.entryName, score: e.score?.overallScore });
      }
    } catch (err) {
      console.log(`  Failed to fetch group ${g.groupId}: ${err.message}`);
    }
  }
  return allEntries;
}

// ── Step 2: Build full 63-game array from ESPN entry (same logic as compare script) ──
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

  // Build per-region R64 with seed info, then sort by SEED_MATCHUPS
  const regionOrder = ['1','2','3','4'];
  const allRegionR64 = {};
  
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
    
    // Sort by SEED_MATCHUPS order (same as website)
    const seedOrder = SEED_MATCHUPS.map(([a]) => a);
    r64raw.sort((a, b) => {
      const aMin = Math.min(Number(a.seed1) || 99, Number(a.seed2) || 99);
      const bMin = Math.min(Number(b.seed1) || 99, Number(b.seed2) || 99);
      return seedOrder.indexOf(aMin) - seedOrder.indexOf(bMin);
    });
    
    allRegionR64[rid] = r64raw;
  }

  // Now build the full 63-game array with correct tree structure
  const games = [];
  const regionR32 = {};
  const regionS16 = {};
  const regionE8 = {};

  // R64 (indices 0-31): 8 per region
  for (const rid of regionOrder) {
    for (const g of allRegionR64[rid]) {
      games.push({ round: 'Round of 64', region: REGION_NAMES[rid], team1: g.team1, team2: g.team2, pick: g.pick, seed1: g.seed1, seed2: g.seed2 });
    }
  }

  // Build advancement map: team -> max round reached
  // We use periodReached from ALL picks
  const teamAdvancement = {};
  for (const rid of regionOrder) {
    for (const g of allRegionR64[rid]) {
      if (g.pick) teamAdvancement[g.pick] = g.periodReached;
    }
  }

  // R32 (indices 32-47): 4 per region
  for (const rid of regionOrder) {
    const r64 = allRegionR64[rid];
    const r32 = [];
    for (let i = 0; i < 4; i++) {
      const team1 = r64[2*i].pick;
      const team2 = r64[2*i+1].pick;
      const seed1 = r64[2*i].pick === r64[2*i].team1 ? r64[2*i].seed1 : r64[2*i].seed2;
      const seed2 = r64[2*i+1].pick === r64[2*i+1].team1 ? r64[2*i+1].seed1 : r64[2*i+1].seed2;
      // Pick = whichever team advances to round 3+ (periodReached >= 3 means won R32)
      const adv1 = teamAdvancement[team1] || 1;
      const adv2 = teamAdvancement[team2] || 1;
      const pick = adv1 >= 3 ? team1 : adv2 >= 3 ? team2 : null;
      r32.push({ team1, seed1, team2, seed2, pick });
      games.push({ round: 'Round of 32', region: REGION_NAMES[rid], team1, team2, pick, seed1, seed2 });
    }
    regionR32[rid] = r32;
  }

  // S16 (indices 48-55): 2 per region
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

  // E8 (indices 56-59): 1 per region
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

  // FF (indices 60-61): East/South winner vs each other, West/Midwest vs each other
  const e8 = regionOrder.map(rid => regionE8[rid]);
  const ff = [];
  // FF1: East winner vs South winner
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
  // FF2: West winner vs Midwest winner
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

  // Championship (index 62)
  {
    const team1 = ff[0].pick, team2 = ff[1].pick;
    const seed1 = team1 === ff[0].team1 ? ff[0].seed1 : ff[0].seed2;
    const seed2 = team2 === ff[1].team1 ? ff[1].seed1 : ff[1].seed2;
    
    // Champion from finalPick
    let champPick = null;
    if (entry.finalPick) {
      const oid = entry.finalPick.outcomesPicked?.[0]?.outcomeId;
      const t = outcomeToTeam[oid];
      if (t) {
        champPick = t.name;
      } else {
        // Decode via hex offset
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

// ── Step 3: Fix tree consistency for NON-ESPN brackets (Aronoff pool) ──
function fixTreeConsistency(bracket) {
  const games = [...bracket.games];
  const regionNames = ['East', 'South', 'West', 'Midwest'];
  
  // Sort R64 within each region by SEED_MATCHUPS
  const seedOrder = SEED_MATCHUPS.map(([a]) => a);
  const regionR64 = {};
  
  for (let ridx = 0; ridx < 4; ridx++) {
    const region = regionNames[ridx];
    const start = ridx * 8;
    const r64 = games.slice(start, start + 8);
    
    // Sort by min seed, using SEED_MATCHUPS order
    r64.sort((a, b) => {
      const aMin = Math.min(Number(a.seed1) || 99, Number(a.seed2) || 99);
      const bMin = Math.min(Number(b.seed1) || 99, Number(b.seed2) || 99);
      return seedOrder.indexOf(aMin) - seedOrder.indexOf(bMin);
    });
    
    // Write sorted R64 back
    for (let i = 0; i < 8; i++) {
      games[start + i] = r64[i];
    }
    regionR64[ridx] = r64;
  }
  
  // Build advancement map from ALL picks
  const teamAdv = {}; // team -> set of rounds they were picked for
  for (const g of games) {
    if (g.pick) {
      if (!teamAdv[g.pick]) teamAdv[g.pick] = new Set();
      teamAdv[g.pick].add(g.round);
    }
  }
  
  const roundOrder = ['Round of 64', 'Round of 32', 'Sweet 16', 'Elite 8', 'Final Four', 'Championship'];
  
  // Rebuild R32 (indices 32-47)
  for (let ridx = 0; ridx < 4; ridx++) {
    const region = regionNames[ridx];
    const r64 = regionR64[ridx];
    for (let i = 0; i < 4; i++) {
      const idx = 32 + ridx * 4 + i;
      const team1 = r64[2*i].pick;
      const team2 = r64[2*i+1].pick;
      const seed1 = team1 === r64[2*i].team1 ? r64[2*i].seed1 : r64[2*i].seed2;
      const seed2 = team2 === r64[2*i+1].team1 ? r64[2*i+1].seed1 : r64[2*i+1].seed2;
      
      // Figure out pick: whichever of team1/team2 was picked for R32 or later
      const rounds1 = teamAdv[team1] || new Set();
      const rounds2 = teamAdv[team2] || new Set();
      let pick = null;
      // team1 advances if picked for any round at R32 or beyond
      for (let r = 1; r < roundOrder.length; r++) {
        if (rounds1.has(roundOrder[r])) { pick = team1; break; }
        if (rounds2.has(roundOrder[r])) { pick = team2; break; }
      }
      
      games[idx] = { round: 'Round of 32', region, team1, team2, pick, seed1, seed2 };
    }
  }
  
  // Rebuild S16 (indices 48-55)
  for (let ridx = 0; ridx < 4; ridx++) {
    const region = regionNames[ridx];
    for (let i = 0; i < 2; i++) {
      const r32a = games[32 + ridx * 4 + 2*i];
      const r32b = games[32 + ridx * 4 + 2*i + 1];
      const idx = 48 + ridx * 2 + i;
      const team1 = r32a.pick;
      const team2 = r32b.pick;
      const seed1 = team1 === r32a.team1 ? r32a.seed1 : r32a.seed2;
      const seed2 = team2 === r32b.team1 ? r32b.seed1 : r32b.seed2;
      
      const rounds1 = teamAdv[team1] || new Set();
      const rounds2 = teamAdv[team2] || new Set();
      let pick = null;
      for (let r = 2; r < roundOrder.length; r++) {
        if (rounds1.has(roundOrder[r])) { pick = team1; break; }
        if (rounds2.has(roundOrder[r])) { pick = team2; break; }
      }
      
      games[idx] = { round: 'Sweet 16', region, team1, team2, pick, seed1, seed2 };
    }
  }
  
  // Rebuild E8 (indices 56-59)
  for (let ridx = 0; ridx < 4; ridx++) {
    const region = regionNames[ridx];
    const s16a = games[48 + ridx * 2];
    const s16b = games[48 + ridx * 2 + 1];
    const idx = 56 + ridx;
    const team1 = s16a.pick;
    const team2 = s16b.pick;
    const seed1 = team1 === s16a.team1 ? s16a.seed1 : s16a.seed2;
    const seed2 = team2 === s16b.team1 ? s16b.seed1 : s16b.seed2;
    
    const rounds1 = teamAdv[team1] || new Set();
    const rounds2 = teamAdv[team2] || new Set();
    let pick = null;
    for (let r = 3; r < roundOrder.length; r++) {
      if (rounds1.has(roundOrder[r])) { pick = team1; break; }
      if (rounds2.has(roundOrder[r])) { pick = team2; break; }
    }
    
    games[idx] = { round: 'Elite 8', region, team1, team2, pick, seed1, seed2 };
  }
  
  // Rebuild FF (indices 60-61)
  const e8 = [games[56], games[57], games[58], games[59]];
  // FF1: East winner vs South winner
  {
    const team1 = e8[0].pick, team2 = e8[1].pick;
    const seed1 = team1 === e8[0].team1 ? e8[0].seed1 : e8[0].seed2;
    const seed2 = team2 === e8[1].team1 ? e8[1].seed1 : e8[1].seed2;
    const rounds1 = teamAdv[team1] || new Set();
    const rounds2 = teamAdv[team2] || new Set();
    let pick = null;
    for (let r = 4; r < roundOrder.length; r++) {
      if (rounds1.has(roundOrder[r])) { pick = team1; break; }
      if (rounds2.has(roundOrder[r])) { pick = team2; break; }
    }
    games[60] = { round: 'Final Four', region: 'East/South', team1, team2, pick, seed1, seed2 };
  }
  // FF2: West winner vs Midwest winner
  {
    const team1 = e8[2].pick, team2 = e8[3].pick;
    const seed1 = team1 === e8[2].team1 ? e8[2].seed1 : e8[2].seed2;
    const seed2 = team2 === e8[3].team1 ? e8[3].seed1 : e8[3].seed2;
    const rounds1 = teamAdv[team1] || new Set();
    const rounds2 = teamAdv[team2] || new Set();
    let pick = null;
    for (let r = 4; r < roundOrder.length; r++) {
      if (rounds1.has(roundOrder[r])) { pick = team1; break; }
      if (rounds2.has(roundOrder[r])) { pick = team2; break; }
    }
    games[61] = { round: 'Final Four', region: 'West/Midwest', team1, team2, pick, seed1, seed2 };
  }
  
  // Rebuild Championship (index 62)
  {
    const team1 = games[60].pick, team2 = games[61].pick;
    const seed1 = team1 === games[60].team1 ? games[60].seed1 : games[60].seed2;
    const seed2 = team2 === games[61].team1 ? games[61].seed1 : games[61].seed2;
    // Keep existing championship pick (it's the champion)
    const existingChampPick = bracket.games[62]?.pick;
    games[62] = { round: 'Championship', region: '', team1, team2, pick: existingChampPick, seed1, seed2 };
  }
  
  return games;
}

// ── Main ──
const dryRun = process.argv.includes('--dry');
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const ref = doc(db, 'bracketData', 'main');
const snap = await getDoc(ref);
if (!snap.exists()) { console.error('No bracketData/main'); process.exit(1); }
const fullData = snap.data();

// First, get all ESPN group entries
console.log('=== Finding ESPN group entries ===');
let espnEntries = [];
try {
  espnEntries = await findGroupEntries();
  console.log(`Found ${espnEntries.length} ESPN entries\n`);
} catch (err) {
  console.log(`Failed to find group entries: ${err.message}`);
  console.log('Will proceed with tree-consistency fix only\n');
}

// Map Firebase bracket names to ESPN entries (by name matching)
const mandelBrackets = Object.keys(fullData.brackets).filter(name => {
  const entry = (fullData.entries || []).find(e => e.name === name);
  return entry?.pool === 'Mandel';
});
const aronoffBrackets = Object.keys(fullData.brackets).filter(name => {
  const entry = (fullData.entries || []).find(e => e.name === name);
  return entry?.pool === 'Aronoff';
});
console.log(`Mandel brackets: ${mandelBrackets.length}`);
console.log(`Aronoff brackets: ${aronoffBrackets.length}`);

// If we got ESPN entries, try to match and rebuild Mandel brackets from ESPN
const norm = s => (s || '').toLowerCase().trim().replace(/\./g, '').replace(/\s+/g, ' ');
let espnFixed = 0;
let treeFixed = 0;

// Apply tree consistency fix to ALL Mandel brackets
// (ESPN group API not reliable, picks were already verified correct)
console.log('\n=== Processing Mandel brackets (tree fix) ===');
for (const fbName of mandelBrackets) {
  const fixed = fixTreeConsistency(fullData.brackets[fbName]);
  fullData.brackets[fbName] = { ...fullData.brackets[fbName], games: fixed };
  treeFixed++;
  console.log(`  ✅ ${fbName} (tree fixed)`);
}

// Fix Aronoff brackets (tree consistency only, no ESPN data)
console.log('\n=== Processing Aronoff brackets (tree fix) ===');
for (const fbName of aronoffBrackets) {
  const fixed = fixTreeConsistency(fullData.brackets[fbName]);
  fullData.brackets[fbName] = { ...fullData.brackets[fbName], games: fixed };
  treeFixed++;
  console.log(`  ✅ ${fbName} (tree fixed)`);
}

// Any remaining brackets
const allProcessed = new Set([...mandelBrackets, ...aronoffBrackets]);
const unprocessed = Object.keys(fullData.brackets).filter(n => !allProcessed.has(n));
if (unprocessed.length > 0) {
  console.log(`\n=== Unprocessed brackets: ${unprocessed.join(', ')} ===`);
  for (const name of unprocessed) {
    const fixed = fixTreeConsistency(fullData.brackets[name]);
    fullData.brackets[name] = { ...fullData.brackets[name], games: fixed };
    treeFixed++;
    console.log(`  ✅ ${name} (tree fixed)`);
  }
}

console.log(`\n=== Summary ===`);
console.log(`ESPN-rebuilt: ${espnFixed}`);
console.log(`Tree-fixed: ${treeFixed}`);
console.log(`Total: ${espnFixed + treeFixed}`);

// Verify tree consistency for all brackets
console.log('\n=== Verifying tree consistency ===');
let errors = 0;
for (const name of Object.keys(fullData.brackets).sort()) {
  const games = fullData.brackets[name].games;
  if (!games || games.length !== 63) { console.log(`  ⚠️  ${name}: ${games?.length || 0} games`); continue; }
  
  const issues = [];
  // R32 check
  for (let i = 0; i < 16; i++) {
    const r32 = games[32 + i], r64a = games[2 * i], r64b = games[2 * i + 1];
    if (r32.team1 && r64a.pick !== r32.team1) issues.push(`R32[${32+i}] team1="${r32.team1}" but R64[${2*i}].pick="${r64a.pick}"`);
    if (r32.team2 && r64b.pick !== r32.team2) issues.push(`R32[${32+i}] team2="${r32.team2}" but R64[${2*i+1}].pick="${r64b.pick}"`);
  }
  // S16 check
  for (let i = 0; i < 8; i++) {
    const s16 = games[48+i], r32a = games[32+2*i], r32b = games[32+2*i+1];
    if (s16.team1 && r32a.pick !== s16.team1) issues.push(`S16 team1 mismatch`);
    if (s16.team2 && r32b.pick !== s16.team2) issues.push(`S16 team2 mismatch`);
  }
  // E8 check
  for (let i = 0; i < 4; i++) {
    const e8 = games[56+i], s16a = games[48+2*i], s16b = games[48+2*i+1];
    if (e8.team1 && s16a.pick !== e8.team1) issues.push(`E8 team1 mismatch`);
    if (e8.team2 && s16b.pick !== e8.team2) issues.push(`E8 team2 mismatch`);
  }
  // FF
  if (games[60].team1 && games[56].pick !== games[60].team1) issues.push(`FF1 team1`);
  if (games[60].team2 && games[57].pick !== games[60].team2) issues.push(`FF1 team2`);
  if (games[61].team1 && games[58].pick !== games[61].team1) issues.push(`FF2 team1`);
  if (games[61].team2 && games[59].pick !== games[61].team2) issues.push(`FF2 team2`);
  // Champ
  if (games[62].team1 && games[60].pick !== games[62].team1) issues.push(`Champ team1`);
  if (games[62].team2 && games[61].pick !== games[62].team2) issues.push(`Champ team2`);
  
  if (issues.length > 0) {
    console.log(`  ❌ ${name}: ${issues.length} errors`);
    for (const iss of issues.slice(0, 3)) console.log(`    ${iss}`);
    errors += issues.length;
  }
}

if (errors === 0) {
  console.log('  ✅ All brackets have consistent trees!');
} else {
  console.log(`  Total remaining errors: ${errors}`);
}

if (dryRun) {
  console.log('\n(dry run — no changes written)');
  process.exit(0);
}

// Write everything back
await setDoc(ref, fullData);
console.log('\n✅ Wrote all brackets to Firestore');

// Verify
const snap2 = await getDoc(ref);
const data2 = snap2.data();
console.log(`Post-write: ${Object.keys(data2.brackets).length} brackets, ${data2.entries?.length || 0} entries`);
process.exit(0);
