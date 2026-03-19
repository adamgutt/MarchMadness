import { useRef, useState, DragEvent } from 'react';
import { useBrackets } from '../context/BracketContext';

const POOLS = ['Mandel', 'Aronoff'] as const;

interface PendingFile {
  filename: string;
  text: string;
}

export function UploadSection() {
  const { addBracket, entries, removeBracket, toggleMute, clearAll } = useBrackets();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [pending, setPending] = useState<PendingFile | null>(null);
  const [person, setPerson] = useState('');
  const [bracketName, setBracketName] = useState('');
  const [pool, setPool] = useState(POOLS[0] as string);

  const handleFile = (file: File) => {
    if (!file.name.endsWith('.csv')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (text) {
        setPending({ filename: file.name, text });
        setPerson('');
        setBracketName('');
        setPool(POOLS[0]);
      }
    };
    reader.readAsText(file);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const submitBracket = () => {
    if (!pending || !person.trim() || !bracketName.trim() || !pool) return;
    addBracket(bracketName.trim(), person.trim(), pool, pending.filename, pending.text);
    setPending(null);
    setPerson('');
    setBracketName('');
    setPool(POOLS[0]);
  };

  return (
    <>
      <div
        className={`upload-section ${dragOver ? 'dragover' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !pending && fileInputRef.current?.click()}
      >
        <h2>Upload Bracket CSV</h2>
        <p>Drag & drop a CSV file here, or click to browse. One file per bracket.</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = '';
          }}
        />
        {!pending && (
          <button
            className="upload-btn"
            onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
          >
            Choose File
          </button>
        )}

        {pending && (
          <div className="upload-form" onClick={(e) => e.stopPropagation()}>
            <div className="upload-form-file">
              File: <strong>{pending.filename}</strong>
            </div>
            <div className="upload-form-fields">
              <input
                type="text"
                className="upload-input"
                placeholder="Person's name (e.g. Adam)"
                value={person}
                onChange={(e) => setPerson(e.target.value)}
                autoFocus
              />
              <input
                type="text"
                className="upload-input"
                placeholder="Bracket name (e.g. Adam's Bracket 1)"
                value={bracketName}
                onChange={(e) => setBracketName(e.target.value)}
              />
              <select
                className="upload-input"
                value={pool}
                onChange={(e) => setPool(e.target.value)}
              >
                {POOLS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
              <div className="upload-form-actions">
                <button className="btn btn-primary" onClick={submitBracket} disabled={!person.trim() || !bracketName.trim() || !pool}>
                  Add Bracket
                </button>
                <button className="btn btn-secondary" onClick={() => setPending(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {entries.length > 0 && (
        <div className="entries-list">
          <h3>Uploaded Brackets ({entries.length})</h3>
          <div className="entries-grid">
            {entries.map(e => (
              <div key={e.name} className={`entry-tag ${e.muted ? 'entry-muted' : ''}`}>
                <div className="entry-info">
                  <span className="entry-name">{e.person} — {e.name}</span>
                  <span className="entry-pool">{e.pool}</span>
                </div>
                <div className="entry-actions">
                  <span
                    className={`mute-btn ${e.muted ? 'muted' : ''}`}
                    title={e.muted ? 'Unmute bracket' : 'Mute bracket'}
                    onClick={() => toggleMute(e.name)}
                  >
                    {e.muted ? '🔇' : '🔊'}
                  </span>
                  <span className="remove-file" onClick={() => removeBracket(e.name)}>&times;</span>
                </div>
              </div>
            ))}
          </div>
          <button
            className="btn btn-secondary"
            style={{ marginTop: '0.5rem' }}
            onClick={() => { if (window.confirm('Delete ALL brackets and results? This cannot be undone.')) clearAll(); }}
          >
            Clear All Data
          </button>
        </div>
      )}
    </>
  );
}
