/**
 * Deep audit: check pick consistency through the bracket tree
 * and examine entries structure
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyAKbyio_RFQqltmQaVqgSoSFKMIfRKFWVE',
  authDomain: 'march-madness-7d2f6.firebaseapp.com',
  projectId: 'march-madness-7d2f6',
  storageBucket: 'march-madness-7d2f6.firebasestorage.app',
  messagingSenderId: '478554246498',
  appId: '1:478554246498:web:ceaa8a22a8892342a0ef1c',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const snap = await getDoc(doc(db, 'bracketData', 'main'));
const data = snap.data();

// ── Check entries structure ──
console.log('=== ENTRIES STRUCTURE ===');
const entries = data.entries;
if (Array.isArray(entries)) {
  console.log(`Entries is an ARRAY with ${entries.length} items`);
  for (let i = 0; i < Math.min(5, entries.length); i++) {
    console.log(`  [${i}]:`, JSON.stringify(entries[i]));
  }
} else {
  console.log(`Entries is an OBJECT with keys: ${Object.keys(entries).slice(0, 5).join(', ')}...`);
  for (const k of Object.keys(entries).slice(0, 3)) {
    console.log(`  "${k}":`, JSON.stringify(entries[k]));
  }
}

// ── Check bracket "pool" field vs entries ──
console.log('\n=== BRACKET POOL FIELDS ===');
const brackets = data.brackets;
for (const name of Object.keys(brackets).sort()) {
  const b = brackets[name];
  const keys = Object.keys(b).filter(k => k !== 'games');
  console.log(`  "${name}": ${JSON.stringify(Object.fromEntries(keys.map(k => [k, b[k]])))}`);
}

// ── Deep pick consistency: verify the bracket tree flows correctly ──
console.log('\n=== PICK TREE CONSISTENCY ===');
// Firebase layout: [0-31] R64, [32-47] R32, [48-55] S16, [56-59] E8, [60-61] FF, [62] Champ
// R32[i] teams should come from R64[2i] and R64[2i+1] picks
// S16[i] teams should come from R32[2i] and R32[2i+1] picks
// E8[i] teams should come from S16[2i] and S16[2i+1] picks
// etc.

let treeErrors = 0;
for (const name of Object.keys(brackets).sort()) {
  const games = brackets[name].games;
  if (!games || games.length !== 63) continue;
  const issues = [];

  // R32 (indices 32-47): teams from R64 (indices 0-31)
  for (let i = 0; i < 16; i++) {
    const r32 = games[32 + i];
    const r64a = games[2 * i];
    const r64b = games[2 * i + 1];
    if (!r32 || !r64a || !r64b) continue;
    if (r32.team1 && r64a.pick !== r32.team1) issues.push(`R32[${32+i}] team1="${r32.team1}" but R64[${2*i}] pick="${r64a.pick}"`);
    if (r32.team2 && r64b.pick !== r32.team2) issues.push(`R32[${32+i}] team2="${r32.team2}" but R64[${2*i+1}] pick="${r64b.pick}"`);
  }

  // S16 (indices 48-55): teams from R32 (indices 32-47)
  for (let i = 0; i < 8; i++) {
    const s16 = games[48 + i];
    const r32a = games[32 + 2 * i];
    const r32b = games[32 + 2 * i + 1];
    if (!s16 || !r32a || !r32b) continue;
    if (s16.team1 && r32a.pick !== s16.team1) issues.push(`S16[${48+i}] team1="${s16.team1}" but R32[${32+2*i}] pick="${r32a.pick}"`);
    if (s16.team2 && r32b.pick !== s16.team2) issues.push(`S16[${48+i}] team2="${s16.team2}" but R32[${32+2*i+1}] pick="${r32b.pick}"`);
  }

  // E8 (indices 56-59): teams from S16 (indices 48-55)
  for (let i = 0; i < 4; i++) {
    const e8 = games[56 + i];
    const s16a = games[48 + 2 * i];
    const s16b = games[48 + 2 * i + 1];
    if (!e8 || !s16a || !s16b) continue;
    if (e8.team1 && s16a.pick !== e8.team1) issues.push(`E8[${56+i}] team1="${e8.team1}" but S16[${48+2*i}] pick="${s16a.pick}"`);
    if (e8.team2 && s16b.pick !== e8.team2) issues.push(`E8[${56+i}] team2="${e8.team2}" but S16[${48+2*i+1}] pick="${s16b.pick}"`);
  }

  // FF (indices 60-61): teams from E8 (indices 56-59)
  for (let i = 0; i < 2; i++) {
    const ff = games[60 + i];
    const e8a = games[56 + 2 * i];
    const e8b = games[56 + 2 * i + 1];
    if (!ff || !e8a || !e8b) continue;
    if (ff.team1 && e8a.pick !== ff.team1) issues.push(`FF[${60+i}] team1="${ff.team1}" but E8[${56+2*i}] pick="${e8a.pick}"`);
    if (ff.team2 && e8b.pick !== ff.team2) issues.push(`FF[${60+i}] team2="${ff.team2}" but E8[${56+2*i+1}] pick="${e8b.pick}"`);
  }

  // Championship (index 62): teams from FF (indices 60-61)
  const champ = games[62];
  const ff1 = games[60];
  const ff2 = games[61];
  if (champ && ff1 && ff2) {
    if (champ.team1 && ff1.pick !== champ.team1) issues.push(`Champ[62] team1="${champ.team1}" but FF[60] pick="${ff1.pick}"`);
    if (champ.team2 && ff2.pick !== champ.team2) issues.push(`Champ[62] team2="${champ.team2}" but FF[61] pick="${ff2.pick}"`);
  }

  if (issues.length > 0) {
    console.log(`\n  ❌ ${name}:`);
    for (const iss of issues) { console.log(`    ${iss}`); treeErrors++; }
  }
}

if (treeErrors === 0) {
  console.log('  ✅ All bracket trees are internally consistent!');
} else {
  console.log(`\n  Total tree errors: ${treeErrors}`);
}

process.exit(0);
