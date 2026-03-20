/**
 * Compare ESPN bracket to Firebase "Yitzy Berger 2" bracket
 *
 * Usage:
 *   node compare-espn-firebase.mjs --dry     — show diffs only
 *   node compare-espn-firebase.mjs            — apply fixes to Firebase
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc } from 'firebase/firestore';

const BRACKET_NAME = 'Mandel x Berger';

const firebaseConfig = {
  apiKey: 'AIzaSyAKbyio_RFQqltmQaVqgSoSFKMIfRKFWVE',
  authDomain: 'march-madness-7d2f6.firebaseapp.com',
  projectId: 'march-madness-7d2f6',
  storageBucket: 'march-madness-7d2f6.firebasestorage.app',
  messagingSenderId: '478554246498',
  appId: '1:478554246498:web:ceaa8a22a8892342a0ef1c',
};

const ESPN_YEAR = 2026;
const ESPN_BASE = `https://gambit-api.fantasy.espn.com/apis/v1/challenges/tournament-challenge-bracket-${ESPN_YEAR}`;
const ESPN_ENTRY_ID = '414c9590-217e-11f1-8b19-c75e24aaf1c4';

const ROUND_NAMES = { 1:'Round of 64', 2:'Round of 32', 3:'Sweet 16', 4:'Elite 8', 5:'Final Four', 6:'Championship' };
const REGION_NAMES = { 1:'East', 2:'South', 3:'West', 4:'Midwest' };

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

// ── Build ESPN bracket as 63-game array matching Firebase format ──
async function buildEspnGames() {
  const challenge = await fetchJSON(ESPN_BASE);
  const entry = await fetchJSON(`${ESPN_BASE}/entries/${ESPN_ENTRY_ID}`);

  // Build outcome→team and prop→matchup maps
  const outcomeToTeam = {};
  const propToMatchup = {};
  const regionMatchups = {}; // regionId → [matchups] in bracket order

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

  // Extract R64 picks
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

  // Build per-region bracket tree
  const regionIds = Object.keys(regionMatchups).sort((a,b) => a - b);
  const allRegionData = {};

  for (const rid of regionIds) {
    const matchups = regionMatchups[rid];
    const r64 = matchups.map(m => {
      const pick = r64Map[m.propId];
      // Also need the 2 teams for each matchup
      const [oid1, oid2] = m.outcomes;
      const t1 = outcomeToTeam[oid1], t2 = outcomeToTeam[oid2];
      return {
        team1: t1?.name, seed1: t1?.seed, team2: t2?.name, seed2: t2?.seed,
        pick: pick?.team, periodReached: pick?.periodReached || 1,
      };
    });

    // R32
    const r32 = [];
    for (let i = 0; i < 4; i++) {
      const a = r64[2*i], b = r64[2*i+1];
      const aWin = r64Map[matchups[2*i].propId];
      const bWin = r64Map[matchups[2*i+1].propId];
      const t1 = aWin?.team, t2 = bWin?.team;
      const s1 = aWin?.seed, s2 = bWin?.seed;
      const winner = aWin?.periodReached >= 3 ? aWin : bWin?.periodReached >= 3 ? bWin : null;
      r32.push({ team1: t1, seed1: s1, team2: t2, seed2: s2, pick: winner?.team || null, periodReached: winner?.periodReached || 2 });
    }

    // S16
    const s16 = [];
    for (let i = 0; i < 2; i++) {
      const t1 = r32[2*i].pick, t2 = r32[2*i+1].pick;
      const s1 = r32[2*i].pick === r32[2*i].team1 ? r32[2*i].seed1 : r32[2*i].seed2;
      const s2 = r32[2*i+1].pick === r32[2*i+1].team1 ? r32[2*i+1].seed1 : r32[2*i+1].seed2;
      const a = r32[2*i], b = r32[2*i+1];
      const winner = a.periodReached >= 4 ? a : b.periodReached >= 4 ? b : null;
      s16.push({ team1: t1, seed1: s1, team2: t2, seed2: s2, pick: winner?.pick || null, periodReached: winner?.periodReached || 3 });
    }

    // E8
    const e8t1 = s16[0].pick, e8t2 = s16[1].pick;
    const e8s1 = s16[0].pick === s16[0].team1 ? s16[0].seed1 : s16[0].seed2;
    const e8s2 = s16[1].pick === s16[1].team1 ? s16[1].seed1 : s16[1].seed2;
    const e8a = s16[0], e8b = s16[1];
    const e8winner = e8a.periodReached >= 5 ? e8a : e8b.periodReached >= 5 ? e8b : null;

    allRegionData[rid] = { r64, r32, s16, e8: { team1: e8t1, seed1: e8s1, team2: e8t2, seed2: e8s2, pick: e8winner?.pick || null, periodReached: e8winner?.periodReached || 4 } };
  }

  // Build 63-game array in Firebase order:
  // [0-31] R64 (8 per region × 4 regions, order: East, South, West, Midwest)
  // [32-47] R32 (4 per region × 4)
  // [48-55] S16 (2 per region × 4)
  // [56-59] E8 (1 per region × 4)
  // [60-61] FF (2 games)
  // [62] Championship
  const games = [];
  const regionOrder = ['1','2','3','4']; // East, South, West, Midwest

  // R64
  for (const rid of regionOrder) {
    for (const g of allRegionData[rid].r64) {
      games.push({ round: 'Round of 64', region: REGION_NAMES[rid], team1: g.team1, team2: g.team2, pick: g.pick, seed1: g.seed1, seed2: g.seed2 });
    }
  }

  // R32
  for (const rid of regionOrder) {
    for (const g of allRegionData[rid].r32) {
      games.push({ round: 'Round of 32', region: REGION_NAMES[rid], team1: g.team1, team2: g.team2, pick: g.pick, seed1: g.seed1, seed2: g.seed2 });
    }
  }

  // S16
  for (const rid of regionOrder) {
    for (const g of allRegionData[rid].s16) {
      games.push({ round: 'Sweet 16', region: REGION_NAMES[rid], team1: g.team1, team2: g.team2, pick: g.pick, seed1: g.seed1, seed2: g.seed2 });
    }
  }

  // E8
  for (const rid of regionOrder) {
    const g = allRegionData[rid].e8;
    games.push({ round: 'Elite 8', region: REGION_NAMES[rid], team1: g.team1, team2: g.team2, pick: g.pick, seed1: g.seed1, seed2: g.seed2 });
  }

  // FF: East/South winner vs West/Midwest winner... well, standard pairing: region1v2, region3v4
  const e8Winners = regionOrder.map(rid => allRegionData[rid].e8);
  const ff1t1 = e8Winners[0].pick, ff1t2 = e8Winners[1].pick;
  const ff1s1 = e8Winners[0].pick === e8Winners[0].team1 ? e8Winners[0].seed1 : e8Winners[0].seed2;
  const ff1s2 = e8Winners[1].pick === e8Winners[1].team1 ? e8Winners[1].seed1 : e8Winners[1].seed2;
  const ff1winner = e8Winners[0].periodReached >= 6 ? e8Winners[0].pick : e8Winners[1].periodReached >= 6 ? e8Winners[1].pick : null;

  const ff2t1 = e8Winners[2].pick, ff2t2 = e8Winners[3].pick;
  const ff2s1 = e8Winners[2].pick === e8Winners[2].team1 ? e8Winners[2].seed1 : e8Winners[2].seed2;
  const ff2s2 = e8Winners[3].pick === e8Winners[3].team1 ? e8Winners[3].seed1 : e8Winners[3].seed2;
  const ff2winner = e8Winners[2].periodReached >= 6 ? e8Winners[2].pick : e8Winners[3].periodReached >= 6 ? e8Winners[3].pick : null;

  games.push({ round: 'Final Four', region: 'East/South', team1: ff1t1, team2: ff1t2, pick: ff1winner, seed1: ff1s1, seed2: ff1s2 });
  games.push({ round: 'Final Four', region: 'West/Midwest', team1: ff2t1, team2: ff2t2, pick: ff2winner, seed1: ff2s1, seed2: ff2s2 });

  // Championship
  const champT1 = ff1winner, champT2 = ff2winner;
  // Champion from finalPick — build 64-team map from R64 proposition order
  const champTeamList = [];
  for (const rid of regionOrder) {
    for (const matchup of regionMatchups[rid]) {
      for (const oid of matchup.outcomes) {
        champTeamList.push(outcomeToTeam[oid]);
      }
    }
  }
  let champPick = null;
  if (entry.finalPick) {
    const oid = entry.finalPick.outcomesPicked?.[0]?.outcomeId;
    const t = outcomeToTeam[oid];
    if (t) champPick = t.name;
    else {
      const propHex = parseInt(entry.finalPick.propositionId.split('-')[0], 16);
      const outHex = parseInt(oid.split('-')[0], 16);
      const offset = outHex - propHex; // 1-indexed into champTeamList
      const ct = champTeamList[offset - 1];
      if (ct) champPick = ct.name;
    }
  }
  const champS1 = ff1winner === ff1t1 ? ff1s1 : ff1winner === ff1t2 ? ff1s2 : '';
  const champS2 = ff2winner === ff2t1 ? ff2s1 : ff2winner === ff2t2 ? ff2s2 : '';

  games.push({ round: 'Championship', region: '', team1: champT1, team2: champT2, pick: champPick, seed1: champS1, seed2: champS2 });

  return { games, entry };
}

// ── Main ──
const dryRun = process.argv.includes('--dry');

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const ref = doc(db, 'bracketData', 'main');

const snap = await getDoc(ref);
if (!snap.exists()) { console.error('No bracketData/main'); process.exit(1); }
const fbData = snap.data();
const fbBracket = fbData.brackets?.[BRACKET_NAME];
if (!fbBracket) { console.error(`Bracket "${BRACKET_NAME}" not found in Firebase`); process.exit(1); }
const fbGames = fbBracket.games;
console.log(`Firebase: "${BRACKET_NAME}" has ${fbGames.length} games`);

const { games: espnGames, entry: espnEntry } = await buildEspnGames();
console.log(`ESPN: "${espnEntry.name}" has ${espnGames.length} games, score=${espnEntry.score?.overallScore}\n`);

// Compare position by position
const norm = s => (s || '').toLowerCase().trim().replace(/\./g, '').replace(/\s+/g, ' ');
const teamEq = (a, b) => {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const na = norm(a), nb = norm(b);
  if (na === nb) return true;
  // Common aliases
  const aliases = { 'connecticut':'uconn', 'central florida':'ucf', 'mcneese state':'mcneese', 'n dakota st':'n dakota st', "saint mary's":"saint mary's", "st john's":"st john's", "hawai'i":"hawai'i", "ca baptist":"ca baptist" };
  return (aliases[na] || na) === (aliases[nb] || nb);
};

let diffs = 0;
for (let i = 0; i < 63; i++) {
  const fb = fbGames[i] || {};
  const espn = espnGames[i] || {};
  const fields = [];

  if (!teamEq(fb.team1, espn.team1)) fields.push(`team1: "${fb.team1}" → "${espn.team1}"`);
  if (!teamEq(fb.team2, espn.team2)) fields.push(`team2: "${fb.team2}" → "${espn.team2}"`);
  if (!teamEq(fb.pick, espn.pick)) fields.push(`pick: "${fb.pick}" → "${espn.pick}"`);
  if (fb.seed1 !== espn.seed1) fields.push(`seed1: "${fb.seed1}" → "${espn.seed1}"`);
  if (fb.seed2 !== espn.seed2) fields.push(`seed2: "${fb.seed2}" → "${espn.seed2}"`);

  if (fields.length) {
    diffs++;
    console.log(`[${i}] ${espn.round} ${espn.region || ''}: ${fields.join(', ')}`);
  }
}

console.log(`\nTotal diffs: ${diffs}`);

if (diffs === 0) {
  console.log('✅ All 63 games match!');
  process.exit(0);
}

if (dryRun) {
  console.log('\n(dry run — no changes applied)');
  process.exit(0);
}

// Apply: rebuild full bracket using ESPN games, preserving pool and other metadata
const newBracket = { ...fbBracket, games: espnGames };

// Read full doc, modify, write back (avoids dot-notation issues with spaces in bracket names)
const fullData = snap.data();
fullData.brackets[BRACKET_NAME] = newBracket;
const { setDoc } = await import('firebase/firestore');
await setDoc(ref, fullData);
console.log(`\n✅ Wrote full 63-game array for "${BRACKET_NAME}"`);

// Verify
const snap2 = await getDoc(ref);
const fb2 = snap2.data().brackets[BRACKET_NAME].games;
let matches = 0;
for (let i = 0; i < 63; i++) {
  if (teamEq(fb2[i]?.pick, espnGames[i]?.pick) && teamEq(fb2[i]?.team1, espnGames[i]?.team1) && teamEq(fb2[i]?.team2, espnGames[i]?.team2)) matches++;
}
console.log(`Post-fix: ${matches}/63 match`);
process.exit(0);
