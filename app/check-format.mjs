import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
const app = initializeApp({apiKey:'AIzaSyAKbyio_RFQqltmQaVqgSoSFKMIfRKFWVE',projectId:'march-madness-7d2f6',storageBucket:'march-madness-7d2f6.firebasestorage.app'});
const db = getFirestore(app);
const snap = await getDoc(doc(db,'bracketData','main'));
const d = snap.data().data || snap.data();
const brackets = d.brackets || d;

const fixed = brackets['AG 1'];
console.log('=== AG 1 (previously fixed via Splash) ===');
console.log('Game 0:', JSON.stringify(fixed.games[0]));
console.log('Game 32:', JSON.stringify(fixed.games[32]));
console.log('Game 48:', JSON.stringify(fixed.games[48]));
console.log('Game 60:', JSON.stringify(fixed.games[60]));
console.log('Game 62:', JSON.stringify(fixed.games[62]));
console.log();

const yb = brackets['Yitzy Berger 2'];
console.log('=== Yitzy Berger 2 (current) ===');
console.log('Game 0:', JSON.stringify(yb.games[0]));
console.log('Game 32:', JSON.stringify(yb.games[32]));
console.log('Game 62:', JSON.stringify(yb.games[62]));
console.log('Pool:', yb.pool);
process.exit(0);
