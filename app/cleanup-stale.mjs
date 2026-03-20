import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';

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
const d = snap.data();

const stale = [
  'AG 1', 'AG 2',
  'Aryeh Mandelbaum 1', 'Aryeh Mandelbaum 2',
  'Djcp1', 'Djcp2',
  'Rudy #1', 'Rudy #2',
  'Yitzy berger #1', 'Yitzy berger #2',
];

for (const name of stale) {
  if (d.brackets[name]) {
    delete d.brackets[name];
    console.log('Removed bracket:', name);
  }
}
d.entries = d.entries.filter(e => stale.indexOf(e.name) === -1);

console.log('Remaining brackets:', Object.keys(d.brackets).length);
console.log('Remaining entries:', d.entries.length);
console.log(Object.keys(d.brackets).sort().join('\n'));

await setDoc(doc(db, 'bracketData', 'main'), d);
console.log('✅ Cleaned');
process.exit(0);
