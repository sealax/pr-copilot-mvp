import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

export default function Home() {
  const [prompt, setPrompt] = useState('');
  const [output, setOutput] = useState('');
  const [user, setUser] = useState(null);
  const [remainingGenerations, setRemainingGenerations] = useState<number | null>(null);
  const [generationLimit, setGenerationLimit] = useState(5);

  const [verdict, setVerdict] = useState<"GO" | "CONDITIONAL" | "NO-GO" | "">("");
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedOutput, setCopiedOutput] = useState(false);

  const [market, setMarket] = useState("Fintech compliance");
  const [funding, setFunding] = useState("$3M seed");
  const [partners, setPartners] = useState("AcmePay (regulated UK fintech)");

  const [evalData, setEvalData] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);

useEffect(() => {
  if (!supabase) return;
  supabase.auth.getUser().then(({ data }) => setUser(data?.user ?? null));
}, []);

const fetchHistory = async () => {
  if (!supabase || !user) return;

    const headers = await getApiHeaders();
    const res = await fetch("/api/history", { headers });
    const data = await res.json();

    if (!res.ok) {
      console.error("History API error:", data);
      return;
    }

    setHistory(Array.isArray(data.history) ? data.history : []);
  };

useEffect(() => {
  if (!user) return;

  fetchHistory();
}, [user]);

const login = async (provider: "github" | "google") => {
  if (!supabase) {
    alert("Supabase is not configured");
    return;
  }
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: window.location.origin,
    },
  });

  if (error) {
    console.error("LOGIN ERROR:", error);
  }
};

const logout = async () => {
  if (!supabase) {
    alert("Supabase is not configured");
    return;
  }

  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error("LOGOUT ERROR:", error);
    alert("Logout failed");
    return;
  }

  setUser(null);
  setHistory([]);
  setEvalData(null);
  setVerdict("");
  setPrompt("");
  setOutput("");
  setRemainingGenerations(null);
};

const getApiHeaders = async () => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (!supabase) {
    throw new Error("Authentication required");
  }

  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  if (!accessToken) {
    throw new Error("Authentication required");
  }

  headers.Authorization = `Bearer ${accessToken}`;

  return headers;
};

const fetchUsage = async () => {
  const headers = await getApiHeaders();
  const res = await fetch("/api/usage", { headers });
  const data = await res.json();

  if (!res.ok) {
    console.error("Usage API error:", data);
    return;
  }

  setRemainingGenerations(
    typeof data.remaining_generations === "number" ? data.remaining_generations : null
  );
  setGenerationLimit(typeof data.generation_limit === "number" ? data.generation_limit : 5);
};

useEffect(() => {
  if (!user) return;

  fetchUsage().catch((e) => console.error("Usage fetch failed:", e));
}, [user]);

  const handleEvaluate = async () => {
  if (!user) return alert("Sign in to run a PR readiness check");
  if (!prompt.trim()) return alert("Add your announcement first");

  setIsEvaluating(true);
  setVerdict("");
  setOutput("");

  try {
    const headers = await getApiHeaders();

    const res = await fetch("/api/evaluate", {
      method: "POST",
      headers,
      body: JSON.stringify({
        announcement: prompt,
        stage: "Seed",
        market,
        geo: "TBD",
        funding,
        backers: "TBD",
        partners,
      }),
    });

    const data = await res.json();

      if (!res.ok) {
        const message =
          data?.error === "Evaluation could not be saved"
            ? "Evaluation could not be saved. Please try again before generating a press release."
            : data?.error ?? "Evaluation failed";

        return alert(message);
      }

      if (!data.id) {
        return alert("Evaluation could not be saved. Please try again before generating a press release.");
      }

      setEvalData(data);
      setVerdict(data.verdict ?? "");

      fetchHistory().catch((e) => console.error("History refresh failed:", e));

  } catch (e) {
    console.error(e);
    alert(e instanceof Error && e.message === "Authentication required" ? "Sign in to run a PR readiness check" : "Evaluation failed");
  } finally {
    setIsEvaluating(false);
  }
  };

  const handleSubmit = async () => {
    if (!user) return alert("Sign in to generate a press release");
    if (!evalData) return alert("Run PR Readiness Check first");
    if (!(verdict === "GO" || verdict === "CONDITIONAL")) {
      return alert("PR Readiness Verdict is NO-GO. Generation is blocked.");
  }
    if (!evalData.id) {
      return alert("Evaluation was not saved, so generation cannot run. Please run the readiness check again.");
    }
    if (remainingGenerations !== null && remainingGenerations <= 0) {
      return alert(`You’ve used all ${generationLimit} free generations`);
    }

  setIsGenerating(true);
  try {
    const headers = await getApiHeaders();

    const res = await fetch('/api/generate', {

      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt,
        evaluation_id: evalData?.id ?? null,
  }),
    });

    const data = await res.json();

    if (!res.ok) {
      return alert(data?.error ?? "Generation failed");
    }

    if (typeof data.response !== "string" || data.response.length === 0) {
      return alert("Generation returned no draft");
    }

    setOutput(data.response);
    if (typeof data.remaining_generations === "number") {
      setRemainingGenerations(data.remaining_generations);
    }
    fetchHistory().catch((e) => console.error("History refresh failed:", e));

  } catch (e) {
    console.error(e);
    alert(e instanceof Error && e.message === "Authentication required" ? "Sign in to generate a press release" : "Generation failed");
  } finally {
    setIsGenerating(false);
  }
  };

  const copyOutput = async () => {
    if (!output) return;

    try {
      await navigator.clipboard.writeText(output);
      setCopiedOutput(true);
      window.setTimeout(() => setCopiedOutput(false), 1800);
    } catch (e) {
      console.error("Copy failed:", e);
      alert("Could not copy the draft");
    }
  };

  const verdictLabel = verdict || "Not evaluated";
  const verdictClass =
    verdict === "GO" ? "go" : verdict === "CONDITIONAL" ? "conditional" : verdict === "NO-GO" ? "nogo" : "neutral";
  const canGenerate = Boolean(user && evalData?.id && (verdict === "GO" || verdict === "CONDITIONAL"));
  const generationStatus = !user
    ? "Sign in to generate after a readiness check."
    : !evalData
    ? "Run and save a readiness evaluation before generating copy."
    : verdict === "NO-GO"
    ? "Generation is blocked because this evaluation is NO-GO."
    : verdict === "GO" || verdict === "CONDITIONAL"
    ? "Generation is available for this saved evaluation."
    : "Run a readiness evaluation before generating copy.";


  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">PR readiness operator</p>
          <h1>PR Copilot</h1>
          <p className="tagline">
            Evaluate whether an announcement deserves media attention before drafting the release.
          </p>
        </div>

        <div className="account-panel">
          {user ? (
            <>
              <span className="account-label">Signed in</span>
              <strong>{user.email}</strong>
              <button className="button secondary small" onClick={logout}>Log out</button>
            </>
          ) : (
            <>
              <span className="account-label">Authentication required</span>
              <div className="login-actions">
                <button className="button primary small" onClick={() => login("github")}>
                  Continue with GitHub
                </button>
                <button className="button secondary small" onClick={() => login("google")}>
                  Continue with Google
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <section className="workbench">
        <div className="primary-column">
          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Step 1</p>
                <h2>Readiness assessment</h2>
              </div>
              <span className="subtle-status">{user ? "Ready to evaluate" : "Sign in required"}</span>
            </div>

            <p className="section-copy">
              Describe the announcement as you would brief a PR lead. Include the market, proof points,
              named partners, measurable outcomes, and any constraints a journalist would question.
            </p>

            <div className="field-grid">
              <label>
                <span>Market</span>
                <input value={market} onChange={(e) => setMarket(e.target.value)} />
              </label>

              <label>
                <span>Partners / customers</span>
                <input value={partners} onChange={(e) => setPartners(e.target.value)} />
              </label>

              <label>
                <span>Funding</span>
                <input value={funding} onChange={(e) => setFunding(e.target.value)} />
              </label>
            </div>

            <label className="brief-field">
              <span>Announcement brief</span>
              <textarea
                rows={8}
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="Example: We are announcing a named customer pilot with measured results, approved customer quote, target geography, and launch timing..."
              />
            </label>

            <div className="action-row">
              <button className="button primary" onClick={handleEvaluate} disabled={isEvaluating || !user}>
                {isEvaluating ? "Evaluating..." : "Run PR Readiness Check"}
              </button>
              <span className="helper-text">
                Evaluation must be saved before generation is available.
              </span>
            </div>
          </section>

          <section className={`panel verdict-panel ${verdictClass}`}>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Step 2</p>
                <h2>Editorial judgment</h2>
              </div>
              <span className={`verdict-badge ${verdictClass}`}>{verdictLabel}</span>
            </div>

            {!evalData ? (
              <p className="empty-state">
                Run a readiness check to see the verdict, journalist reaction, failure modes, and next actions.
              </p>
            ) : (
              <>
                {evalData.journalist_reaction && (
                  <div className="judgment-block">
                    <span>Likely journalist reaction</span>
                    <p>{evalData.journalist_reaction}</p>
                  </div>
                )}

                {evalData.recommendation?.summary && (
                  <div className="judgment-block">
                    <span>Recommendation</span>
                    <p>{evalData.recommendation.summary}</p>
                  </div>
                )}

                <div className="result-grid">
                  {Array.isArray(evalData.primary_failure_modes) &&
                    evalData.primary_failure_modes.length > 0 && (
                      <div>
                        <h3>Primary failure modes</h3>
                        <ul className="clean-list">
                          {evalData.primary_failure_modes.slice(0, 6).map((x: string, i: number) => (
                            <li key={i}>{x}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                  {Array.isArray(evalData.recommendation?.next_actions) &&
                    evalData.recommendation.next_actions.length > 0 && (
                      <div>
                        <h3>Next actions</h3>
                        <ol className="action-list">
                          {evalData.recommendation.next_actions.slice(0, 3).map((x: string, i: number) => (
                            <li key={i}>{x}</li>
                          ))}
                        </ol>
                      </div>
                    )}
                </div>

              </>
            )}
          </section>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Step 3</p>
                <h2>Draft generation</h2>
              </div>
              <span className="subtle-status">
                {user
                  ? remainingGenerations === null
                    ? "Checking usage"
                    : `${remainingGenerations} of ${generationLimit} free remaining`
                  : "Sign in to view usage"}
              </span>
            </div>

            <p className="section-copy">{generationStatus}</p>

            <div className="action-row">
              <button
                className="button primary"
                onClick={handleSubmit}
                disabled={isGenerating || !canGenerate}
              >
                {isGenerating ? "Generating..." : "Generate Press Release"}
              </button>
            </div>

            {output ? (
              <div className="output-card">
                <div className="output-header">
                  <h3>Generated draft</h3>
                  <button className="button secondary small" onClick={copyOutput}>
                    {copiedOutput ? "Copied" : "Copy"}
                  </button>
                </div>
                <pre>{output}</pre>
              </div>
            ) : (
              <p className="empty-state compact">
                Approved or conditional evaluations can produce a draft here.
              </p>
            )}
          </section>
        </div>

        <aside className="history-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Saved work</p>
              <h2>Recent evaluations</h2>
            </div>
          </div>

          {history.length === 0 && (
            <p className="empty-state compact">
              No saved evaluations yet. Completed checks will appear here.
            </p>
          )}

          <div className="history-list">
            {history.map((item) => (
              <button
                className="history-item"
                key={item.id}
                onClick={async () => {
                  const savedEvaluation = item.evaluation_json?.risk_breakdown
                    ? item.evaluation_json
                    : item.evaluation_json?.raw ?? null;

                  setEvalData(savedEvaluation ? { id: item.id, ...savedEvaluation } : { id: item.id });
                  setVerdict(item.verdict ?? "");
                  setPrompt(item.announcement ?? "");
                  setMarket(item.market ?? "");
                  setPartners(item.partners ?? "");
                  setFunding(item.funding ?? "");

                  setOutput(item.latest_generation?.output ?? "");
                }}
              >
                <span className={`mini-verdict ${item.verdict === "GO" ? "go" : item.verdict === "CONDITIONAL" ? "conditional" : "nogo"}`}>
                  {item.verdict}
                </span>
                <span className="history-title">{item.announcement?.slice(0, 86)}...</span>
                <span className="history-meta">
                  {item.generations && item.generations.length > 0 ? "Draft generated" : "Evaluation only"}
                </span>
              </button>
            ))}
          </div>
        </aside>
      </section>

      <style jsx>{`
        :global(body) {
          margin: 0;
          background: #f5f5f2;
          color: #171717;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        :global(*) {
          box-sizing: border-box;
        }

        .app-shell {
          min-height: 100vh;
          padding: 32px;
        }

        .topbar {
          max-width: 1180px;
          margin: 0 auto 28px;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 24px;
        }

        .eyebrow {
          margin: 0 0 8px;
          color: #76736b;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0;
          text-transform: uppercase;
        }

        h1,
        h2,
        h3,
        p {
          letter-spacing: 0;
        }

        h1 {
          margin: 0;
          font-size: clamp(34px, 5vw, 56px);
          line-height: 1;
          font-weight: 760;
        }

        h2 {
          margin: 0;
          font-size: 22px;
          line-height: 1.2;
        }

        h3 {
          margin: 0 0 12px;
          font-size: 14px;
          line-height: 1.35;
          color: #34332f;
        }

        .tagline {
          max-width: 640px;
          margin: 14px 0 0;
          color: #56534c;
          font-size: 18px;
          line-height: 1.5;
        }

        .account-panel,
        .panel,
        .history-panel {
          border: 1px solid #dedbd2;
          background: rgba(255, 255, 255, 0.86);
          box-shadow: 0 18px 50px rgba(35, 34, 30, 0.08);
        }

        .account-panel {
          min-width: 250px;
          padding: 16px;
          border-radius: 8px;
          display: grid;
          gap: 8px;
          justify-items: start;
        }

        .login-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .account-label,
        .subtle-status,
        .helper-text,
        .history-meta {
          color: #77736a;
          font-size: 13px;
          line-height: 1.4;
        }

        .workbench {
          max-width: 1180px;
          margin: 0 auto;
          display: grid;
          grid-template-columns: minmax(0, 1fr) 340px;
          gap: 22px;
          align-items: start;
        }

        .primary-column {
          display: grid;
          gap: 22px;
        }

        .panel,
        .history-panel {
          border-radius: 8px;
          padding: 24px;
        }

        .section-heading {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 18px;
        }

        .section-copy {
          margin: -4px 0 22px;
          color: #57534a;
          font-size: 15px;
          line-height: 1.65;
        }

        .field-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 14px;
          margin-bottom: 16px;
        }

        label {
          display: grid;
          gap: 8px;
          color: #34332f;
          font-size: 13px;
          font-weight: 650;
        }

        input,
        textarea {
          width: 100%;
          border: 1px solid #d7d3c8;
          border-radius: 8px;
          background: #fff;
          color: #171717;
          font: inherit;
          font-size: 15px;
          line-height: 1.5;
          outline: none;
          transition: border-color 140ms ease, box-shadow 140ms ease;
        }

        input {
          min-height: 44px;
          padding: 10px 12px;
        }

        textarea {
          min-height: 190px;
          padding: 14px;
          resize: vertical;
        }

        input:focus,
        textarea:focus {
          border-color: #2f5d50;
          box-shadow: 0 0 0 3px rgba(47, 93, 80, 0.14);
        }

        .action-row {
          margin-top: 18px;
          display: flex;
          align-items: center;
          gap: 14px;
          flex-wrap: wrap;
        }

        .button {
          border: 1px solid transparent;
          border-radius: 8px;
          min-height: 44px;
          padding: 0 16px;
          font: inherit;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          transition: transform 140ms ease, background 140ms ease, border-color 140ms ease, opacity 140ms ease;
        }

        .button:hover:not(:disabled) {
          transform: translateY(-1px);
        }

        .button:disabled {
          cursor: not-allowed;
          opacity: 0.48;
        }

        .button.primary {
          background: #1f2d2a;
          color: #fff;
        }

        .button.secondary {
          background: #fff;
          border-color: #d7d3c8;
          color: #24231f;
        }

        .button.tertiary {
          min-height: 38px;
          padding: 0;
          background: transparent;
          color: #2f5d50;
        }

        .button.small {
          min-height: 36px;
          padding: 0 12px;
          font-size: 13px;
        }

        .verdict-panel {
          border-top: 4px solid #c9c5bb;
        }

        .verdict-panel.go {
          border-top-color: #2f6f58;
        }

        .verdict-panel.conditional {
          border-top-color: #9d741b;
        }

        .verdict-panel.nogo {
          border-top-color: #9b332d;
        }

        .verdict-badge,
        .mini-verdict {
          border-radius: 999px;
          padding: 7px 11px;
          font-size: 12px;
          font-weight: 800;
          line-height: 1;
          white-space: nowrap;
        }

        .verdict-badge.neutral {
          background: #eeece6;
          color: #57534a;
        }

        .verdict-badge.go,
        .mini-verdict.go {
          background: #dceee5;
          color: #214f3f;
        }

        .verdict-badge.conditional,
        .mini-verdict.conditional {
          background: #f3e7ca;
          color: #6f4d08;
        }

        .verdict-badge.nogo,
        .mini-verdict.nogo {
          background: #f2d8d5;
          color: #7b2520;
        }

        .judgment-block {
          padding: 18px;
          border: 1px solid #e1ded5;
          border-radius: 8px;
          background: #fbfaf7;
          margin-bottom: 14px;
        }

        .judgment-block span {
          display: block;
          margin-bottom: 8px;
          color: #76736b;
          font-size: 12px;
          font-weight: 800;
          text-transform: uppercase;
        }

        .judgment-block p {
          margin: 0;
          color: #24231f;
          font-size: 17px;
          line-height: 1.58;
        }

        .result-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
          margin-top: 18px;
        }

        .clean-list,
        .action-list {
          margin: 0;
          padding-left: 20px;
          color: #44413a;
          line-height: 1.55;
        }

        .clean-list li,
        .action-list li {
          margin-bottom: 9px;
        }

        .output-card {
          margin-top: 20px;
          border: 1px solid #dedbd2;
          border-radius: 8px;
          background: #fff;
          overflow: hidden;
        }

        .output-header {
          padding: 14px 16px;
          border-bottom: 1px solid #ebe8e0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .output-header h3 {
          margin: 0;
        }

        pre {
          margin: 0;
          padding: 18px;
          white-space: pre-wrap;
          color: #24231f;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 14px;
          line-height: 1.7;
        }

        .empty-state {
          margin: 0;
          padding: 18px;
          border: 1px dashed #d8d3c8;
          border-radius: 8px;
          background: #fbfaf7;
          color: #6d685f;
          line-height: 1.55;
        }

        .empty-state.compact {
          padding: 14px;
          font-size: 14px;
        }

        .history-panel {
          position: sticky;
          top: 22px;
        }

        .history-list {
          display: grid;
          gap: 10px;
        }

        .history-item {
          width: 100%;
          border: 1px solid #e1ded5;
          border-radius: 8px;
          padding: 14px;
          background: #fff;
          text-align: left;
          cursor: pointer;
          display: grid;
          gap: 10px;
          transition: border-color 140ms ease, transform 140ms ease, box-shadow 140ms ease;
        }

        .history-item:hover {
          border-color: #b9b3a6;
          transform: translateY(-1px);
          box-shadow: 0 10px 24px rgba(35, 34, 30, 0.08);
        }

        .history-title {
          color: #24231f;
          font-size: 14px;
          line-height: 1.45;
        }

        .mini-verdict {
          justify-self: start;
          padding: 6px 9px;
        }

        @media (max-width: 900px) {
          .app-shell {
            padding: 20px;
          }

          .topbar,
          .workbench {
            grid-template-columns: 1fr;
          }

          .topbar {
            display: grid;
          }

          .account-panel {
            width: 100%;
          }

          .field-grid,
          .result-grid {
            grid-template-columns: 1fr;
          }

          .history-panel {
            position: static;
          }
        }

        @media (max-width: 560px) {
          .app-shell {
            padding: 14px;
          }

          .panel,
          .history-panel {
            padding: 18px;
          }

          .section-heading {
            display: grid;
          }

          .tagline {
            font-size: 16px;
          }
        }
      `}</style>
    </main>
  );
}
