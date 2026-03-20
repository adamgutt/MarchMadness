/**
 * Find all ESPN entries for the Mandel pool by exploring the API thoroughly
 */
const ESPN_BASE = 'https://gambit-api.fantasy.espn.com/apis/v1/challenges/tournament-challenge-bracket-2026';

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

// Known entry
const knownEntryId = '414c9590-217e-11f1-8b19-c75e24aaf1c4';

// 1. Fetch the entry and dump ALL fields to find group info
const entry = await fetchJSON(`${ESPN_BASE}/entries/${knownEntryId}`);
console.log('=== Full entry keys ===');
console.log(Object.keys(entry));
console.log('\n=== Entry metadata ===');
const { picks, finalPick, ...metadata } = entry;
console.log(JSON.stringify(metadata, null, 2));

// 2. Try to find group from entry
const groupId = entry.groupId || entry.group?.id || entry.leagueId;
console.log('\ngroupId:', groupId);

// 3. Try various group endpoints
const endpoints = [
  `${ESPN_BASE}/groups/${groupId}`,
  `${ESPN_BASE}/groups/${groupId}/entries`,
  `${ESPN_BASE}/groups/${groupId}/entries?limit=100`,
  `${ESPN_BASE}/groups/${groupId}/scoreboard`,
  `${ESPN_BASE}/groups/${groupId}/scoreboard?limit=100`,
];

for (const url of endpoints) {
  if (!groupId) break;
  console.log(`\nTrying: ${url}`);
  const data = await fetchJSON(url);
  if (data) {
    const str = JSON.stringify(data);
    console.log(`  Got ${str.length} bytes, keys: ${Object.keys(data).join(', ')}`);
    if (Array.isArray(data)) console.log(`  Array of ${data.length} items`);
    if (data.entries) console.log(`  entries: ${data.entries.length} items`);
    // Extract entry IDs
    const entries = data.entries || (Array.isArray(data) ? data : []);
    if (entries.length > 0) {
      for (const e of entries.slice(0, 5)) {
        console.log(`  Entry: "${e.name || e.entryName}" id=${e.id || e.entryId}`);
      }
      if (entries.length > 5) console.log(`  ... and ${entries.length - 5} more`);
    }
  } else {
    console.log('  Failed');
  }
}

// 4. Try browsing challenge for groups
console.log('\n=== Challenge groups ===');
const challenge = await fetchJSON(ESPN_BASE);
if (challenge) {
  const cgKeys = Object.keys(challenge);
  console.log('Challenge keys:', cgKeys.join(', '));
  if (challenge.groups) console.log('Groups:', JSON.stringify(challenge.groups).slice(0, 500));
}

// 5. Try finding group by searching
const searchUrls = [
  `${ESPN_BASE}/groups?limit=100`,
  `${ESPN_BASE}/entries?limit=100`,
];
for (const url of searchUrls) {
  console.log(`\nTrying: ${url}`);
  const data = await fetchJSON(url);
  if (data) {
    console.log(`  Keys: ${Object.keys(data).join(', ')}, length: ${JSON.stringify(data).length}`);
  } else {
    console.log('  Failed');
  }
}

process.exit(0);
