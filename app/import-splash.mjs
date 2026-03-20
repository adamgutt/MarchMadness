/**
 * Import Splash Sports bracket into Firebase
 * Usage: node import-splash.mjs <jsonFile> <person> <pool>
 *
 * The JSON file contains bracket data copied from the Splash Sports console.
 * Team names are mapped to ESPN canonical names via region+seed matching.
 */
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { readFileSync } from 'fs';

const firebaseConfig = {
  apiKey: 'AIzaSyAKbyio_RFQqltmQaVqgSoSFKMIfRKFWVE',
  authDomain: 'march-madness-7d2f6.firebaseapp.com',
  projectId: 'march-madness-7d2f6',
  storageBucket: 'march-madness-7d2f6.firebasestorage.app',
  messagingSenderId: '478554246498',
  appId: '1:478554246498:web:ceaa8a22a8892342a0ef1c',
};

const ESPN_BASE = 'https://gambit-api.fantasy.espn.com/apis/v1/challenges/tournament-challenge-bracket-2026';
const REGION_ORDER = ['East', 'South', 'West', 'Midwest'];

// Fetch ESPN challenge data to get canonical team names by region+seed
async function getEspnTeamNames() {
  const res = await fetch(ESPN_BASE);
  if (!res.ok) throw new Error(`ESPN API failed: ${res.status}`);
  const data = await res.json();

  const regionIdToName = { 1: 'East', 2: 'South', 3: 'West', 4: 'Midwest' };
  const lookup = {};

  for (const prop of data.propositions || []) {
    for (const o of prop.possibleOutcomes || []) {
      const regionName = regionIdToName[o.regionId];
      let seed = String(o.regionSeed || '');
      for (const m of o.mappings || []) {
        if (m.type === 'SEED') { seed = String(m.value); break; }
      }
      if (regionName && seed) {
        lookup[`${regionName}-${seed}`] = o.name;
      }
    }
  }

  return lookup;
}

function buildGames(splashData, espnNames) {
  // Build ryp_id → team info
  const rypToTeam = {};

  for (let ri = 0; ri < 4; ri++) {
    const section = splashData.gamesSections[ri];
    const regionName = section.id;

    for (const matchup of section.initialGames) {
      for (const team of matchup) {
        if (team.__type !== 'Team') continue;
        const key = `${regionName}-${team.number}`;
        const espnName = espnNames[key];
        if (!espnName) {
          console.warn(`⚠️  No ESPN name for ${key} (${team.title}), using Splash name`);
        }
        rypToTeam[team.id] = {
          name: espnName || team.title,
          seed: String(team.number),
          region: regionName,
          splashName: team.title,
        };
      }
    }
  }

  const picks = splashData.picks;
  const teamName = (rypId) => rypToTeam[rypId]?.name || '???';

  const games = [];

  // R64 (Splash games 1-32 → indices 0-31)
  for (let ri = 0; ri < 4; ri++) {
    const section = splashData.gamesSections[ri];
    const regionName = section.id;

    for (let mi = 0; mi < 8; mi++) {
      const gameId = ri * 8 + mi + 1;
      const matchup = section.initialGames[mi];
      const t1 = matchup[0], t2 = matchup[1];
      const pickRyp = picks[String(gameId)];

      games.push({
        round: 'Round of 64',
        region: regionName,
        team1: rypToTeam[t1.id]?.name || t1.title,
        team2: rypToTeam[t2.id]?.name || t2.title,
        seed1: String(t1.number),
        seed2: String(t2.number),
        pick: teamName(pickRyp),
      });
    }
  }

  // R32 (Splash games 33-48 → indices 32-47)
  for (let ri = 0; ri < 4; ri++) {
    const regionName = REGION_ORDER[ri];
    for (let mi = 0; mi < 4; mi++) {
      const gameId = 33 + ri * 4 + mi;
      const pickRyp = picks[String(gameId)];

      const idx1 = ri * 8 + 2 * mi;
      const idx2 = ri * 8 + 2 * mi + 1;
      const team1 = games[idx1].pick;
      const team2 = games[idx2].pick;
      const seed1 = team1 === games[idx1].team1 ? games[idx1].seed1 : games[idx1].seed2;
      const seed2 = team2 === games[idx2].team1 ? games[idx2].seed1 : games[idx2].seed2;

      games.push({
        round: 'Round of 32', region: regionName,
        team1, team2, seed1, seed2,
        pick: teamName(pickRyp),
      });
    }
  }

  // S16 (Splash games 49-56 → indices 48-55)
  for (let ri = 0; ri < 4; ri++) {
    const regionName = REGION_ORDER[ri];
    for (let mi = 0; mi < 2; mi++) {
      const gameId = 49 + ri * 2 + mi;
      const pickRyp = picks[String(gameId)];

      const idx1 = 32 + ri * 4 + 2 * mi;
      const idx2 = 32 + ri * 4 + 2 * mi + 1;
      const team1 = games[idx1].pick;
      const team2 = games[idx2].pick;
      const seed1 = team1 === games[idx1].team1 ? games[idx1].seed1 : games[idx1].seed2;
      const seed2 = team2 === games[idx2].team1 ? games[idx2].seed1 : games[idx2].seed2;

      games.push({
        round: 'Sweet 16', region: regionName,
        team1, team2, seed1, seed2,
        pick: teamName(pickRyp),
      });
    }
  }

  // E8 (Splash games 57-60 → indices 56-59)
  for (let ri = 0; ri < 4; ri++) {
    const regionName = REGION_ORDER[ri];
    const gameId = 57 + ri;
    const pickRyp = picks[String(gameId)];

    const idx1 = 48 + ri * 2;
    const idx2 = 48 + ri * 2 + 1;
    const team1 = games[idx1].pick;
    const team2 = games[idx2].pick;
    const seed1 = team1 === games[idx1].team1 ? games[idx1].seed1 : games[idx1].seed2;
    const seed2 = team2 === games[idx2].team1 ? games[idx2].seed1 : games[idx2].seed2;

    games.push({
      round: 'Elite 8', region: regionName,
      team1, team2, seed1, seed2,
      pick: teamName(pickRyp),
    });
  }

  // FF (Splash games 61-62 → indices 60-61)
  {
    const pickRyp = picks['61'];
    const team1 = games[56].pick, team2 = games[57].pick;
    const seed1 = team1 === games[56].team1 ? games[56].seed1 : games[56].seed2;
    const seed2 = team2 === games[57].team1 ? games[57].seed1 : games[57].seed2;
    games.push({
      round: 'Final Four', region: 'East/South',
      team1, team2, seed1, seed2, pick: teamName(pickRyp),
    });
  }
  {
    const pickRyp = picks['62'];
    const team1 = games[58].pick, team2 = games[59].pick;
    const seed1 = team1 === games[58].team1 ? games[58].seed1 : games[58].seed2;
    const seed2 = team2 === games[59].team1 ? games[59].seed1 : games[59].seed2;
    games.push({
      round: 'Final Four', region: 'West/Midwest',
      team1, team2, seed1, seed2, pick: teamName(pickRyp),
    });
  }

  // Championship (Splash game 63 → index 62)
  {
    const pickRyp = picks['63'];
    const team1 = games[60].pick, team2 = games[61].pick;
    const seed1 = team1 === games[60].team1 ? games[60].seed1 : games[60].seed2;
    const seed2 = team2 === games[61].team1 ? games[61].seed1 : games[61].seed2;
    games.push({
      round: 'Championship', region: '',
      team1, team2, seed1, seed2, pick: teamName(pickRyp),
    });
  }

  return games;
}

// Verify tree consistency (same as import-espn.mjs)
function verifyTree(games) {
  const issues = [];
  for (let i = 0; i < 16; i++) {
    const r32 = games[32 + i], r64a = games[2 * i], r64b = games[2 * i + 1];
    if (r32.team1 && r64a.pick !== r32.team1) issues.push(`R32[${32+i}] team1="${r32.team1}" != R64[${2*i}].pick="${r64a.pick}"`);
    if (r32.team2 && r64b.pick !== r32.team2) issues.push(`R32[${32+i}] team2="${r32.team2}" != R64[${2*i+1}].pick="${r64b.pick}"`);
  }
  for (let i = 0; i < 8; i++) {
    const s16 = games[48+i], r32a = games[32+2*i], r32b = games[32+2*i+1];
    if (s16.team1 && r32a.pick !== s16.team1) issues.push(`S16[${48+i}] team1="${s16.team1}" != R32[${32+2*i}].pick="${r32a.pick}"`);
    if (s16.team2 && r32b.pick !== s16.team2) issues.push(`S16[${48+i}] team2="${s16.team2}" != R32[${32+2*i+1}].pick="${r32b.pick}"`);
  }
  for (let i = 0; i < 4; i++) {
    const e8 = games[56+i], s16a = games[48+2*i], s16b = games[48+2*i+1];
    if (e8.team1 && s16a.pick !== e8.team1) issues.push(`E8[${56+i}] team1 mismatch`);
    if (e8.team2 && s16b.pick !== e8.team2) issues.push(`E8[${56+i}] team2 mismatch`);
  }
  if (games[60].team1 && games[56].pick !== games[60].team1) issues.push(`FF1 team1`);
  if (games[60].team2 && games[57].pick !== games[60].team2) issues.push(`FF1 team2`);
  if (games[61].team1 && games[58].pick !== games[61].team1) issues.push(`FF2 team1`);
  if (games[61].team2 && games[59].pick !== games[61].team2) issues.push(`FF2 team2`);
  if (games[62].team1 && games[60].pick !== games[62].team1) issues.push(`Champ team1`);
  if (games[62].team2 && games[61].pick !== games[62].team2) issues.push(`Champ team2`);
  for (let i = 0; i < 63; i++) {
    if (games[i].pick === null || games[i].pick === undefined) issues.push(`Game ${i} (${games[i].round}) has null pick`);
  }
  return issues;
}

// ── Main ──
const jsonFile = process.argv[2];
const person = process.argv[3];
const pool = process.argv[4] || 'Aronoff';

if (!jsonFile || !person) {
  console.error('Usage: node import-splash.mjs <jsonFile> <person> [pool]');
  process.exit(1);
}

const splashData = JSON.parse(readFileSync(jsonFile, 'utf8'));
console.log(`Entry name: "${splashData.entryName}"`);

console.log('Fetching ESPN team names for canonical mapping...');
const espnNames = await getEspnTeamNames();
console.log(`ESPN team mappings: ${Object.keys(espnNames).length}`);

const games = buildGames(splashData, espnNames);
console.log(`Games: ${games.length}`);
console.log(`Champion pick: ${games[62]?.pick}`);

const issues = verifyTree(games);
if (issues.length > 0) {
  console.log(`\n⚠️  Tree issues (${issues.length}):`);
  for (const iss of issues) console.log(`  ${iss}`);
} else {
  console.log('✅ Tree consistency verified');
}

// Write to Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const ref = doc(db, 'bracketData', 'main');
const snap = await getDoc(ref);
const fullData = snap.exists() ? snap.data() : { brackets: {}, entries: [], results: {} };

const bracketName = splashData.entryName;
fullData.brackets[bracketName] = { games };
const existingEntry = (fullData.entries || []).find(e => e.name === bracketName);
if (!existingEntry) {
  fullData.entries = [...(fullData.entries || []), { name: bracketName, person, pool, muted: false, filename: `splash_${pool}` }];
} else {
  fullData.entries = fullData.entries.map(e => e.name === bracketName ? { ...e, person, pool } : e);
}

await setDoc(ref, fullData);
console.log(`\n✅ Imported "${bracketName}" for ${person} (${pool}) into Firebase`);
console.log(`Total brackets: ${Object.keys(fullData.brackets).length}`);
process.exit(0);
