import { useState, useCallback } from "react";
import { optimize, statLabels } from "./optimizer.js";
import "./app.css";

function formatKB(bytes) {
  return (bytes / 1024).toFixed(1) + " KB";
}

function getToken() {
  return sessionStorage.getItem("canvafixer_token");
}

function setToken(token) {
  sessionStorage.setItem("canvafixer_token", token);
}

function clearToken() {
  sessionStorage.removeItem("canvafixer_token");
}

// ---------- Login Screen ----------
function LoginScreen({ onLogin }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Login failed");
        return;
      }
      setToken(data.token);
      onLogin();
    } catch {
      setError("Connection failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="logo">
          Canva<span>Fixer</span>
        </div>
        <p className="login-subtitle">Email HTML Optimizer</p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            className="login-input"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
          <button
            type="submit"
            className="btn btn--primary login-btn"
            disabled={!password || loading}
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>
        {error && <span className="feedback feedback--error">{error}</span>}
      </div>
    </div>
  );
}

// ---------- Main App ----------
export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState(null);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragging(true);
  }, []);
  const handleDragLeave = useCallback(() => setDragging(false), []);
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

  if (!authed) {
    return <LoginScreen onLogin={() => setAuthed(true)} />;
  }

  function handleOptimize() {
    setError("");
    setCopied(false);
    setAiResult(null);
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

  async function handleAiRestructure() {
    if (!output) return;
    setError("");
    setAiLoading(true);
    setAiResult(null);

    try {
      const res = await fetch("/api/restructure", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ html: output }),
      });

      if (res.status === 401) {
        clearToken();
        setAuthed(false);
        setError("Session expired — please log in again");
        return;
      }

      let data;
      try {
        data = await res.json();
      } catch {
        setError(`API error (${res.status}) — response was not JSON. The function may have crashed.`);
        return;
      }

      if (!res.ok) {
        setError(data.error || `AI restructure failed (${res.status})`);
        return;
      }

      setOutput(data.html);
      setAiResult(data.usage);
    } catch (e) {
      setError("AI restructure failed: " + e.message);
    } finally {
      setAiLoading(false);
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
    setAiResult(null);
  }

  function handleLogout() {
    clearToken();
    setAuthed(false);
    handleClear();
  }

  const pct = result
    ? (((result.inputSize - result.outputSize) / result.inputSize) * 100).toFixed(1)
    : 0;

  return (
    <div className="app-shell app-shell--enter">
      <header className="header">
        <div className="header-left">
          <div className="logo">
            Canva<span>Fixer</span>
          </div>
          <span className="tagline">
            Optimize Canva HTML for Outlook, Gmail, iOS Mail + D365
          </span>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={handleLogout}>
          Sign Out
        </button>
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

        <div className={`panel panel--output ${output ? "panel--filled" : ""}`}>
          <div className="panel-header">
            <span className="panel-label">
              Output
              {aiResult && <span className="ai-badge">AI Restructured</span>}
            </span>
            {result && (
              <span className="panel-badge panel-badge--success">
                {formatKB(new Blob([output]).size)}
              </span>
            )}
          </div>
          <div className="panel-body">
            <textarea
              className="editor editor--output"
              value={output}
              readOnly
              placeholder="Optimized HTML will appear here..."
            />
            {aiLoading && (
              <div className="loading-overlay">
                <div className="loading-content">
                  <span className="spinner spinner--lg" />
                  <span className="loading-text">AI is restructuring your email…</span>
                  <span className="loading-sub">This usually takes 15–30 seconds</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="actions">
        <button
          className="btn btn--primary"
          onClick={handleOptimize}
          disabled={!input.trim()}
        >
          Pass 1: Optimize
        </button>
        <button
          className="btn btn--ai"
          onClick={handleAiRestructure}
          disabled={!output || aiLoading}
        >
          {aiLoading ? (
            <>
              <span className="spinner" />
              Restructuring…
            </>
          ) : (
            "Pass 2: AI Restructure"
          )}
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
          <span className="feedback feedback--success">Copied to clipboard</span>
        )}
        {error && <span className="feedback feedback--error">{error}</span>}
      </div>

      {aiResult && (
        <div className="ai-usage">
          Tokens used: {aiResult.inputTokens?.toLocaleString()} in / {aiResult.outputTokens?.toLocaleString()} out
        </div>
      )}

      {result && !aiResult && (
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
            <div className="reduction-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="stats-body">
            {Object.entries(result.stats)
              .filter(([, count]) => count > 0)
              .map(([key, count]) => (
                <div key={key} className="stat-line">
                  <span className="stat-count">{count}</span>
                  <span className="stat-label">{statLabels[key] || key}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
