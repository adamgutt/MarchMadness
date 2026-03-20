/**
 * Full audit of bracketData/main in Firebase
 * Checks: bracket count, game count, field presence, team name consistency,
 *         results integrity, entries/pool assignments, seed validity
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
const ref = doc(db, 'bracketData', 'main');
const snap = await getDoc(ref);
if (!snap.exists()) { console.error('No bracketData/main'); process.exit(1); }
const data = snap.data();

let errors = 0;
let warnings = 0;

function error(msg) { console.error(`  ❌ ERROR: ${msg}`); errors++; }
function warn(msg) { console.warn(`  ⚠️  WARN: ${msg}`); warnings++; }
function ok(msg) { console.log(`  ✅ ${msg}`); }

// ── 1. Top-level structure ──
console.log('\n=== 1. TOP-LEVEL STRUCTURE ===');
const topKeys = Object.keys(data);
console.log(`  Keys: ${topKeys.join(', ')}`);
if (!data.brackets) error('Missing "brackets" key');
if (!data.results) error('Missing "results" key');
if (!data.entries) error('Missing "entries" key');

// ── 2. Brackets audit ──
console.log('\n=== 2. BRACKETS AUDIT ===');
const brackets = data.brackets || {};
const bracketNames = Object.keys(brackets);
console.log(`  Total brackets: ${bracketNames.length}`);

const REQUIRED_FIELDS = ['round', 'region', 'team1', 'team2', 'pick', 'seed1', 'seed2'];
const VALID_ROUNDS = ['Round of 64', 'Round of 32', 'Sweet 16', 'Elite 8', 'Final Four', 'Championship'];
const VALID_REGIONS = ['East', 'South', 'West', 'Midwest', 'East/South', 'West/Midwest', ''];

const allTeamNames = new Set();
const champPicks = {};

for (const name of bracketNames.sort()) {
  const b = brackets[name];
  const games = b.games;
  const issues = [];

  if (!games) { error(`${name}: no games array`); continue; }
  if (games.length !== 63) issues.push(`has ${games.length} games (expected 63)`);

  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    if (!g) { issues.push(`game[${i}] is null/undefined`); continue; }

    for (const f of REQUIRED_FIELDS) {
      if (g[f] === undefined || g[f] === null) issues.push(`game[${i}] missing "${f}"`);
    }

    if (g.round && !VALID_ROUNDS.includes(g.round)) issues.push(`game[${i}] invalid round "${g.round}"`);
    if (g.region !== undefined && g.region !== '' && !VALID_REGIONS.includes(g.region)) issues.push(`game[${i}] invalid region "${g.region}"`);

    // Pick should be one of team1 or team2 (or null for future games)
    if (g.pick && g.team1 && g.team2 && g.pick !== g.team1 && g.pick !== g.team2) {
      issues.push(`game[${i}] pick "${g.pick}" not in [${g.team1}, ${g.team2}]`);
    }

    // Collect team names
    if (g.team1) allTeamNames.add(g.team1);
    if (g.team2) allTeamNames.add(g.team2);
  }

  // Championship pick
  if (games[62]) champPicks[name] = games[62].pick;

  if (b.pool === undefined) issues.push('missing pool field');

  if (issues.length === 0) {
    ok(`${name} (${games.length} games, pool: ${b.pool}, champ: ${games[62]?.pick})`);
  } else {
    for (const iss of issues) error(`${name}: ${iss}`);
  }
}

// ── 3. Results audit ──
console.log('\n=== 3. RESULTS AUDIT ===');
const results = data.results || {};
const resultKeys = Object.keys(results);
console.log(`  Total result entries: ${resultKeys.length}`);

const resultTeamNames = new Set();
let resultsWithWinner = 0;
for (const key of resultKeys) {
  const r = results[key];
  if (r.team1) resultTeamNames.add(r.team1);
  if (r.team2) resultTeamNames.add(r.team2);
  if (r.winner) {
    resultTeamNames.add(r.winner);
    resultsWithWinner++;
  }
}
ok(`${resultsWithWinner} games have winners decided`);

// Check: result team names vs bracket team names
const resultOnly = [...resultTeamNames].filter(t => !allTeamNames.has(t));
const bracketOnly = [...allTeamNames].filter(t => !resultTeamNames.has(t));
if (resultOnly.length) warn(`Teams in results but not in any bracket: ${resultOnly.join(', ')}`);
if (bracketOnly.length) warn(`Teams in brackets but not in results: ${bracketOnly.join(', ')}`);

// ── 4. Entries audit ──
console.log('\n=== 4. ENTRIES AUDIT ===');
const entries = data.entries || {};
const entryKeys = Object.keys(entries);
console.log(`  Total entries: ${entryKeys.length}`);

const poolCounts = {};
for (const key of entryKeys) {
  const e = entries[key];
  if (!e.pool) warn(`Entry "${key}" missing pool`);
  poolCounts[e.pool] = (poolCounts[e.pool] || 0) + 1;

  // Check that the bracket name exists
  if (!brackets[e.bracket || key]) {
    // Try the key itself as bracket name
    if (!brackets[key]) warn(`Entry "${key}" references bracket that doesn't exist`);
  }
}
for (const [pool, count] of Object.entries(poolCounts)) {
  ok(`Pool "${pool}": ${count} entries`);
}

// Check: every bracket has a matching entry
const entryBracketNames = new Set(entryKeys);
const bracketsWithoutEntry = bracketNames.filter(n => !entryBracketNames.has(n));
const entriesWithoutBracket = entryKeys.filter(n => !bracketNames.includes(n));
if (bracketsWithoutEntry.length) warn(`Brackets without entries: ${bracketsWithoutEntry.join(', ')}`);
if (entriesWithoutBracket.length) warn(`Entries without brackets: ${entriesWithoutBracket.join(', ')}`);

// ── 5. Round distribution check ──
console.log('\n=== 5. ROUND DISTRIBUTION (per bracket) ===');
// Expected: 32 R64, 16 R32, 8 S16, 4 E8, 2 FF, 1 Champ = 63
const expectedRounds = { 'Round of 64': 32, 'Round of 32': 16, 'Sweet 16': 8, 'Elite 8': 4, 'Final Four': 2, 'Championship': 1 };
let roundIssues = 0;
for (const name of bracketNames) {
  const games = brackets[name].games;
  if (!games) continue;
  const counts = {};
  for (const g of games) {
    if (g?.round) counts[g.round] = (counts[g.round] || 0) + 1;
  }
  for (const [round, expected] of Object.entries(expectedRounds)) {
    if ((counts[round] || 0) !== expected) {
      error(`${name}: ${round} has ${counts[round] || 0} games (expected ${expected})`);
      roundIssues++;
    }
  }
}
if (roundIssues === 0) ok('All brackets have correct round distribution (32/16/8/4/2/1)');

// ── 6. Seed validity ──
console.log('\n=== 6. SEED VALIDITY ===');
const validSeeds = new Set(['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16']);
let seedIssues = 0;
for (const name of bracketNames) {
  const games = brackets[name].games;
  if (!games) continue;
  for (let i = 0; i < games.length; i++) {
    const g = games[i];
    if (!g) continue;
    if (g.seed1 && !validSeeds.has(String(g.seed1))) { error(`${name} game[${i}] invalid seed1: "${g.seed1}"`); seedIssues++; }
    if (g.seed2 && !validSeeds.has(String(g.seed2))) { error(`${name} game[${i}] invalid seed2: "${g.seed2}"`); seedIssues++; }
  }
}
if (seedIssues === 0) ok('All seeds are valid (1-16)');

// ── 7. All unique team names ──
console.log('\n=== 7. ALL UNIQUE TEAM NAMES ===');
const sortedTeams = [...allTeamNames].sort();
console.log(`  ${sortedTeams.length} unique teams: ${sortedTeams.join(', ')}`);

// ── Summary ──
console.log('\n========================================');
console.log(`  ERRORS: ${errors}`);
console.log(`  WARNINGS: ${warnings}`);
console.log('========================================\n');

process.exit(errors > 0 ? 1 : 0);
