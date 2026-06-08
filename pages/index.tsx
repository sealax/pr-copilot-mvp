import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Header } from '../components/ui/Header';
import { PageContainer } from '../components/ui/PageContainer';

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
  const [generationLimit, setGenerationLimit] = useState(10);

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
  setGenerationLimit(typeof data.generation_limit === "number" ? data.generation_limit : 10);
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
      <Header
        eyebrow="PR readiness operator"
        title="PR Copilot"
        description="Evaluate whether an announcement deserves media attention before drafting the release."
        actions={
          <Card className="account-panel">
            {user ? (
              <>
                <span className="account-label">Signed in</span>
                <strong>{user.email}</strong>
                <Button variant="secondary" size="small" onClick={logout}>
                  Log out
                </Button>
              </>
            ) : (
              <>
                <span className="account-label">Authentication required</span>
                <div className="login-actions">
                  <Button size="small" onClick={() => login("github")}>
                    Continue with GitHub
                  </Button>
                  <Button variant="secondary" size="small" onClick={() => login("google")}>
                    Continue with Google
                  </Button>
                </div>
              </>
            )}
          </Card>
        }
      />

      <PageContainer className="workbench">
        <div className="primary-column">
          <Card as="section" className="panel">
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
              <Button onClick={handleEvaluate} disabled={isEvaluating || !user}>
                {isEvaluating ? "Evaluating..." : "Run PR Readiness Check"}
              </Button>
              <span className="helper-text">
                Evaluation must be saved before generation is available.
              </span>
            </div>
          </Card>

          <Card as="section" className={`panel verdict-panel ${verdictClass}`}>
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
          </Card>

          <Card as="section" className="panel">
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
              <Button
                onClick={handleSubmit}
                disabled={isGenerating || !canGenerate}
              >
                {isGenerating ? "Generating..." : "Generate Press Release"}
              </Button>
            </div>

            {output ? (
              <div className="output-card">
                <div className="output-header">
                  <h3>Generated draft</h3>
                  <Button variant="secondary" size="small" onClick={copyOutput}>
                    {copiedOutput ? "Copied" : "Copy"}
                  </Button>
                </div>
                <pre>{output}</pre>
              </div>
            ) : (
              <p className="empty-state compact">
                Approved or conditional evaluations can produce a draft here.
              </p>
            )}
          </Card>
        </div>

        <Card as="aside" className="history-panel">
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
        </Card>
      </PageContainer>
    </main>
  );
}
