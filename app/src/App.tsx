import { useState } from 'react';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { BracketProvider, useBrackets } from './context/BracketContext';

import { StatsOverview } from './components/StatsOverview';
import { BracketView } from './components/BracketView';
import { Leaderboard } from './components/Leaderboard';
import { PersonView } from './components/PersonView';
import { GradingPage } from './components/GradingPage';
import { PoolInfo } from './components/PoolInfo';
import { EspnLeaderboard } from './components/EspnLeaderboard';
import { EspnBracketView } from './components/EspnBracketView';
import type { EspnEntry } from './utils/espnLeaderboard';
import './App.css';

type Page = 'bracket' | 'leaderboard' | 'person' | 'poolinfo' | 'espn';

function CascadingFilter({
  selectedPerson,
  setSelectedPerson,
  selectedBracket,
  setSelectedBracket,
}: {
  selectedPerson: string;
  setSelectedPerson: (p: string) => void;
  selectedBracket: string;
  setSelectedBracket: (b: string) => void;
}) {
  const { pools, selectedPool, setSelectedPool, entries, filteredBrackets } = useBrackets();

  // People in current pool filter
  const people = [...new Set(
    entries
      .filter(e => selectedPool === 'all' || e.pool === selectedPool)
      .map(e => e.person)
  )].sort();

  // Brackets for selected person (within pool filter)
  const personBrackets = entries
    .filter(e => e.person === selectedPerson && (selectedPool === 'all' || e.pool === selectedPool))
    .filter(e => e.name in filteredBrackets)
    .sort((a, b) => a.name.localeCompare(b.name));

  const handlePoolChange = (pool: string) => {
    setSelectedPool(pool);
    setSelectedPerson('');
    setSelectedBracket('');
  };

  const handlePersonChange = (person: string) => {
    setSelectedPerson(person);
    // Auto-select if this person has exactly 1 bracket
    if (person) {
      const brackets = entries
        .filter(e => e.person === person && (selectedPool === 'all' || e.pool === selectedPool))
        .filter(e => e.name in filteredBrackets);
      if (brackets.length === 1) {
        setSelectedBracket(brackets[0].name);
      } else {
        setSelectedBracket('');
      }
    } else {
      setSelectedBracket('');
    }
  };

  return (
    <div className="cascading-filter">
      {/* Pool */}
      {pools.length > 1 && (
        <div className="filter-group">
          <label className="filter-label">Pool</label>
          <select className="filter-select" value={selectedPool} onChange={e => handlePoolChange(e.target.value)}>
            <option value="all">All Pools</option>
            {pools.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      )}

      {/* Person */}
      <div className="filter-group">
        <label className="filter-label">Person</label>
        <select className="filter-select" value={selectedPerson} onChange={e => handlePersonChange(e.target.value)}>
          <option value="">All People</option>
          {people.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {/* Bracket — only show when a person is selected and has multiple brackets */}
      {selectedPerson && personBrackets.length > 1 && (
        <div className="filter-group">
          <label className="filter-label">Bracket</label>
          <select className="filter-select" value={selectedBracket} onChange={e => setSelectedBracket(e.target.value)}>
            <option value="">All Brackets</option>
            {personBrackets.map(e => <option key={e.name} value={e.name}>{e.name} ({e.pool})</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

function MainApp() {
  const { entries } = useBrackets();
  const hasBrackets = entries.length > 0;
  const [page, setPage] = useState<Page>('bracket');
  const [selectedPerson, setSelectedPerson] = useState('');
  const [selectedBracket, setSelectedBracket] = useState('');
  const [espnViewEntry, setEspnViewEntry] = useState<EspnEntry | null>(null);

  const handleViewBracket = (bracketName: string) => {
    const entry = entries.find(e => e.name === bracketName);
    if (entry) {
      setSelectedPerson(entry.person);
      setSelectedBracket(bracketName);
    }
    setPage('bracket');
  };

  const navItems: { key: Page; label: string }[] = [
    { key: 'bracket', label: 'Bracket' },
    { key: 'leaderboard', label: 'Leaderboard' },
    // { key: 'person', label: 'By Person' },
    { key: 'espn', label: 'ESPN Standings' },
    { key: 'poolinfo', label: 'Pool Info' },
  ];

  return (
    <>
      <header>
        <h1>MARCH MADNESS BRACKET TRACKER</h1>
        <nav className="main-nav">
          {navItems.map(item => (
            <button
              key={item.key}
              className={`nav-btn ${page === item.key ? 'active' : ''}`}
              onClick={() => setPage(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      {hasBrackets && (
        <div className="toolbar">
          <StatsOverview />
          <CascadingFilter
            selectedPerson={selectedPerson}
            setSelectedPerson={setSelectedPerson}
            selectedBracket={selectedBracket}
            setSelectedBracket={setSelectedBracket}
          />
        </div>
      )}

      {page === 'bracket' && (
        <div className="page-bracket">
          {hasBrackets ? (
            <BracketView selectedBracket={selectedBracket} selectedPerson={selectedPerson} />
          ) : (
            <div className="empty-state">
              <h3>No brackets uploaded yet</h3>
              <p>No brackets loaded from Firestore.</p>
            </div>
          )}
        </div>
      )}

      {page === 'leaderboard' && (
        <div className="container">
          {hasBrackets ? <Leaderboard onViewBracket={handleViewBracket} selectedPerson={selectedPerson} /> : (
            <div className="empty-state"><h3>Upload brackets first</h3></div>
          )}
        </div>
      )}

      {page === 'person' && (
        <div className="container">
          {hasBrackets ? <PersonView /> : (
            <div className="empty-state"><h3>Upload brackets first</h3></div>
          )}
        </div>
      )}

      {page === 'espn' && !espnViewEntry && (
        <div className="container">
          <EspnLeaderboard onViewBracket={handleViewBracket} onViewEspnBracket={setEspnViewEntry} />
        </div>
      )}

      {page === 'espn' && espnViewEntry && (
        <div className="page-bracket">
          <EspnBracketView entry={espnViewEntry} onBack={() => setEspnViewEntry(null)} />
        </div>
      )}

      {page === 'poolinfo' && (
        <div className="container">
          <PoolInfo />
        </div>
      )}
    </>
  );
}

function GradePage() {
  const navigate = useNavigate();
  return (
    <div className="manage-page">
      <header>
        <button className="link-btn" onClick={() => navigate('/')}>← Back to Bracket</button>
      </header>
      <div className="container">
        <GradingPage />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <BracketProvider>
        <Routes>
          <Route path="/" element={<MainApp />} />
          <Route path="/grade" element={<GradePage />} />
        </Routes>
      </BracketProvider>
    </BrowserRouter>
  );
}
