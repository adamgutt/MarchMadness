// Save all Arizona champion brackets to Firebase
// Uses the scraped data from espn_all_entries_v2.json + the API pagination

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc, getDocs } from 'firebase/firestore';
import fs from 'fs';

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

const API_BASE = 'https://gambit-api.fantasy.espn.com/apis/v1/challenges/277';
const GROUP_ID = '39ec1e2c-2fc6-44ac-933e-dcb95c9ab247';

// First, get all entries via API pagination to get full entry data including IDs
async function fetchAllEntries() {
  const allEntries = [];
  const limit = 50;
  
  for (let offset = 0; offset < 1840; offset += limit) {
    const filter = JSON.stringify({ filterSortId: { value: 0 }, limit, offset });
    const url = `${API_BASE}/groups/${GROUP_ID}/?platform=chui&view=chui_default_group&filter=${encodeURIComponent(filter)}`;
    
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        console.log(`Error at offset ${offset}: ${resp.status}`);
        continue;
      }
      const data = await resp.json();
      const entries = data.entries || [];
      allEntries.push(...entries);
      
      if (offset % 200 === 0) {
        console.log(`Fetched offset ${offset}: ${entries.length} entries (total: ${allEntries.length})`);
      }
      
      if (entries.length < limit) break;
    } catch(e) {
      console.log(`Error: ${e.message}`);
    }
  }
  
  return allEntries;
}

// Get proposition data for outcome name resolution
async function getOutcomeNames() {
  const url = 'https://gambit-api.fantasy.espn.com/apis/v1/challenges/tournament-challenge-bracket-2026?scoringPeriodId=6';
  const resp = await fetch(url);
  const data = await resp.json();
  
  const names = {};
  for (const prop of data.propositions || []) {
    for (const outcome of prop.possibleOutcomes || []) {
      names[outcome.id] = outcome.name;
    }
  }
  return names;
}

async function main() {
  console.log('Fetching all entries via API...');
  const allEntries = await fetchAllEntries();
  console.log(`Total entries fetched: ${allEntries.length}`);
  
  console.log('Fetching outcome names...');
  const outcomeNames = await getOutcomeNames();
  
  // Filter Arizona champion entries
  const arizonaEntries = allEntries.filter(entry => {
    const champId = entry.finalPick?.outcomesPicked?.[0]?.outcomeId;
    const champName = outcomeNames[champId] || '';
    return champName.toLowerCase().includes('arizona');
  });
  
  console.log(`\nArizona champion entries: ${arizonaEntries.length}`);
  
  // Prepare data for Firebase
  const arizonaData = arizonaEntries.map(entry => {
    const score = entry.score || {};
    return {
      id: entry.id,
      name: entry.name,
      memberName: entry.member?.displayName || '',
      points: score.overallScore || 0,
      maxPoints: score.possiblePointsMax || 0,
      rank: score.rank || 0,
      percentile: score.percentile || 0,
      eliminated: score.eliminated || false,
      correct: score.record?.wins || 0,
      wrong: score.record?.losses || 0,
      champion: 'Arizona',
      r64Score: score.scoreByPeriod?.['1']?.score || 0,
      r32Score: score.scoreByPeriod?.['2']?.score || 0,
      pointsLost: score.pointsLost || 0,
      tiebreakAnswer: entry.tiebreakAnswers?.[0]?.answer || 0,
    };
  });
  
  // Sort by points descending
  arizonaData.sort((a, b) => b.points - a.points || a.rank - b.rank);
  
  console.log('\nTop 20 Arizona brackets:');
  for (const e of arizonaData.slice(0, 20)) {
    console.log(`  Rank: ${e.rank} | ${e.name} | ${e.points}pts | Max: ${e.maxPoints} | ${e.correct}✓ ${e.wrong}✗`);
  }
  
  // Find Avi
  const aviEntry = arizonaData.find(e => e.name.toLowerCase().includes('guttman 3'));
  if (aviEntry) {
    console.log(`\nAvi Guttman 3 among Arizona: Position ${arizonaData.indexOf(aviEntry) + 1} out of ${arizonaData.length}`);
    console.log(JSON.stringify(aviEntry, null, 2));
  }
  
  // Save to Firebase collection "arizona_brackets"
  console.log('\nSaving to Firebase collection "arizona_brackets"...');
  const collectionRef = collection(db, 'arizona_brackets');
  
  let saved = 0;
  for (const entry of arizonaData) {
    try {
      const docId = entry.id || entry.name.replace(/[^a-zA-Z0-9]/g, '_');
      await setDoc(doc(db, 'arizona_brackets', docId), {
        ...entry,
        savedAt: new Date().toISOString(),
        source: 'espn_scrape',
      });
      saved++;
      if (saved % 50 === 0) console.log(`  Saved ${saved}/${arizonaData.length}...`);
    } catch(e) {
      console.log(`  Error saving ${entry.name}: ${e.message}`);
    }
  }
  
  console.log(`\nDone! Saved ${saved} Arizona brackets to Firebase "arizona_brackets" collection.`);
  
  // Also save the full data locally
  fs.writeFileSync('arizona_brackets.json', JSON.stringify(arizonaData, null, 2));
  console.log('Also saved locally to arizona_brackets.json');
  
  process.exit(0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
