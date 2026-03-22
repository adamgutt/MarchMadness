// Save tournament structure + compact bracket picks optimized for the scenario generator
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

const SEED_MATCHUPS = [
  [1, 16], [8, 9], [5, 12], [4, 13], [6, 11], [3, 14], [7, 10], [2, 15],
];
const REGIONS = ['East', 'South', 'West', 'Midwest'];
const pointsPerRound = { 1: 10, 2: 20, 3: 40, 4: 80, 5: 160, 6: 320 };
const roundNames = { 1: 'R64', 2: 'R32', 3: 'S16', 4: 'E8', 5: 'F4', 6: 'Championship' };

// Step 1: Fetch propositions
console.log('=== Fetching propositions ===');
const propsByPeriod = {};
const allOutcomeNames = {};
for (let period = 1; period <= 6; period++) {
  const data = await (await fetch(`${ESPN_BASE}?scoringPeriodId=${period}`)).json();
  const props = (data.propositions || [])
    .map(p => ({
      id: p.id,
      displayOrder: p.displayOrder ?? 0,
      outcomes: (p.possibleOutcomes || []).map(o => ({ id: o.id, name: o.name })),
    }))
    .sort((a, b) => a.displayOrder - b.displayOrder);
  propsByPeriod[period] = props;
  for (const prop of props) {
    for (const o of prop.outcomes) allOutcomeNames[o.id] = o.name;
  }
  console.log(`  Period ${period}: ${props.length} propositions`);
}

// Step 2: Fetch all entries + full picks
console.log('\n=== Fetching all group entries ===');
const allEntries = [];
for (let offset = 0; offset < 2000; offset += 50) {
  const filter = JSON.stringify({ filterSortId: { value: 0 }, limit: 50, offset });
  const url = `${API_BASE}/groups/${GROUP_ID}/?platform=chui&view=chui_default_group&filter=${encodeURIComponent(filter)}`;
  const data = await (await fetch(url)).json();
  allEntries.push(...(data.entries || []));
  if ((data.entries || []).length < 50) break;
}
console.log(`Total entries: ${allEntries.length}`);

console.log('\n=== Fetching full picks ===');
const allFullEntries = [];
for (let i = 0; i < allEntries.length; i += 10) {
  const batch = allEntries.slice(i, i + 10);
  const results = await Promise.all(batch.map(async e => {
    try {
      const r = await fetch(`${API_BASE}/entries/${e.id}?platform=chui&view=chui_default`);
      return r.ok ? await r.json() : null;
    } catch { return null; }
  }));
  allFullEntries.push(...results.filter(Boolean));
  if ((i + 10) % 200 === 0) console.log(`  ${allFullEntries.length}/${allEntries.length}`);
}
console.log(`Loaded ${allFullEntries.length} full entries`);

// Step 3: Determine actual winners per propId
console.log('\n=== Determining game results ===');
const winners = {}; // propId -> winnerOutcomeId
for (const entry of allFullEntries) {
  for (const pick of entry.picks || []) {
    if (pick.outcomesPicked?.[0]?.result === 'CORRECT') {
      winners[pick.propositionId] = pick.outcomesPicked[0].outcomeId;
    }
  }
}
console.log(`Concluded games: ${Object.keys(winners).length} / 63`);

// Step 4: Build tournament structure
console.log('\n=== Building tournament structure ===');
const games = [];

// R64
for (const [idx, prop] of propsByPeriod[1].entries()) {
  const regionIdx = Math.floor(idx / 8);
  const position = idx % 8;
  const [seed1, seed2] = SEED_MATCHUPS[position];
  games.push({
    propId: prop.id,
    period: 1, round: 'R64',
    regionIdx, region: REGIONS[regionIdx], position,
    outcomes: prop.outcomes,
    seed1: seed1.toString(), seed2: seed2.toString(),
    winnerOutcomeId: winners[prop.id] || null,
    concluded: !!winners[prop.id],
  });
}

// R32-Championship
for (let period = 2; period <= 6; period++) {
  for (const [idx, prop] of propsByPeriod[period].entries()) {
    let regionIdx = -1, position = idx, region = '';
    if (period === 2) { regionIdx = Math.floor(idx / 4); position = idx % 4; region = REGIONS[regionIdx]; }
    else if (period === 3) { regionIdx = Math.floor(idx / 2); position = idx % 2; region = REGIONS[regionIdx]; }
    else if (period === 4) { regionIdx = idx; position = 0; region = REGIONS[regionIdx]; }
    else if (period === 5) { position = idx; region = idx === 0 ? 'East/South' : 'West/Midwest'; }
    else { position = 0; region = ''; }

    games.push({
      propId: prop.id,
      period, round: roundNames[period],
      regionIdx, region, position,
      outcomes: prop.outcomes,
      seed1: '', seed2: '',
      winnerOutcomeId: winners[prop.id] || null,
      concluded: !!winners[prop.id],
    });
  }
}

console.log(`Total games: ${games.length}`);

// Step 5: Build compact bracket picks
console.log('\n=== Building compact bracket data ===');
const summaryById = {};
for (const e of allEntries) summaryById[e.id] = e;

const compactBrackets = allFullEntries.map(entry => {
  const summary = summaryById[entry.id] || {};
  const score = summary.score || {};
  const champOid = entry.finalPick?.outcomesPicked?.[0]?.outcomeId;
  const picks = {};
  for (const pick of entry.picks || []) {
    const oid = pick.outcomesPicked?.[0]?.outcomeId;
    if (oid) picks[pick.propositionId] = oid;
  }
  return {
    id: entry.id,
    name: entry.name || '',
    champion: allOutcomeNames[champOid] || 'Unknown',
    tiebreaker: entry.tiebreakAnswers?.[0]?.answer || 0,
    rank: score.rank || 0,
    picks, // { propId: outcomeId }
  };
});

// Sort by rank
compactBrackets.sort((a, b) => (a.rank || 9999) - (b.rank || 9999));

// Step 6: Save to Firebase
console.log('\n=== Saving to Firebase ===');

// Save tournament structure
await setDoc(doc(db, 'scenario_data', 'tournament'), {
  games,
  pointsPerRound,
  updatedAt: new Date().toISOString(),
});
console.log('Saved tournament structure');

// Save bracket picks in batches of 150
const BATCH_SIZE = 150;
const numBatches = Math.ceil(compactBrackets.length / BATCH_SIZE);
for (let i = 0; i < numBatches; i++) {
  const batch = compactBrackets.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
  await setDoc(doc(db, 'scenario_data', `picks_${i}`), {
    brackets: batch,
    batchIndex: i,
    totalBatches: numBatches,
  });
  console.log(`Saved picks batch ${i} (${batch.length} brackets)`);
}

// Save metadata
await setDoc(doc(db, 'scenario_data', 'meta'), {
  totalBrackets: compactBrackets.length,
  totalBatches: numBatches,
  batchSize: BATCH_SIZE,
  updatedAt: new Date().toISOString(),
});
console.log('Saved metadata');

// Verify
console.log(`\n=== DONE ===`);
console.log(`Tournament: ${games.length} games (${Object.keys(winners).length} concluded)`);
console.log(`Brackets: ${compactBrackets.length} in ${numBatches} batches`);

// Quick check
const avi3 = compactBrackets.find(b => b.name.toLowerCase().includes('guttman 3'));
const avi2 = compactBrackets.find(b => b.name.toLowerCase().includes('guttman 2'));
if (avi3) console.log(`Avi guttman 3: ${avi3.champion}, rank ${avi3.rank}, ${Object.keys(avi3.picks).length} picks`);
if (avi2) console.log(`Avi guttman 2: ${avi2.champion}, rank ${avi2.rank}, ${Object.keys(avi2.picks).length} picks`);

process.exit(0);
