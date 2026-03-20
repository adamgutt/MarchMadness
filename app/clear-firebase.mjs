/**
 * Clear ALL bracket data from Firebase - nuclear reset
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, getDoc } from 'firebase/firestore';

const app = initializeApp({
  apiKey: 'AIzaSyAKbyio_RFQqltmQaVqgSoSFKMIfRKFWVE',
  authDomain: 'march-madness-7d2f6.firebaseapp.com',
  projectId: 'march-madness-7d2f6',
  storageBucket: 'march-madness-7d2f6.firebasestorage.app',
  messagingSenderId: '478554246498',
  appId: '1:478554246498:web:ceaa8a22a8892342a0ef1c',
});

const db = getFirestore(app);
const ref = doc(db, 'bracketData', 'main');

// Show current state
const snap = await getDoc(ref);
const data = snap.data();
console.log('Current state:');
console.log(`  Brackets: ${Object.keys(data?.brackets || {}).length}`);
console.log(`  Entries: ${(data?.entries || []).length}`);
console.log(`  Results: ${Object.keys(data?.results || {}).length}`);

// Clear everything
await setDoc(ref, { brackets: {}, entries: [], results: {} });

// Verify
const snap2 = await getDoc(ref);
const data2 = snap2.data();
console.log('\nAfter clear:');
console.log(`  Brackets: ${Object.keys(data2?.brackets || {}).length}`);
console.log(`  Entries: ${(data2?.entries || []).length}`);
console.log(`  Results: ${Object.keys(data2?.results || {}).length}`);
console.log('\n✅ All data cleared from Firebase');

process.exit(0);
