// This script simulates the fix-all.mjs logic locally to check picks WITHOUT writing
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

const SEED_MATCHUPS = [[1,16],[8,9],[5,12],[4,13],[6,11],[3,14],[7,10],[2,15]];

function fixTree(bracket) {
  const games = [...bracket.games];
  const regionNames = ['East', 'South', 'West', 'Midwest'];
  const seedOrder = SEED_MATCHUPS.map(([a]) => a);
  const regionR64 = {};
  for (let ridx = 0; ridx < 4; ridx++) {
    const start = ridx * 8;
    const r64 = games.slice(start, start + 8);
    r64.sort((a, b) => {
      const aMin = Math.min(Number(a.seed1) || 99, Number(a.seed2) || 99);
      const bMin = Math.min(Number(b.seed1) || 99, Number(b.seed2) || 99);
      return seedOrder.indexOf(aMin) - seedOrder.indexOf(bMin);
    });
    for (let i = 0; i < 8; i++) games[start + i] = r64[i];
    regionR64[ridx] = r64;
  }
  const teamAdv = {};
  for (const g of games) { if (g.pick) { if (!teamAdv[g.pick]) teamAdv[g.pick] = new Set(); teamAdv[g.pick].add(g.round); } }
  const roundOrder = ['Round of 64', 'Round of 32', 'Sweet 16', 'Elite 8', 'Final Four', 'Championship'];
  
  for (let ridx = 0; ridx < 4; ridx++) {
    const region = regionNames[ridx], r64 = regionR64[ridx];
    for (let i = 0; i < 4; i++) {
      const idx = 32 + ridx*4 + i;
      const t1 = r64[2*i].pick, t2 = r64[2*i+1].pick;
      const s1 = t1 === r64[2*i].team1 ? r64[2*i].seed1 : r64[2*i].seed2;
      const s2 = t2 === r64[2*i+1].team1 ? r64[2*i+1].seed1 : r64[2*i+1].seed2;
      let pick = null;
      for (let r = 1; r < roundOrder.length; r++) {
        if ((teamAdv[t1]||new Set()).has(roundOrder[r])) { pick = t1; break; }
        if ((teamAdv[t2]||new Set()).has(roundOrder[r])) { pick = t2; break; }
      }
      games[idx] = { round: 'Round of 32', region, team1: t1, team2: t2, pick, seed1: s1, seed2: s2 };
    }
  }
  for (let ridx = 0; ridx < 4; ridx++) {
    const region = regionNames[ridx];
    for (let i = 0; i < 2; i++) {
      const r32a = games[32+ridx*4+2*i], r32b = games[32+ridx*4+2*i+1];
      const idx = 48 + ridx*2 + i;
      const t1 = r32a.pick, t2 = r32b.pick;
      const s1 = t1===r32a.team1 ? r32a.seed1 : r32a.seed2;
      const s2 = t2===r32b.team1 ? r32b.seed1 : r32b.seed2;
      let pick = null;
      for (let r = 2; r < roundOrder.length; r++) {
        if ((teamAdv[t1]||new Set()).has(roundOrder[r])) { pick = t1; break; }
        if ((teamAdv[t2]||new Set()).has(roundOrder[r])) { pick = t2; break; }
      }
      games[idx] = { round: 'Sweet 16', region, team1: t1, team2: t2, pick, seed1: s1, seed2: s2 };
    }
  }
  for (let ridx = 0; ridx < 4; ridx++) {
    const region = regionNames[ridx];
    const s16a = games[48+ridx*2], s16b = games[48+ridx*2+1];
    const idx = 56+ridx;
    const t1 = s16a.pick, t2 = s16b.pick;
    const s1 = t1===s16a.team1 ? s16a.seed1 : s16a.seed2;
    const s2 = t2===s16b.team1 ? s16b.seed1 : s16b.seed2;
    let pick = null;
    for (let r = 3; r < roundOrder.length; r++) {
      if ((teamAdv[t1]||new Set()).has(roundOrder[r])) { pick = t1; break; }
      if ((teamAdv[t2]||new Set()).has(roundOrder[r])) { pick = t2; break; }
    }
    games[idx] = { round: 'Elite 8', region, team1: t1, team2: t2, pick, seed1: s1, seed2: s2 };
  }
  const e8arr = [games[56],games[57],games[58],games[59]];
  for (let fi = 0; fi < 2; fi++) {
    const a = e8arr[fi*2], b = e8arr[fi*2+1];
    const t1 = a.pick, t2 = b.pick;
    const s1 = t1===a.team1?a.seed1:a.seed2, s2 = t2===b.team1?b.seed1:b.seed2;
    let pick = null;
    for (let r = 4; r < roundOrder.length; r++) {
      if ((teamAdv[t1]||new Set()).has(roundOrder[r])) { pick = t1; break; }
      if ((teamAdv[t2]||new Set()).has(roundOrder[r])) { pick = t2; break; }
    }
    const reg = fi===0 ? 'East/South' : 'West/Midwest';
    games[60+fi] = { round: 'Final Four', region: reg, team1: t1, team2: t2, pick, seed1: s1, seed2: s2 };
  }
  const ct1 = games[60].pick, ct2 = games[61].pick;
  const cs1 = ct1===games[60].team1?games[60].seed1:games[60].seed2;
  const cs2 = ct2===games[61].team1?games[61].seed1:games[61].seed2;
  games[62] = { round: 'Championship', region: '', team1: ct1, team2: ct2, pick: bracket.games[62]?.pick, seed1: cs1, seed2: cs2 };
  return games;
}

const app = initializeApp({
  apiKey: 'AIzaSyAKbyio_RFQqltmQaVqgSoSFKMIfRKFWVE',
  authDomain: 'march-madness-7d2f6.firebaseapp.com',
  projectId: 'march-madness-7d2f6',
  storageBucket: 'march-madness-7d2f6.firebasestorage.app',
  messagingSenderId: '478554246498',
  appId: '1:478554246498:web:ceaa8a22a8892342a0ef1c',
});

const db = getFirestore(app);
const snap = await getDoc(doc(db, 'bracketData', 'main'));
const data = snap.data();

// Apply tree fix locally to simulate what fix-all.mjs will write
const yb2raw = data.brackets['Yitzy Berger 2'];
const yb2 = { ...yb2raw, games: fixTree(yb2raw) };
console.log('=== Yitzy Berger 2 - Post-Fix ===');
console.log('\nR64 East:');
for (let i = 0; i < 8; i++) {
  const g = yb2.games[i];
  console.log(`  [${i}] (${g.seed1})${g.team1} vs (${g.seed2})${g.team2} -> ${g.pick}`);
}
console.log('\nR32 East:');
for (let i = 32; i < 36; i++) {
  const g = yb2.games[i];
  console.log(`  [${i}] (${g.seed1})${g.team1} vs (${g.seed2})${g.team2} -> ${g.pick}`);
}
console.log('\nS16 East:');
for (let i = 48; i < 50; i++) {
  const g = yb2.games[i];
  console.log(`  [${i}] (${g.seed1})${g.team1} vs (${g.seed2})${g.team2} -> ${g.pick}`);
}
console.log('\nE8 East:');
const e8 = yb2.games[56];
console.log(`  [56] (${e8.seed1})${e8.team1} vs (${e8.seed2})${e8.team2} -> ${e8.pick}`);

console.log('\nFinal Four:');
console.log(`  [60] ${yb2.games[60].team1} vs ${yb2.games[60].team2} -> ${yb2.games[60].pick}`);
console.log(`  [61] ${yb2.games[61].team1} vs ${yb2.games[61].team2} -> ${yb2.games[61].pick}`);

console.log('\nChampionship:');
console.log(`  [62] ${yb2.games[62].team1} vs ${yb2.games[62].team2} -> ${yb2.games[62].pick}`);

// Verify tree: R32[0] team1 should = R64[0].pick, R32[0] team2 = R64[1].pick
console.log('\n=== Tree Verification (East) ===');
for (let i = 0; i < 4; i++) {
  const r32 = yb2.games[32 + i];
  const r64a = yb2.games[2 * i];
  const r64b = yb2.games[2 * i + 1];
  const t1ok = r32.team1 === r64a.pick ? '✓' : '✗';
  const t2ok = r32.team2 === r64b.pick ? '✓' : '✗';
  console.log(`  R32[${32+i}]: team1=${r32.team1} ${t1ok} (R64[${2*i}].pick=${r64a.pick}), team2=${r32.team2} ${t2ok} (R64[${2*i+1}].pick=${r64b.pick})`);
}

// Count null picks total
let nullPicks = 0;
for (const g of yb2.games) if (!g.pick) nullPicks++;
console.log(`\nNull picks: ${nullPicks}/63`);
if (nullPicks > 0) {
  console.log('Null pick games:');
  for (let i = 0; i < 63; i++) {
    const g = yb2.games[i];
    if (!g.pick) console.log(`  [${i}] ${g.round} ${g.region}: ${g.team1} vs ${g.team2}`);
  }
}

process.exit(0);
