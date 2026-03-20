import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
const app = initializeApp({apiKey:'AIzaSyAKbyio_RFQqltmQaVqgSoSFKMIfRKFWVE',projectId:'march-madness-7d2f6',storageBucket:'march-madness-7d2f6.firebasestorage.app'});
const db = getFirestore(app);
const snap = await getDoc(doc(db,'bracketData','main'));
const d = snap.data().data || snap.data();

// Check both brackets
for (const name of ['Yitzy Berger 2', 'Yitzy berger #2']) {
  const b = d.brackets[name];
  if (!b) { console.log(`"${name}" NOT FOUND`); continue; }
  console.log(`\n=== "${name}" ===`);
  console.log('Pool:', b.pool);
  console.log('Champion (game 62):', JSON.stringify(b.games[62]));
  console.log('FF1 (game 60):', JSON.stringify(b.games[60]));
  console.log('FF2 (game 61):', JSON.stringify(b.games[61]));
  // Show first few R64 picks
  console.log('R64 picks:', b.games.slice(0,8).map(g => g.pick).join(', '));
}
process.exit(0);
