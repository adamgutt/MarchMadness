/**
 * ESPN Tournament Challenge Bracket Extractor
 *
 * Decodes full 63-game brackets from ESPN TC entries.
 *
 * Usage:
 *   node espn-extract.mjs entry <entryID>          — full decoded bracket
 *   node espn-extract.mjs group <groupID>          — list entries w/ scores + champions
 *   node espn-extract.mjs group-full <groupID>     — full brackets for all entries
 *   node espn-extract.mjs teams                    — show R64 matchups per region
 *
 * How to find IDs:
 *   - Share link URL has entryId=XXXXX
 *   - Group page URL has groupID=XXXXX
 */

const YEAR = 2026;
const BASE = `https://gambit-api.fantasy.espn.com/apis/v1/challenges/tournament-challenge-bracket-${YEAR}`;
const ROUND_NAMES = { 1:'Round of 64', 2:'Round of 32', 3:'Sweet 16', 4:'Elite 8', 5:'Final Four', 6:'Championship' };
const REGION_NAMES = { 1:'East', 2:'South', 3:'West', 4:'Midwest' };

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) { console.error(`HTTP ${res.status}: ${url}`); return null; }
  return res.json();
}

/* ── Build outcome→team + proposition→matchup maps from the 32 R64 props ── */
async function buildMappings() {
  const challenge = await fetchJSON(BASE);
  if (!challenge) throw new Error('Cannot fetch challenge data');

  const outcomeToTeam = {};
  const propToMatchup = {};
  const regionMatchups = {};

  for (const prop of challenge.propositions || []) {
    const regionId = prop.possibleOutcomes?.[0]?.regionId;
    const info = { propId: prop.id, matchupId: prop.scoringPeriodMatchupId, displayOrder: prop.displayOrder, regionId, outcomes: [] };

    for (const o of prop.possibleOutcomes || []) {
      const mappings = {};
      for (const m of o.mappings || []) mappings[m.type] = m.value;
      outcomeToTeam[o.id] = {
        name: o.name, abbrev: o.abbrev, fullName: o.description,
        seed: mappings.SEED || String(o.regionSeed || ''),
        regionId: o.regionId, regionSeed: o.regionSeed,
        competitorId: mappings.COMPETITOR_ID || '',
      };
      info.outcomes.push(o.id);
    }
    propToMatchup[prop.id] = info;
    if (!regionMatchups[regionId]) regionMatchups[regionId] = [];
    regionMatchups[regionId].push(info);
  }

  for (const rid of Object.keys(regionMatchups))
    regionMatchups[rid].sort((a, b) => a.matchupId - b.matchupId);

  return { outcomeToTeam, propToMatchup, regionMatchups };
}

/* ── Decode a full bracket from one entry ── */
function decodeBracket(entry, outcomeToTeam, propToMatchup, regionMatchups) {
  const r64Map = {};
  for (const pick of entry.picks || []) {
    const propId = pick.propositionId;
    if (!propToMatchup[propId]) continue;
    const oid = pick.outcomesPicked?.[0]?.outcomeId;
    const team = outcomeToTeam[oid];
    r64Map[propId] = {
      team: team?.name || '???', seed: team?.seed || '?',
      regionId: team?.regionId, periodReached: pick.periodReached,
      result: pick.outcomesPicked?.[0]?.result || 'UNDECIDED',
    };
  }

  const regionIds = Object.keys(regionMatchups).sort((a,b) => a - b);
  const regions = {};

  for (const rid of regionIds) {
    const matchups = regionMatchups[rid];
    const r64 = matchups.map(m => r64Map[m.propId] || null);

    const r32 = [];
    for (let i = 0; i < 4; i++) {
      const a = r64[2*i], b = r64[2*i+1];
      if (a && b) r32.push(a.periodReached >= 3 ? a : b.periodReached >= 3 ? b : null);
      else r32.push(null);
    }

    const s16 = [];
    for (let i = 0; i < 2; i++) {
      const a = r32[2*i], b = r32[2*i+1];
      if (a && b) s16.push(a.periodReached >= 4 ? a : b.periodReached >= 4 ? b : null);
      else s16.push(null);
    }

    let e8 = null;
    if (s16[0] && s16[1])
      e8 = s16[0].periodReached >= 5 ? s16[0] : s16[1].periodReached >= 5 ? s16[1] : null;

    regions[rid] = { r64, r32, s16, e8 };
  }

  const e8Winners = regionIds.map(rid => regions[rid].e8);
  const ffPairs = [[0,1],[2,3]];
  const ffWinners = ffPairs.map(([i,j]) => {
    const a = e8Winners[i], b = e8Winners[j];
    if (a && b) return a.periodReached >= 6 ? a : b.periodReached >= 6 ? b : null;
    return null;
  });

  // Champion: finalPick uses a virtual championship proposition.
  // The 64 championship outcomes map 1:1 to the 64 teams in bracket order
  // (region 1-4, matchup 1-8 per region, team1 then team2 per matchup).
  const champTeamList = [];
  for (const rid of regionIds) {
    for (const matchup of regionMatchups[rid]) {
      for (const oid of matchup.outcomes) {
        champTeamList.push(outcomeToTeam[oid]);
      }
    }
  }

  let champion = null;
  if (entry.finalPick) {
    const oid = entry.finalPick.outcomesPicked?.[0]?.outcomeId;
    const t = outcomeToTeam[oid];
    if (t) {
      champion = { team: t.name, seed: t.seed, regionId: t.regionId };
    } else {
      const propHex = parseInt(entry.finalPick.propositionId.split('-')[0], 16);
      const outHex = parseInt(oid.split('-')[0], 16);
      const offset = outHex - propHex; // 1-indexed into champTeamList
      const ct = champTeamList[offset - 1];
      if (ct) champion = { team: ct.name, seed: ct.seed, regionId: ct.regionId };
    }
  }

  return { regions, e8Winners, ffWinners, champion };
}

/* ── Print a bracket nicely ── */
function printBracket(entry, otm, ptm, rm) {
  const b = decodeBracket(entry, otm, ptm, rm);
  const regionIds = Object.keys(b.regions).sort((a,c) => a - c);

  for (const rid of regionIds) {
    const r = b.regions[rid];
    console.log(`\n  === ${REGION_NAMES[rid] || 'Region '+rid} ===`);

    console.log('  R64 Winners:');
    for (const w of r.r64) {
      if (w) {
        const st = w.result === 'CORRECT' ? '✅' : w.result === 'INCORRECT' ? '❌' : '⏳';
        console.log(`    ${st} (${w.seed}) ${w.team} → advances to ${ROUND_NAMES[w.periodReached]}`);
      } else console.log('    ? unknown');
    }

    console.log('  R32 →', r.r32.map(w => w ? `(${w.seed}) ${w.team}` : '?').join(' | '));
    console.log('  S16 →', r.s16.map(w => w ? `(${w.seed}) ${w.team}` : '?').join(' | '));
    console.log(`  E8  → ${r.e8 ? `(${r.e8.seed}) ${r.e8.team}` : '?'}`);
  }

  console.log('\n  === Final Four ===');
  const rids = Object.keys(b.regions).sort((a,c) => a - c);
  console.log(`  FF1: ${b.e8Winners[0]?.team || '?'} (${REGION_NAMES[rids[0]]}) vs ${b.e8Winners[1]?.team || '?'} (${REGION_NAMES[rids[1]]})`);
  console.log(`  FF2: ${b.e8Winners[2]?.team || '?'} (${REGION_NAMES[rids[2]]}) vs ${b.e8Winners[3]?.team || '?'} (${REGION_NAMES[rids[3]]})`);
  console.log(`\n  🏆 Champion: ${b.champion ? `(${b.champion.seed}) ${b.champion.team}` : '?'}`);
}

/* ── Commands ── */
async function cmdTeams() {
  const { outcomeToTeam, regionMatchups } = await buildMappings();
  for (const [rid, matchups] of Object.entries(regionMatchups).sort((a,b) => a[0]-b[0])) {
    console.log(`\n=== ${REGION_NAMES[rid]} ===`);
    for (const m of matchups) {
      const [a, b] = m.outcomes.map(oid => outcomeToTeam[oid]);
      console.log(`  (${a?.seed}) ${a?.name}  vs  (${b?.seed}) ${b?.name}`);
    }
  }
}

async function cmdEntry(entryId) {
  const { outcomeToTeam: otm, propToMatchup: ptm, regionMatchups: rm } = await buildMappings();
  const entry = await fetchJSON(`${BASE}/entries/${entryId}`);
  if (!entry) return;
  const score = entry.score || {};
  console.log(`\n=== ${entry.name} ===`);
  console.log(`User: ${entry.member?.fullName || entry.member?.displayName || 'N/A'}`);
  console.log(`Score: ${score.overallScore || 0}  |  Correct: ${score.record?.wins || 0}  |  Wrong: ${score.record?.losses || 0}  |  Max: ${score.possiblePointsMax || '?'}`);
  printBracket(entry, otm, ptm, rm);
}

async function cmdGroup(groupId, full = false) {
  const { outcomeToTeam: otm, propToMatchup: ptm, regionMatchups: rm } = await buildMappings();
  let all = [], offset = 0;
  while (true) {
    const g = await fetchJSON(`${BASE}/groups/${groupId}?offset=${offset}&limit=50`);
    if (!g) break;
    if (offset === 0) console.log(`\n=== ${g.groupSettings?.name || 'Group'} (${g.size || '?'} entries) ===\n`);
    const entries = g.entries || [];
    if (!entries.length) break;
    all.push(...entries);
    if (entries.length < 50) break;
    offset += 50;
  }
  all.sort((a,b) => (b.score?.overallScore||0) - (a.score?.overallScore||0));
  for (let i = 0; i < all.length; i++) {
    const e = all[i], s = e.score || {};
    const b = decodeBracket(e, otm, ptm, rm);
    const ch = b.champion ? `(${b.champion.seed}) ${b.champion.team}` : '?';
    console.log(`${String(i+1).padStart(3)}. ${e.name.padEnd(30)} Score: ${String(s.overallScore||0).padStart(4)}  Champion: ${ch}  ID: ${e.id}`);
    if (full) { printBracket(e, otm, ptm, rm); console.log(''); }
  }
}

const [,,cmd, id] = process.argv;
if (!cmd) { console.log('Usage:\n  node espn-extract.mjs entry <id>\n  node espn-extract.mjs group <id>\n  node espn-extract.mjs group-full <id>\n  node espn-extract.mjs teams'); process.exit(0); }
switch (cmd) {
  case 'teams': cmdTeams(); break;
  case 'group': if (!id) { console.error('Need groupID'); process.exit(1); } cmdGroup(id); break;
  case 'group-full': if (!id) { console.error('Need groupID'); process.exit(1); } cmdGroup(id, true); break;
  case 'entry': if (!id) { console.error('Need entryID'); process.exit(1); } cmdEntry(id); break;
  default: console.error(`Unknown: ${cmd}`); process.exit(1);
}
