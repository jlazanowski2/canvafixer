import { useState, useCallback } from "react";
import { optimize, statLabels } from "./optimizer.js";
import "./app.css";

function formatKB(bytes) {
  return (bytes / 1024).toFixed(1) + " KB";
}

export default function App() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);

  function handleOptimize() {
    setError("");
    setCopied(false);
    if (!input.trim()) {
      setError("Paste your Canva HTML into the input box first.");
      return;
    }
    try {
      const res = optimize(input);
      setOutput(res.html);
      setResult(res);
    } catch (e) {
      setError("Optimization failed: " + e.message);
    }
  }

  function handleCopy() {
    if (!output) return;
    navigator.clipboard.writeText(output).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleClear() {
    setInput("");
    setOutput("");
    setResult(null);
    setError("");
    setCopied(false);
  }

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragging(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file && (file.name.endsWith(".html") || file.name.endsWith(".txt"))) {
      const reader = new FileReader();
      reader.onload = (ev) => setInput(ev.target.result);
      reader.readAsText(file);
    }
  }, []);

  const pct = result
    ? (((result.inputSize - result.outputSize) / result.inputSize) * 100).toFixed(1)
    : 0;

  return (
    <div className="app-shell">
      <header className="header">
        <div className="logo">
          Canva<span>Fixer</span>
        </div>
        <span className="tagline">
          Optimize Canva HTML exports for Outlook, Gmail, iOS Mail + Dynamics 365
        </span>
      </header>

      <div className="panels">
        <div
          className={`panel panel--input ${dragging ? "panel--dragover" : ""}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className="panel-header">
            <span className="panel-label">Input</span>
            {input && (
              <span className="panel-badge">
                {formatKB(new Blob([input]).size)}
              </span>
            )}
          </div>
          <textarea
            className="editor"
            placeholder="Paste Canva HTML here or drag an .html file..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>

        <div
          className={`panel panel--output ${output ? "panel--filled" : ""}`}
        >
          <div className="panel-header">
            <span className="panel-label">Output</span>
            {result && (
              <span className="panel-badge panel-badge--success">
                {formatKB(result.outputSize)}
              </span>
            )}
          </div>
          <textarea
            className="editor editor--output"
            value={output}
            readOnly
            placeholder="Optimized HTML will appear here..."
          />
        </div>
      </div>

      <div className="actions">
        <button
          className="btn btn--primary"
          onClick={handleOptimize}
          disabled={!input.trim()}
        >
          Optimize
        </button>
        <button
          className="btn btn--copy"
          onClick={handleCopy}
          disabled={!output}
        >
          {copied ? "Copied" : "Copy Output"}
        </button>
        <button className="btn btn--ghost" onClick={handleClear}>
          Clear
        </button>
        {copied && (
          <span className="feedback feedback--success">
            Copied to clipboard
          </span>
        )}
        {error && <span className="feedback feedback--error">{error}</span>}
      </div>

      {result && (
        <div className="stats">
          <div className="stats-header">
            <span className="stat-pill">
              Input <strong>{formatKB(result.inputSize)}</strong>
            </span>
            <span className="stat-pill">
              Output <strong>{formatKB(result.outputSize)}</strong>
            </span>
            <span className="stat-pill stat-pill--saved">
              Saved <strong>{formatKB(result.inputSize - result.outputSize)}</strong> ({pct}%)
            </span>
          </div>
          <div className="reduction-bar">
            <div
              className="reduction-bar-fill"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="stats-body">
            {Object.entries(result.stats)
              .filter(([, count]) => count > 0)
              .map(([key, count]) => (
                <div key={key} className="stat-line">
                  <span className="stat-count">{count}</span>
                  <span className="stat-label">
                    {statLabels[key] || key}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
