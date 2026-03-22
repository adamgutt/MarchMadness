// Save all Duke champion brackets to Firebase collection "duke_brackets"
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc } from 'firebase/firestore';
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

async function main() {
  // Fetch outcome names for champion resolution
  console.log('Fetching outcome names...');
  const outcomeNames = {};
  for (let period = 1; period <= 6; period++) {
    const data = await (await fetch(`https://gambit-api.fantasy.espn.com/apis/v1/challenges/tournament-challenge-bracket-2026?scoringPeriodId=${period}`)).json();
    for (const prop of data.propositions || []) {
      for (const o of prop.possibleOutcomes || []) outcomeNames[o.id] = o.name;
    }
  }

  // Fetch all entries via API pagination
  console.log('Fetching all entries via API...');
  const allEntries = [];
  for (let offset = 0; offset < 2000; offset += 50) {
    const filter = JSON.stringify({ filterSortId: { value: 0 }, limit: 50, offset });
    const url = `${API_BASE}/groups/${GROUP_ID}/?platform=chui&view=chui_default_group&filter=${encodeURIComponent(filter)}`;
    const data = await (await fetch(url)).json();
    const entries = data.entries || [];
    allEntries.push(...entries);
    if (offset % 200 === 0) console.log(`  Offset ${offset}: total ${allEntries.length}`);
    if (entries.length < 50) break;
  }
  console.log(`Total entries: ${allEntries.length}`);

  // Filter Duke champion entries
  const dukeEntries = allEntries.filter(entry => {
    const champId = entry.finalPick?.outcomesPicked?.[0]?.outcomeId;
    return (outcomeNames[champId] || '').toLowerCase().includes('duke');
  });
  console.log(`Duke champion entries: ${dukeEntries.length}`);

  // Prepare data
  const dukeData = dukeEntries.map(entry => {
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
      champion: 'Duke',
      r64Score: score.scoreByPeriod?.['1']?.score || 0,
      r32Score: score.scoreByPeriod?.['2']?.score || 0,
      pointsLost: score.pointsLost || 0,
      tiebreakAnswer: entry.tiebreakAnswers?.[0]?.answer || 0,
    };
  }).sort((a, b) => b.points - a.points || a.rank - b.rank);

  // Save to Firebase
  console.log(`\nSaving ${dukeData.length} Duke brackets to Firebase "duke_brackets"...`);
  let saved = 0;
  for (const entry of dukeData) {
    try {
      const docId = entry.id || entry.name.replace(/[^a-zA-Z0-9]/g, '_');
      await setDoc(doc(db, 'duke_brackets', docId), {
        ...entry,
        savedAt: new Date().toISOString(),
        source: 'espn_scrape',
      });
      saved++;
      if (saved % 50 === 0) console.log(`  Saved ${saved}/${dukeData.length}...`);
    } catch(e) {
      console.log(`  Error saving ${entry.name}: ${e.message}`);
    }
  }
  console.log(`\nDone! Saved ${saved}/${dukeData.length} Duke brackets to Firebase.`);
  process.exit(0);
}

main();
