import { useRef, useState } from 'react';
import { useBrackets } from '../context/BracketContext';

export function ResultsSection() {
  const { applyResults } = useBrackets();
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleApply = () => {
    if (text.trim()) applyResults(text);
  };

  return (
    <div className="results-section">
      <h2>Actual Game Results</h2>
      <p className="results-help">
        Upload a results CSV or paste results. Format:{' '}
        <code>Round,Team1,Team2,Winner</code>
      </p>
      <div className="results-row">
        <div style={{ flex: 1 }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder={"Round of 64,Duke,Vermont,Duke\nRound of 64,UConn,Norfolk St,UConn\n...or upload a results CSV"}
          />
        </div>
        <div className="results-actions">
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                  const content = ev.target?.result as string;
                  setText(content);
                  applyResults(content);
                };
                reader.readAsText(file);
              }
              e.target.value = '';
            }}
          />
          <button className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
            Upload CSV
          </button>
          <button className="btn btn-primary" onClick={handleApply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
