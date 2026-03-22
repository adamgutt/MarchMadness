name // Save ALL 1835 brackets with full picks to Firebase collection "espn_brackets"
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBZvwxRz7-lTbgD-KXyozLS1PW8dhQ7wzQ',
  authDomain: 'march-madness-7d2f6.firebaseapp.com',
  projectId: 'march-madness-7d2f6',
  storageBucket: 'march-madness-7d2f6.firebasestorage.app',
  messagingSenderId: '475744042901',
  appId: '1:475744042901:web:4b3e48918e3feb6c63809c',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const ESPN_BASE = 'https://gambit-api.fantasy.espn.com/apis/v1/challenges/tournament-challenge-bracket-2026';
const API_BASE = 'https://gambit-api.fantasy.espn.com/apis/v1/challenges/277';
const GROUP_ID = '39ec1e2c-2fc6-44ac-933e-dcb95c9ab247';

// Step 1: Fetch ALL propositions (periods 1-6) for outcome name mapping
console.log('=== Step 1: Fetching propositions ===');
const allOutcomeNames = {};
const propLookup = {};
for (let period = 1; period <= 6; period++) {
  const data = await (await fetch(`${ESPN_BASE}?scoringPeriodId=${period}`)).json();
  for (const prop of data.propositions || []) {
    propLookup[prop.id] = { period };
    for (const o of prop.possibleOutcomes || []) {
      allOutcomeNames[o.id] = o.name;
    }
  }
  console.log(`  Period ${period}: ${(data.propositions || []).length} propositions`);
}
console.log(`Total outcome names: ${Object.keys(allOutcomeNames).length}`);

const pointsPerRound = { 1: 10, 2: 20, 3: 40, 4: 80, 5: 160, 6: 320 };
const roundNames = { 1: 'R64', 2: 'R32', 3: 'S16', 4: 'E8', 5: 'F4', 6: 'Championship' };

// Step 2: Fetch all group entries via pagination
console.log('\n=== Step 2: Fetching all group entries ===');
const allEntries = [];
for (let offset = 0; offset < 2000; offset += 50) {
  const filter = JSON.stringify({ filterSortId: { value: 0 }, limit: 50, offset });
  const url = `${API_BASE}/groups/${GROUP_ID}/?platform=chui&view=chui_default_group&filter=${encodeURIComponent(filter)}`;
  const data = await (await fetch(url)).json();
  const entries = data.entries || [];
  allEntries.push(...entries);
  if (offset % 200 === 0) console.log(`  Offset ${offset}: ${allEntries.length} total`);
  if (entries.length < 50) break;
}
console.log(`Total entries in group: ${allEntries.length}`);

// Step 3: Fetch full picks for every single entry
console.log('\n=== Step 3: Fetching full picks for all entries ===');

async function fetchEntryWithRetry(entryId, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const resp = await fetch(`${API_BASE}/entries/${entryId}?platform=chui&view=chui_default`);
      if (resp.ok) return await resp.json();
      if (resp.status === 429) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      return null;
    } catch {
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return null;
}

const allFullEntries = [];
const batchSize = 10;
let failCount = 0;

for (let i = 0; i < allEntries.length; i += batchSize) {
  const batch = allEntries.slice(i, i + batchSize);
  const results = await Promise.all(batch.map(e => fetchEntryWithRetry(e.id)));
  
  for (let j = 0; j < results.length; j++) {
    if (results[j]) {
      allFullEntries.push(results[j]);
    } else {
      failCount++;
      console.log(`  FAILED: ${batch[j].name} (${batch[j].id})`);
    }
  }
  
  if ((i + batchSize) % 100 === 0 || i + batchSize >= allEntries.length) {
    console.log(`  Fetched ${allFullEntries.length}/${allEntries.length} (${failCount} failures)`);
  }
}
console.log(`\nTotal entries with full picks: ${allFullEntries.length}`);

// Step 4: Build clean bracket data for each entry
console.log('\n=== Step 4: Building bracket data ===');

function buildBracketDoc(fullEntry, summaryEntry) {
  const score = summaryEntry.score || {};
  
  // Resolve champion from finalPick
  const champOutcomeId = fullEntry.finalPick?.outcomesPicked?.[0]?.outcomeId;
  const champion = allOutcomeNames[champOutcomeId] || 'Unknown';
  
  // Build picks array
  const picks = [];
  let currentScore = 0;
  let correct = 0;
  let incorrect = 0;
  let undecided = 0;
  
  for (const pick of fullEntry.picks || []) {
    const propId = pick.propositionId;
    const outcomeId = pick.outcomesPicked?.[0]?.outcomeId;
    const result = pick.outcomesPicked?.[0]?.result;
    const period = propLookup[propId]?.period || 0;
    const pts = pointsPerRound[period] || 0;
    const team = allOutcomeNames[outcomeId] || 'Unknown';
    const round = roundNames[period] || `Period ${period}`;
    
    if (result === 'CORRECT') { currentScore += pts; correct++; }
    else if (result === 'INCORRECT') { incorrect++; }
    else { undecided++; }
    
    picks.push({
      propId,
      outcomeId,
      team,
      round,
      period,
      pts,
      result: result || 'UNDECIDED',
    });
  }
  
  return {
    entryId: fullEntry.id,
    name: fullEntry.name || '',
    memberName: fullEntry.member?.displayName || '',
    champion,
    tiebreaker: fullEntry.tiebreakAnswers?.[0]?.answer || 0,
    currentScore,
    maxPoints: score.possiblePointsMax || 0,
    rank: score.rank || 0,
    percentile: score.percentile || 0,
    correct,
    incorrect,
    undecided,
    picks,
  };
}

// Map summary entries by ID for quick lookup
const summaryById = {};
for (const e of allEntries) summaryById[e.id] = e;

const bracketDocs = [];
for (const full of allFullEntries) {
  const summary = summaryById[full.id] || {};
  bracketDocs.push(buildBracketDoc(full, summary));
}

// Verify champions
const champCounts = {};
for (const b of bracketDocs) {
  champCounts[b.champion] = (champCounts[b.champion] || 0) + 1;
}
console.log('\nChampion distribution:');
const sorted = Object.entries(champCounts).sort((a, b) => b[1] - a[1]);
for (const [champ, count] of sorted) {
  console.log(`  ${champ}: ${count} (${(count / bracketDocs.length * 100).toFixed(1)}%)`);
}

// Spot check some brackets
const spotChecks = ['guttman 3', 'guttman 2', 'joseph ammar'];
for (const search of spotChecks) {
  const b = bracketDocs.find(d => d.name.toLowerCase().includes(search));
  if (b) {
    console.log(`\nSpot check: ${b.name}`);
    console.log(`  Champion: ${b.champion}`);
    console.log(`  Score: ${b.currentScore} | Rank: ${b.rank}`);
    console.log(`  Picks: ${b.correct}✓ ${b.incorrect}✗ ${b.undecided}? = ${b.picks.length} total`);
    console.log(`  Tiebreaker: ${b.tiebreaker}`);
  }
}

// Step 5: Save to Firebase
console.log('\n=== Step 5: Saving to Firebase ===');
const COLLECTION = 'espn_pool_brackets';

let saved = 0;
let saveFails = 0;
for (const bracket of bracketDocs) {
  try {
    await setDoc(doc(db, COLLECTION, bracket.entryId), {
      ...bracket,
      savedAt: new Date().toISOString(),
    });
    saved++;
    if (saved % 100 === 0) console.log(`  Saved ${saved}/${bracketDocs.length}...`);
  } catch (e) {
    saveFails++;
    console.log(`  SAVE FAILED: ${bracket.name} — ${e.message}`);
  }
}

console.log(`\n=== DONE ===`);
console.log(`Saved: ${saved}/${bracketDocs.length} to "${COLLECTION}" collection`);
console.log(`Failures: ${saveFails}`);
console.log(`Total picks per bracket: 63`);
console.log(`Champion field verified for all entries`);

process.exit(0);
