import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { optimize, postProcess, statLabels } from "./optimizer.js";
import "./app.css";

const funMode = new URLSearchParams(window.location.search).has("fun");

const funEmojis = [
  "🦆","🦖","🦕","🐣","🎆","🎇","✨","🔥","💥","🎉",
  "🎊","🚀","⭐","🌮","🦄","🐸","🍕","👾","🤖","🏄",
];

function FunLayer() {
  const particles = useMemo(() =>
    Array.from({ length: 25 }, (_, i) => ({
      emoji: funEmojis[i % funEmojis.length],
      left: Math.random() * 90 + 5,
      delay: Math.random() * 12,
      duration: 8 + Math.random() * 10,
      size: 18 + Math.random() * 20,
      wobble: (Math.random() - 0.5) * 60,
    })), []);

  return (
    <div className="fun-layer" aria-hidden="true">
      {particles.map((p, i) => (
        <span
          key={i}
          className="fun-particle"
          style={{
            left: `${p.left}%`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            fontSize: `${p.size}px`,
            "--wobble": `${p.wobble}px`,
          }}
        >
          {p.emoji}
        </span>
      ))}
      <span className="fun-runner fun-dino">🦖</span>
      <span className="fun-runner fun-duck">🦆</span>
      <span className="fun-runner fun-duck2">🦆</span>
    </div>
  );
}

const loadingPhrases = [
  // Self-aware
  "If you're reading this, the AI hasn't crashed. Good sign.",
  "Plot twist: there were tables inside the tables.",
  "Your HTML called. It's in therapy now.",
  "The AI just sighed. That can't be good.",
  "Somewhere, a developer just cried looking at this markup.",
  "This would take a human 2 hours. We're doing it in 2 minutes.",
  // Outlook shade
  "Arguing with Outlook. Outlook is losing. Slowly.",
  "Explaining to Microsoft Word that it's not a web browser.",
  "Outlook: 'You want ROUND corners?' *laughs in Word engine*",
  "Outlook just asked why we're using CSS. Cute.",
  "Gently reminding Outlook that it's 2026.",
  // Technical but funny
  "Found another nested table. And another. And another...",
  "Converting prayers to inline styles...",
  "Adding bgcolor because Outlook doesn't believe in CSS.",
  "Making every number divisible by 4. It's a whole thing.",
  "mso-line-height-rule: exactly. Not approximately. EXACTLY.",
  "Removing spacer rows like pulling weeds after a rainstorm.",
  "Counting <td>s the way other people count sheep.",
  // Dramatic
  "The battle between your email and Outlook rages on...",
  "In the grim darkness of email HTML, there is only tables.",
  "One does not simply render an email in Outlook.",
  "What is dead may never die — but this spacer row can.",
  // Absurd
  "Feeding your HTML to the AI. It seems... concerned.",
  "Hiring tiny CSS elves to hand-deliver styles to each element.",
  "Asking the D365 editor nicely not to break everything. Again.",
  "Performing ancient email rituals handed down by the ancestors.",
  "Consulting the scrolls of mso-table-lspace...",
  "Three <table>s for the Elven-kings under the sky...",
  // Casual
  "Hang tight, this is the fun part.",
  "Still cooking. Low and slow, like good brisket.",
  "The AI is in the zone. Best not to disturb it.",
  "Making your email look good in things that don't want it to.",
  "You could make a cup of coffee. Just saying.",
  "Fun fact: email HTML is older than most interns.",
  "brb, teaching a 1998 rendering engine modern tricks.",
  "If email HTML were easy, you wouldn't need this app.",
  "Patience, young padawan. The CSS is strong with this one.",
  "Trust the process. The very, very slow process.",
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

  const phraseTimerRef = useRef(null);
  const usedPhrasesRef = useRef(new Set());

  function pickRandomPhrase() {
    // Reset pool if exhausted
    if (usedPhrasesRef.current.size >= loadingPhrases.length) {
      usedPhrasesRef.current.clear();
    }
    let idx;
    do {
      idx = Math.floor(Math.random() * loadingPhrases.length);
    } while (usedPhrasesRef.current.has(idx));
    usedPhrasesRef.current.add(idx);
    return loadingPhrases[idx];
  }

  // Elapsed timer + phrase rotation during AI loading
  useEffect(() => {
    if (aiLoading) {
      setElapsed(0);
      usedPhrasesRef.current.clear();
      setLoadingPhrase(pickRandomPhrase());
      elapsedRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);

      function scheduleNextPhrase() {
        const delay = 10000 + Math.random() * 5000; // 10–15 seconds
        phraseTimerRef.current = setTimeout(() => {
          setLoadingPhrase(pickRandomPhrase());
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
          setOutput(postProcess(pollData.html));
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
                {funMode && <FunLayer />}
                <div className="loading-card">
                  <div className="loading-steps">
                    <span className="loading-step loading-step--done">Pass 1 ✓</span>
                    <span className="loading-step-sep">&rarr;</span>
                    <span className="loading-step loading-step--active">Pass 2: AI Restructure</span>
                  </div>
                  <div className="thinking-dots">
                    <span /><span /><span />
                  </div>
                  <span className="loading-phrase" key={loadingPhrase}>{loadingPhrase}</span>
                  <span className="loading-elapsed"><span className="pulse-dot" />{elapsed}s</span>
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
