/**
 * Try various ESPN API endpoint patterns to find group entries
 */
const ESPN_BASE = 'https://gambit-api.fantasy.espn.com/apis/v1/challenges/tournament-challenge-bracket-2026';
const GROUP_ID = '39ec1e2c-2fc6-44ac-933e-dcb95c9ab247';

async function tryFetch(url) {
  try {
    const res = await fetch(url);
    const status = res.status;
    if (!res.ok) return { status, data: null };
    const data = await res.json();
    return { status, data };
  } catch (err) {
    return { status: 'error', data: null };
  }
}

const patterns = [
  `${ESPN_BASE}/groups/${GROUP_ID}`,
  `${ESPN_BASE}/groups/${GROUP_ID}/entries`,
  `${ESPN_BASE}/groups/${GROUP_ID}/entries?view=scoreboard`,
  `${ESPN_BASE}/groups/${GROUP_ID}?view=entries`,
  `${ESPN_BASE}/groups/${GROUP_ID}?view=scoreboard`,
  // Try with challengeId
  `https://gambit-api.fantasy.espn.com/apis/v1/challenges/277/groups/${GROUP_ID}`,
  `https://gambit-api.fantasy.espn.com/apis/v1/challenges/277/groups/${GROUP_ID}/entries`,
  // Older API pattern
  `https://gambit-api.fantasy.espn.com/apis/v1/groups/${GROUP_ID}`,
  `https://gambit-api.fantasy.espn.com/apis/v1/groups/${GROUP_ID}/entries`,
  // Fantasy API
  `https://fantasy.espn.com/apis/v1/challenges/tournament-challenge-bracket-2026/groups/${GROUP_ID}`,
];

for (const url of patterns) {
  const { status, data } = await tryFetch(url);
  const shortUrl = url.replace(/https:\/\/[^/]+\/apis\/v1\//, '.../');
  if (data) {
    const keys = Object.keys(data);
    const size = JSON.stringify(data).length;
    console.log(`✅ ${status} ${shortUrl} -> keys: [${keys.join(', ')}] size: ${size}`);
    if (data.entries) {
      console.log(`   entries: ${data.entries.length} items`);
      for (const e of data.entries.slice(0, 3)) {
        console.log(`   "${e.name}" -> ${e.id}`);
      }
    }
    if (size < 2000) console.log(`   ${JSON.stringify(data).slice(0, 1000)}`);
  } else {
    console.log(`❌ ${status} ${shortUrl}`);
  }
}

process.exit(0);
