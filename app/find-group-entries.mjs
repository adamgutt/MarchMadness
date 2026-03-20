/**
 * Fetch ALL entries from the ESPN group and match to Firebase bracket names
 */
const ESPN_BASE = 'https://gambit-api.fantasy.espn.com/apis/v1/challenges/tournament-challenge-bracket-2026';
const GROUP_ID = '39ec1e2c-2fc6-44ac-933e-dcb95c9ab247';

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    console.log(`  Failed: ${res.status} for ${url}`);
    return null;
  }
  return res.json();
}

// Try to get group entries
console.log('Fetching group scoreboard...');
const endpoints = [
  `${ESPN_BASE}/groups/${GROUP_ID}/scoreboard`,
  `${ESPN_BASE}/groups/${GROUP_ID}/scoreboard?limit=2000`,
  `${ESPN_BASE}/groups/${GROUP_ID}/entries?limit=2000`,
  `${ESPN_BASE}/groups/${GROUP_ID}`,
];

for (const url of endpoints) {
  console.log(`\nTrying: ${url.replace(ESPN_BASE, '...')}`);
  const data = await fetchJSON(url);
  if (!data) continue;
  
  console.log(`  Keys: ${Object.keys(data).join(', ')}`);
  
  // Try to find entries array
  const entries = data.entries || data.scoreboard?.entries || data.results || (Array.isArray(data) ? data : null);
  
  if (entries && entries.length > 0) {
    console.log(`  Found ${entries.length} entries!`);
    
    // Firebase Mandel bracket names to match
    const fbNames = [
      'Yitzy Berger 1', 'Yitzy Berger 2', 'Yitzy Berger 3',
      'Alec Goldstein 1', 'Alec Goldstein 2', 'Alec goldstein 3',
      'Alec x Rudy', 'Aryeh Mandelbaum 1', 'Aryeh Mandelbaum 2', 'Aryeh Mandelbaum 3',
      'Avi guttman 1', 'Avi guttman 2', 'Avi guttman 3',
      'Goose cp collab winner', 'Mandel x Berger',
      'Rudy 1', 'Rudy 2', 'Rudy 3',
      'cp1', 'cp2', 'cp3',
    ];
    
    const norm = s => (s || '').toLowerCase().trim().replace(/\s+/g, ' ');
    
    // List ALL entries with their names and IDs
    console.log('\n=== All entries ===');
    for (const e of entries) {
      const name = e.name || e.entryName || 'unnamed';
      const id = e.id || e.entryId || '?';
      console.log(`  "${name}" -> ${id}`);
    }
    
    // Try to match
    console.log('\n=== Matches ===');
    for (const fbName of fbNames) {
      const match = entries.find(e => {
        const eName = e.name || e.entryName || '';
        return norm(eName) === norm(fbName);
      });
      if (match) {
        console.log(`  ✅ "${fbName}" -> ${match.id || match.entryId}`);
      } else {
        // Try fuzzy match
        const fuzzy = entries.find(e => {
          const eName = norm(e.name || e.entryName || '');
          return eName.includes(norm(fbName)) || norm(fbName).includes(eName);
        });
        if (fuzzy) {
          console.log(`  ~~ "${fbName}" ~~ "${fuzzy.name || fuzzy.entryName}" -> ${fuzzy.id || fuzzy.entryId}`);
        } else {
          console.log(`  ❌ "${fbName}" - no match`);
        }
      }
    }
    
    break; // Found entries, stop trying endpoints
  } else {
    // Dump first 500 chars to understand structure
    const str = JSON.stringify(data).slice(0, 500);
    console.log(`  Data preview: ${str}`);
  }
}

process.exit(0);
