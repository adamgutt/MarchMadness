import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, ReactNode } from 'react';
import { BracketData, BracketEntry, Game, GameResult, PersonScore } from '../types';
import { loadBracketCSV, loadResultsFromText, buildGameIndex, getScores, getGameKey, normalizeTeamName } from '../utils/csv';
import { fetchLiveScores, LiveGame, matchLiveGame } from '../utils/liveScores';
import { db } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const DOC_ID = 'main';
// NEW collection — completely isolated from old 'bracketData' that kept getting overwritten.
// Nothing in the old code, old scripts, or cached builds knows this name exists.
const COLLECTION = 'brackets_final_v2';

interface BracketState {
  brackets: Record<string, BracketData>;
  entries: BracketEntry[];
  results: Record<string, GameResult>;
  games: Game[];
  rounds: string[];
  scores: Record<string, PersonScore>;
  pools: string[];
  selectedPool: string;
  setSelectedPool: (pool: string) => void;
  filteredBrackets: Record<string, BracketData>;
  filteredGames: Game[];
  filteredScores: Record<string, PersonScore>;
  activeBrackets: Record<string, BracketData>; // filtered + not muted
  liveGames: LiveGame[];
  addBracket: (name: string, person: string, pool: string, filename: string, text: string) => void;
  removeBracket: (name: string) => void;
  toggleMute: (name: string) => void;
  applyResults: (text: string) => void;
  setResult: (team1: string, team2: string, winner: string, round: string) => void;
  clearResult: (team1: string, team2: string) => void;
  clearAll: () => void;
}

const BracketContext = createContext<BracketState | null>(null);

// localStorage keys — only used to NUKE stale data on load
const STORAGE_KEYS_TO_NUKE = ['mm_brackets', 'mm_results', 'mm_entries'];

export function BracketProvider({ children }: { children: ReactNode }) {
  const [brackets, setBrackets] = useState<Record<string, BracketData>>({});

  const [entries, setEntries] = useState<BracketEntry[]>([]);

  const [results, setResults] = useState<Record<string, GameResult>>({});

  const [selectedPool, setSelectedPool] = useState('all');
  const [games, setGames] = useState<Game[]>([]);
  const [rounds, setRounds] = useState<string[]>([]);
  const [scores, setScores] = useState<Record<string, PersonScore>>({});
  const [liveGames, setLiveGames] = useState<LiveGame[]>([]);
  const loadedFromFirestore = useRef(false);
  // Track whether we're currently loading from Firestore to suppress sync-back
  const isLoadingFromFirestore = useRef(true);

  // Load from Firestore ONLY — no localStorage fallback. Nuke any stale localStorage.
  useEffect(() => {
    // Destroy any stale localStorage data immediately
    for (const key of STORAGE_KEYS_TO_NUKE) localStorage.removeItem(key);

    (async () => {
      try {
        const snap = await getDoc(doc(db, COLLECTION, DOC_ID));
        if (snap.exists()) {
          const data = snap.data();
          if (data.brackets) setBrackets(data.brackets);
          if (data.entries) setEntries(data.entries);
          if (data.results) {
            const migrated: Record<string, GameResult> = {};
            for (const [oldKey, val] of Object.entries(data.results as Record<string, GameResult>)) {
              const parts = oldKey.split(' vs ');
              if (parts.length === 2) {
                const newKey = getGameKey(parts[0], parts[1]);
                migrated[newKey] = val;
              } else {
                migrated[oldKey] = val;
              }
            }
            setResults(migrated);
          }
        }
      } catch (err) {
        console.warn('Firestore load failed', err);
        // NO localStorage fallback — if Firestore is down, show empty state
      }
      loadedFromFirestore.current = true;
      setTimeout(() => { isLoadingFromFirestore.current = false; }, 500);
    })();
  }, []);

  const pools = useMemo(() => {
    const poolSet = new Set(entries.map(e => e.pool));
    return [...poolSet].sort();
  }, [entries]);

  // Rebuild index whenever brackets or results change
  useEffect(() => {
    const { games: g, rounds: r } = buildGameIndex(brackets);
    setGames(g);
    setRounds(r);
    const s = getScores(brackets, g, r, results);
    setScores(s);
  }, [brackets, results]);

  // Sync ONLY results back to Firestore — brackets & entries are READ-ONLY from browser.
  // Only import scripts can modify brackets/entries. This prevents any stale browser
  // data from ever overwriting the canonical Firestore data.
  useEffect(() => {
    if (isLoadingFromFirestore.current) return;
    if (!loadedFromFirestore.current) return;

    // Only write results (auto-graded live scores + manual result entry)
    setDoc(doc(db, COLLECTION, DOC_ID), { results }, { merge: true })
      .catch(err => console.warn('Firestore results save failed', err));
  }, [results]);

  // Filtered data based on selected pool
  const filteredBrackets = useMemo(() => {
    if (selectedPool === 'all') return brackets;
    const namesInPool = new Set(entries.filter(e => e.pool === selectedPool).map(e => e.name));
    const filtered: Record<string, BracketData> = {};
    for (const [name, data] of Object.entries(brackets)) {
      if (namesInPool.has(name)) filtered[name] = data;
    }
    return filtered;
  }, [brackets, entries, selectedPool]);

  const filteredGames = useMemo(() => {
    const { games: g } = buildGameIndex(filteredBrackets);
    return g;
  }, [filteredBrackets]);

  const filteredScores = useMemo(() => {
    const { games: g, rounds: r } = buildGameIndex(filteredBrackets);
    return getScores(filteredBrackets, g, r, results);
  }, [filteredBrackets, results]);

  // Active brackets = filtered by pool AND not muted
  const activeBrackets = useMemo(() => {
    const mutedNames = new Set(entries.filter(e => e.muted).map(e => e.name));
    const active: Record<string, BracketData> = {};
    for (const [name, data] of Object.entries(filteredBrackets)) {
      if (!mutedNames.has(name)) active[name] = data;
    }
    return active;
  }, [filteredBrackets, entries]);

  const addBracket = useCallback((name: string, person: string, pool: string, filename: string, text: string) => {
    setBrackets(prev => loadBracketCSV(name, text, prev));
    setEntries(prev => [...prev.filter(e => e.name !== name), { name, person, pool, filename, muted: false }]);
  }, []);

  const removeBracket = useCallback((name: string) => {
    setBrackets(prev => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    setEntries(prev => prev.filter(e => e.name !== name));
  }, []);

  const toggleMute = useCallback((name: string) => {
    setEntries(prev => prev.map(e => e.name === name ? { ...e, muted: !e.muted } : e));
  }, []);

  const applyResults = useCallback((text: string) => {
    setResults(prev => loadResultsFromText(text, prev));
  }, []);

  const setResult = useCallback((team1: string, team2: string, winner: string, round: string) => {
    setResults(prev => {
      const key = getGameKey(team1, team2);
      return { ...prev, [key]: { winner, round } };
    });
  }, []);

  const clearResult = useCallback((team1: string, team2: string) => {
    setResults(prev => {
      const key = getGameKey(team1, team2);
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    // DISABLED: clearAll no longer writes to Firestore.
    // Bracket data is managed exclusively via import scripts.
    // Only local state is cleared (resets on refresh from Firestore).
    setBrackets({});
    setResults({});
    setEntries([]);
    for (const key of STORAGE_KEYS_TO_NUKE) localStorage.removeItem(key);
  }, []);

  // Live scores polling + auto-grading
  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const live = await fetchLiveScores();
        if (!active) return;
        setLiveGames(live);

        // Auto-grade completed games
        const newResults: Record<string, { winner: string; round: string }> = {};
        for (const lg of live) {
          if (lg.status !== 'post' || !lg.winner) continue;
          for (const game of games) {
            const match = matchLiveGame(lg, game.team1, game.team2);
            if (match) {
              const key = getGameKey(game.team1, game.team2);
              if (!results[key]) {
                const winnerNorm = normalizeTeamName(match.winner!);
                const t1Norm = normalizeTeamName(game.team1);
                const t2Norm = normalizeTeamName(game.team2);
                const winner = winnerNorm === t1Norm ? game.team1 : winnerNorm === t2Norm ? game.team2 : match.winner!;
                newResults[key] = { winner, round: game.round };
              }
              break;
            }
          }
        }

        if (Object.keys(newResults).length > 0) {
          setResults(prev => ({ ...prev, ...newResults }));
        }
      } catch (err) {
        console.warn('Live scores fetch failed:', err);
      }
    }

    // Poll immediately, then every 30 seconds
    poll();
    const interval = setInterval(poll, 30000);
    return () => { active = false; clearInterval(interval); };
  }, [games, results]);

  return (
    <BracketContext.Provider value={{
      brackets, entries, results, games, rounds, scores, pools,
      selectedPool, setSelectedPool,
      filteredBrackets, filteredGames, filteredScores, activeBrackets,
      liveGames,
      addBracket, removeBracket, toggleMute, applyResults, setResult, clearResult, clearAll,
    }}>
      {children}
    </BracketContext.Provider>
  );
}

export function useBrackets(): BracketState {
  const ctx = useContext(BracketContext);
  if (!ctx) throw new Error('useBrackets must be used within BracketProvider');
  return ctx;
}
