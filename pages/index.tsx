import { useState, useEffect } from 'react';
import Head from 'next/head';
import { createClient } from '@supabase/supabase-js';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
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
    <>
      <Head>
        <title>PR Copilot | Test your story before you pitch it</title>
        <meta
          name="description"
          content="Evaluate whether an announcement is newsworthy, improve the media angle, and generate a press-ready draft."
        />
      </Head>

      <main className="app-shell">
      <nav className="marketing-nav" aria-label="Primary navigation">
        <PageContainer className="marketing-nav-inner">
          <a className="wordmark" href="#top" aria-label="PR Copilot home">
            <span className="wordmark-mark">PR</span>
            <span>PR Copilot</span>
          </a>

          <div className="nav-links">
            <a href="#how-it-works">How it works</a>
            <a href="#features">Capabilities</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </div>

          <div className="nav-account">
            {user ? (
              <>
                <span className="nav-user">{user.email}</span>
                <Button variant="secondary" size="small" onClick={logout}>
                  Log out
                </Button>
              </>
            ) : (
              <>
                <Button variant="tertiary" size="small" onClick={() => login("google")}>
                  Sign in with Google
                </Button>
                <Button size="small" onClick={() => login("github")}>
                  Start with GitHub
                </Button>
              </>
            )}
          </div>
        </PageContainer>
      </nav>

      <section className="hero-section" id="top">
        <PageContainer className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">Editorial judgment before amplification</p>
            <h1>
              PR Copilot helps founders and comms teams test whether a story is newsworthy,
              improve the angle, and generate press-ready pitches.
            </h1>
            <p className="hero-description">
              Put the announcement under editorial pressure before you spend time drafting,
              pitching, or asking journalists to care.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="#workspace">
                Evaluate your announcement
              </a>
              <a className="button button-secondary" href="#how-it-works">
                See how it works
              </a>
            </div>
            <p className="hero-note">
              Structured PR assessment. Clear next actions. Drafting only when the story is ready.
            </p>
          </div>

          <Card className="hero-evaluation">
            <div className="hero-card-header">
              <div>
                <p className="eyebrow">Sample readiness view</p>
                <h2>Series A expansion announcement</h2>
              </div>
              <span className="verdict-badge conditional">Conditional</span>
            </div>

            <div className="signal-list">
              <div className="signal-row">
                <span>News value</span>
                <strong>Needs a sharper market consequence</strong>
              </div>
              <div className="signal-row">
                <span>Evidence</span>
                <strong>Named customer proof is missing</strong>
              </div>
              <div className="signal-row">
                <span>Timing</span>
                <strong>Credible, but not yet urgent</strong>
              </div>
            </div>

            <div className="hero-recommendation">
              <span>Operator recommendation</span>
              <p>Strengthen the proof point and lead with what changes for the market, not the funding event.</p>
            </div>
          </Card>
        </PageContainer>
      </section>

      <section className="workflow-section" id="how-it-works">
        <PageContainer>
          <div className="marketing-section-heading">
            <div>
              <p className="eyebrow">A disciplined workflow</p>
              <h2>Evaluation comes before generation.</h2>
            </div>
            <p>
              PR Copilot applies editorial pressure before it writes. Weak announcements are challenged,
              viable stories are improved, and drafting stays gated by the verdict.
            </p>
          </div>

          <div className="workflow-steps">
            <article>
              <span>01</span>
              <h3>Brief the announcement</h3>
              <p>Add the market context, proof points, partners, funding, and the claim you want to make.</p>
            </article>
            <article>
              <span>02</span>
              <h3>Get an editorial verdict</h3>
              <p>See the likely journalist reaction, primary failure modes, and concrete next actions.</p>
            </article>
            <article>
              <span>03</span>
              <h3>Draft only when ready</h3>
              <p>GO and CONDITIONAL evaluations can move into generation. NO-GO announcements cannot.</p>
            </article>
          </div>
        </PageContainer>
      </section>

      <section className="features-section" id="features">
        <PageContainer>
          <div className="marketing-section-heading compact-heading">
            <div>
              <p className="eyebrow">Built for better PR decisions</p>
              <h2>From raw announcement to credible media angle.</h2>
            </div>
          </div>

          <div className="feature-grid">
            <Card as="article" className="feature-card">
              <span className="feature-index">01</span>
              <h3>PR readiness evaluation</h3>
              <p>Test the strength, evidence, relevance, and timing of an announcement before outreach begins.</p>
            </Card>
            <Card as="article" className="feature-card">
              <span className="feature-index">02</span>
              <h3>Media angle generation</h3>
              <p>Identify the strongest editorial frame instead of defaulting to company-centric messaging.</p>
            </Card>
            <Card as="article" className="feature-card">
              <span className="feature-index">03</span>
              <h3>Pitch drafting</h3>
              <p>Generate a working press draft only after the underlying story clears the readiness gate.</p>
            </Card>
            <Card as="article" className="feature-card">
              <span className="feature-index">04</span>
              <h3>Next-action recommendations</h3>
              <p>Turn weaknesses into a practical list of proof, positioning, and timing improvements.</p>
            </Card>
          </div>
        </PageContainer>
      </section>

      <section className="proof-section" aria-labelledby="proof-heading">
        <PageContainer>
          <div className="marketing-section-heading">
            <div>
              <p className="eyebrow">Early access</p>
              <h2 id="proof-heading">Proof should be earned, not invented.</h2>
            </div>
            <p>
              Verified founder feedback, customer quotes, and usage milestones will appear here as the
              early-access programme develops.
            </p>
          </div>

          <div className="proof-grid">
            <div>
              <span>Founder feedback</span>
              <strong>Reserved for a verified customer quote</strong>
            </div>
            <div>
              <span>Usage signal</span>
              <strong>Reserved for a measured product milestone</strong>
            </div>
            <div>
              <span>Team outcome</span>
              <strong>Reserved for a documented PR result</strong>
            </div>
          </div>
        </PageContainer>
      </section>

      <section className="comparison-section" id="why-pr-copilot">
        <PageContainer className="comparison-layout">
          <div className="comparison-intro">
            <p className="eyebrow">Purpose-built PR judgment</p>
            <h2>Why not just use ChatGPT?</h2>
            <p>
              A general-purpose model can help write copy. PR Copilot is designed to decide whether
              the story deserves to be written in the first place.
            </p>
          </div>

          <div className="comparison-table" role="table" aria-label="ChatGPT and PR Copilot comparison">
            <div className="comparison-header" role="row">
              <span role="columnheader">What the workflow needs</span>
              <span role="columnheader">General-purpose AI</span>
              <span role="columnheader">PR Copilot</span>
            </div>
            <div className="comparison-row" role="row">
              <strong role="cell">A repeatable process</strong>
              <span role="cell">Depends on the prompt you create</span>
              <span role="cell">Guides every announcement through a structured PR workflow</span>
            </div>
            <div className="comparison-row" role="row">
              <strong role="cell">Editorial judgment</strong>
              <span role="cell">Optimises for a helpful response</span>
              <span role="cell">Returns a clear GO, CONDITIONAL, or NO-GO verdict</span>
            </div>
            <div className="comparison-row" role="row">
              <strong role="cell">Weak-story handling</strong>
              <span role="cell">Can polish the premise it is given</span>
              <span role="cell">Surfaces failure modes and blocks unsafe generation</span>
            </div>
            <div className="comparison-row" role="row">
              <strong role="cell">Actionable direction</strong>
              <span role="cell">Requires follow-up prompting</span>
              <span role="cell">Provides journalist reaction and specific next actions</span>
            </div>
          </div>
        </PageContainer>
      </section>

      <section className="pricing-section" id="pricing" aria-labelledby="pricing-heading">
        <PageContainer>
          <div className="marketing-section-heading">
            <div>
              <p className="eyebrow">Simple plans</p>
              <h2 id="pricing-heading">Start with one story. Scale to a team workflow.</h2>
            </div>
            <p>
              Indicative pricing for planned subscriptions. Billing is not yet enabled during early access.
            </p>
          </div>

          <div className="pricing-grid">
            <Card as="article" className="pricing-card">
              <div>
                <p className="pricing-name">Free</p>
                <p className="pricing-price">
                  <strong>£0</strong>
                  <span>forever</span>
                </p>
                <p className="pricing-description">For testing a small number of announcements.</p>
              </div>
              <ul className="pricing-features">
                <li>5 evaluations</li>
                <li>Basic pitch generation</li>
              </ul>
              <a className="button button-secondary" href="#workspace">
                Start evaluating
              </a>
            </Card>

            <Card as="article" className="pricing-card pricing-card-featured">
              <div className="pricing-card-topline">
                <p className="pricing-name">Pro</p>
                <span>Most popular</span>
              </div>
              <div>
                <p className="pricing-price">
                  <strong>£29</strong>
                  <span>/ month</span>
                </p>
                <p className="pricing-description">For founders and comms leads running regular outreach.</p>
              </div>
              <ul className="pricing-features">
                <li>Unlimited evaluations</li>
                <li>Advanced recommendations</li>
                <li>Saved history</li>
              </ul>
              <span className="button button-primary pricing-placeholder">Coming soon</span>
            </Card>

            <Card as="article" className="pricing-card">
              <div>
                <p className="pricing-name">Team</p>
                <p className="pricing-price">
                  <strong>£79</strong>
                  <span>/ month</span>
                </p>
                <p className="pricing-description">For teams coordinating multiple campaigns.</p>
              </div>
              <ul className="pricing-features">
                <li>Multiple users</li>
                <li>Shared campaigns</li>
                <li>Team workspace</li>
              </ul>
              <span className="button button-secondary pricing-placeholder">Coming soon</span>
            </Card>
          </div>
        </PageContainer>
      </section>

      <section className="workspace-intro">
        <PageContainer>
          <p className="eyebrow">Try the workflow</p>
          <h2>Put your announcement under editorial pressure.</h2>
          <p>Start with the facts. PR Copilot will assess readiness before any draft is generated.</p>
        </PageContainer>
      </section>

      <PageContainer className="workbench" id="workspace">
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

      <section className="faq-section" id="faq">
        <PageContainer className="faq-layout">
          <div>
            <p className="eyebrow">Questions, answered</p>
            <h2>What teams need to know before they start.</h2>
          </div>

          <div className="faq-list">
            <details>
              <summary>Who is PR Copilot for?</summary>
              <p>
                Founders, in-house comms teams, and operators who need to decide whether an announcement
                is strong enough for media outreach before investing time in a full campaign.
              </p>
            </details>
            <details>
              <summary>Why not just use ChatGPT?</summary>
              <p>
                PR Copilot follows a structured evaluation-first workflow. It gives an editorial verdict,
                surfaces failure modes, and blocks drafting when the announcement is not ready.
              </p>
            </details>
            <details>
              <summary>Do I need PR experience?</summary>
              <p>
                No. The assessment explains what a journalist is likely to challenge and turns that judgment
                into specific actions you can take.
              </p>
            </details>
            <details>
              <summary>How many pitches can I generate?</summary>
              <p>
                The current free allowance is shown inside the workspace when you sign in. Generation is
                available only for saved GO or CONDITIONAL evaluations.
              </p>
            </details>
          </div>
        </PageContainer>
      </section>

      <footer className="site-footer">
        <PageContainer>
          <a className="wordmark" href="#top">
            <span className="wordmark-mark">PR</span>
            <span>PR Copilot</span>
          </a>
          <p>Editorial judgment before press release generation.</p>
        </PageContainer>
      </footer>
      </main>
    </>
  );
}
