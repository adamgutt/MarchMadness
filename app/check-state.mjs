import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

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

// Check Yitzy Berger 2 specifically
const yb2 = data.brackets['Yitzy Berger 2'];
if (!yb2) { console.log('Yitzy Berger 2 NOT FOUND'); process.exit(1); }

console.log('=== Yitzy Berger 2 - Current Firebase State ===');
for (let i = 0; i < 8; i++) {
  const g = yb2.games[i];
  console.log(`[${i}] R64 ${g.region}: ${g.team1} vs ${g.team2} -> pick: ${g.pick}`);
}
console.log('---');
for (let i = 32; i < 36; i++) {
  const g = yb2.games[i];
  console.log(`[${i}] R32 ${g.region}: ${g.team1} vs ${g.team2} -> pick: ${g.pick}`);
}
console.log('---');
const ch = yb2.games[62];
console.log(`[62] Champ: ${ch.team1} vs ${ch.team2} -> pick: ${ch.pick}`);
console.log(`Total games: ${yb2.games.length}`);

// Also quickly check a few other brackets that were fixed
console.log('\n=== Spot-check other brackets ===');
const spotCheck = ['AG 1', 'Rudy 1', 'Aryeh Mandelbaum #1', 'cp1'];
for (const name of spotCheck) {
  const b = data.brackets[name];
  if (!b) { console.log(`${name}: NOT FOUND`); continue; }
  const ch = b.games[62];
  const g0 = b.games[0];
  console.log(`${name}: [0] ${g0.team1} vs ${g0.team2} -> ${g0.pick} | Champ: ${ch.pick} | Games: ${b.games.length}`);
}

process.exit(0);
