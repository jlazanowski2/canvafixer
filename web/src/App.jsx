import { useState, useCallback, useEffect, useRef } from "react";
import { optimize, statLabels } from "./optimizer.js";
import "./app.css";

const loadingPhrases = [
  "Firing up the AI...",
  "Analyzing your HTML structure...",
  "Counting nested tables... oh my...",
  "Mapping out the damage...",
  "Wrangling rogue table cells...",
  "Teaching Outlook what padding means...",
  "Performing open-heart surgery on your markup...",
  "Negotiating peace between Outlook and Gmail...",
  "Applying the sacred MSO incantations...",
  "Sacrificing spacer rows to the Outlook gods...",
  "Convincing <div>s to behave...",
  "Deleting things that should never have existed...",
  "Adding bgcolor for the 47th time...",
  "Folding spacetime to reduce table rows...",
  "Whispering sweet nothings to the D365 editor...",
  "Making Outlook's Word engine slightly less angry...",
  "Restructuring the restructured restructure...",
  "Calculating dimensions divisible by 4...",
  "Gently persuading your HTML to be responsive...",
  "Almost there... the AI is doing its thing...",
  "Still going... this is a big one...",
  "The AI is really thinking about this one...",
  "Good things come to those who wait...",
  "Your email is in good hands. Probably.",
  "Still cooking...",
  "Any moment now...",
];

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
  const [loadingPhrase, setLoadingPhrase] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(null);

  const phraseIndexRef = useRef(0);
  const phraseTimerRef = useRef(null);

  // Elapsed timer + phrase rotation during AI loading
  useEffect(() => {
    if (aiLoading) {
      setElapsed(0);
      phraseIndexRef.current = 0;
      setLoadingPhrase(loadingPhrases[0]);
      elapsedRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);

      function scheduleNextPhrase() {
        const delay = 15000 + Math.random() * 15000; // 15–30 seconds
        phraseTimerRef.current = setTimeout(() => {
          phraseIndexRef.current = Math.min(phraseIndexRef.current + 1, loadingPhrases.length - 1);
          setLoadingPhrase(loadingPhrases[phraseIndexRef.current]);
          scheduleNextPhrase();
        }, delay);
      }
      scheduleNextPhrase();
    } else {
      clearInterval(elapsedRef.current);
      clearTimeout(phraseTimerRef.current);
    }
    return () => {
      clearInterval(elapsedRef.current);
      clearTimeout(phraseTimerRef.current);
    };
  }, [aiLoading]);

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

  async function handleOptimize() {
    setError("");
    setCopied(false);
    setAiResult(null);
    if (!input.trim()) {
      setError("Paste your email HTML into the input box first.");
      return;
    }

    // --- Pass 1: mechanical optimization (instant, runs in browser) ---
    let pass1Html;
    try {
      const res = optimize(input);
      pass1Html = res.html;
      setOutput(res.html);
      setResult(res);
    } catch (e) {
      setError("Optimization failed: " + e.message);
      return;
    }

    // --- Pass 2: AI restructure (async, poll for result) ---
    setAiLoading(true);
    setLoadingPhrase(loadingPhrases[0]);

    try {
      const startRes = await fetch("/api/restructure", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CanvaFixer-Token": getToken(),
        },
        body: JSON.stringify({ html: pass1Html }),
      });

      let startData;
      try {
        startData = await startRes.json();
      } catch {
        setError(`API error (${startRes.status}) — response was not JSON.`);
        return;
      }

      if (startRes.status === 401) {
        const reason = startData.error || "Session expired";
        if (reason.includes("expired") || reason.includes("no token")) {
          clearToken();
          setAuthed(false);
        }
        setError(reason);
        return;
      }

      if (startRes.status !== 202) {
        setError(startData.error || `Failed to start restructure (${startRes.status})`);
        return;
      }

      const { jobId } = startData;

      const POLL_INTERVAL = 3000;
      const MAX_POLLS = 80;

      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL));

        const pollRes = await fetch(`/api/restructure-status?id=${jobId}`, {
          headers: { "X-CanvaFixer-Token": getToken() },
        });

        let pollData;
        try {
          pollData = await pollRes.json();
        } catch {
          setError(`Poll error (${pollRes.status}) — response was not JSON.`);
          return;
        }

        if (pollRes.status === 401) {
          const reason = pollData.error || "Session expired";
          if (reason.includes("expired") || reason.includes("no token")) {
            clearToken();
            setAuthed(false);
          }
          setError(reason);
          return;
        }

        if (pollData.status === "processing") continue;

        if (pollData.status === "error") {
          setError(pollData.error || "AI restructure failed");
          return;
        }

        if (pollData.status === "complete") {
          setOutput(pollData.html);
          setAiResult(pollData.usage);
          return;
        }

        setError(pollData.error || `Unexpected status: ${pollData.status}`);
        return;
      }

      setError("AI restructure timed out — the request took too long.");
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
            Optimize email HTML for Outlook, Gmail, iOS Mail + D365
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
            placeholder="Paste email HTML here or drag an .html file..."
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
                  <span className="loading-phrase" key={loadingPhrase}>{loadingPhrase}</span>
                  <span className="loading-elapsed">{elapsed}s</span>
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
          disabled={!input.trim() || aiLoading}
        >
          {aiLoading ? (
            <>
              <span className="spinner" />
              Optimizing…
            </>
          ) : (
            "Optimize"
          )}
        </button>
        <button
          className="btn btn--copy"
          onClick={handleCopy}
          disabled={!output || aiLoading}
        >
          {copied ? "Copied" : "Copy Output"}
        </button>
        <button className="btn btn--ghost" onClick={handleClear} disabled={aiLoading}>
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
