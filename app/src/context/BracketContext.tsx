import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, ReactNode } from 'react';
import { BracketData, BracketEntry, Game, GameResult, PersonScore } from '../types';
import { loadBracketCSV, loadResultsFromText, buildGameIndex, getScores, getGameKey } from '../utils/csv';
import { db } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const DOC_ID = 'main'; // single document holding all app data
const COLLECTION = 'bracketData';

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
  addBracket: (name: string, person: string, pool: string, filename: string, text: string) => void;
  removeBracket: (name: string) => void;
  toggleMute: (name: string) => void;
  applyResults: (text: string) => void;
  setResult: (team1: string, team2: string, winner: string, round: string) => void;
  clearResult: (team1: string, team2: string) => void;
  clearAll: () => void;
}

const BracketContext = createContext<BracketState | null>(null);

const STORAGE_BRACKETS = 'mm_brackets';
const STORAGE_RESULTS = 'mm_results';
const STORAGE_ENTRIES = 'mm_entries';

export function BracketProvider({ children }: { children: ReactNode }) {
  const [brackets, setBrackets] = useState<Record<string, BracketData>>({});

  const [entries, setEntries] = useState<BracketEntry[]>([]);

  const [results, setResults] = useState<Record<string, GameResult>>({});

  const [selectedPool, setSelectedPool] = useState('all');
  const [games, setGames] = useState<Game[]>([]);
  const [rounds, setRounds] = useState<string[]>([]);
  const [scores, setScores] = useState<Record<string, PersonScore>>({});
  const loadedFromFirestore = useRef(false);
  const skipNextSync = useRef(false);

  // Load from Firestore on mount, fall back to localStorage if Firestore fails
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, COLLECTION, DOC_ID));
        if (snap.exists()) {
          const data = snap.data();
          skipNextSync.current = true;
          if (data.brackets) setBrackets(data.brackets);
          if (data.entries) setEntries(data.entries);
          if (data.results) {
            // Migrate result keys to normalized format (lowercase + team aliases)
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
        console.warn('Firestore load failed, using localStorage fallback', err);
        // Only fall back to localStorage if Firestore is unreachable
        try {
          const b = localStorage.getItem(STORAGE_BRACKETS);
          const e = localStorage.getItem(STORAGE_ENTRIES);
          const r = localStorage.getItem(STORAGE_RESULTS);
          if (b) setBrackets(JSON.parse(b));
          if (e) setEntries(JSON.parse(e));
          if (r) setResults(JSON.parse(r));
        } catch { /* ignore */ }
      }
      loadedFromFirestore.current = true;
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

  // Persist to localStorage + Firestore
  useEffect(() => {
    // Save to localStorage always
    try {
      localStorage.setItem(STORAGE_BRACKETS, JSON.stringify(brackets));
      localStorage.setItem(STORAGE_RESULTS, JSON.stringify(results));
      localStorage.setItem(STORAGE_ENTRIES, JSON.stringify(entries));
    } catch { /* quota exceeded */ }

    // Skip sync for the initial Firestore load to avoid writing back what we just read
    if (skipNextSync.current) {
      skipNextSync.current = false;
      return;
    }
    if (!loadedFromFirestore.current) return;

    // Save to Firestore (fire and forget)
    setDoc(doc(db, COLLECTION, DOC_ID), {
      brackets,
      entries,
      results,
    }).catch(err => console.warn('Firestore save failed', err));
  }, [brackets, results, entries]);

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
    setBrackets({});
    setResults({});
    setEntries([]);
    localStorage.removeItem(STORAGE_BRACKETS);
    localStorage.removeItem(STORAGE_RESULTS);
    localStorage.removeItem(STORAGE_ENTRIES);
    setDoc(doc(db, COLLECTION, DOC_ID), { brackets: {}, entries: [], results: {} })
      .catch(err => console.warn('Firestore clear failed', err));
  }, []);

  return (
    <BracketContext.Provider value={{
      brackets, entries, results, games, rounds, scores, pools,
      selectedPool, setSelectedPool,
      filteredBrackets, filteredGames, filteredScores, activeBrackets,
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
