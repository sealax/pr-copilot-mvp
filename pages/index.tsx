import { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import { createClient } from '@supabase/supabase-js';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { PageContainer } from '../components/ui/PageContainer';
import {
  clearPendingDemoResult,
  readPendingDemoResult,
  writePendingDemoResult,
  type PendingDemoResult,
} from '../lib/demoResult';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ADMIN_USAGE_SENTINEL = -1;

const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

export default function Home() {
  const [prompt, setPrompt] = useState('');
  const [output, setOutput] = useState('');
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [remainingGenerations, setRemainingGenerations] = useState<number | null>(null);
  const [generationLimit, setGenerationLimit] = useState(5);
  const [remainingDemoChecks, setRemainingDemoChecks] = useState(2);
  const [remainingDemoDrafts, setRemainingDemoDrafts] = useState(1);

  const [verdict, setVerdict] = useState<"GO" | "CONDITIONAL" | "NO-GO" | "">("");
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedOutput, setCopiedOutput] = useState(false);
  const [demoSaveNotice, setDemoSaveNotice] = useState<{
    type: "success" | "warning";
    message: string;
  } | null>(null);
  const demoImportInFlight = useRef(false);

  const [market, setMarket] = useState("Fintech compliance");
  const [funding, setFunding] = useState("$3M seed");
  const [partners, setPartners] = useState("AcmePay (regulated UK fintech)");

  const [evalData, setEvalData] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);

useEffect(() => {
  if (!supabase) {
    setAuthReady(true);
    return;
  }

  supabase.auth.getUser().then(({ data }) => {
    setUser(data?.user ?? null);
    setAuthReady(true);
  });
}, []);

const fetchHistory = async () => {
  if (!supabase || !user) return;

    const headers = await getApiHeaders(true);
    const res = await fetch("/api/history", { headers });
    const data = await res.json();

    if (!res.ok) {
      console.error("History API error:", data);
      return;
    }

    setHistory(Array.isArray(data.history) ? data.history : []);
  };

const createImportId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
};

const persistDemoResult = (
  evaluation: any,
  draft?: string,
  existingImportId?: string
) => {
  const result: PendingDemoResult = {
    version: 1,
    importId: existingImportId || createImportId(),
    source: "anonymous_demo",
    timestamp: new Date().toISOString(),
    announcement: prompt,
    market,
    partners,
    funding,
    evaluation: {
      verdict: evaluation.verdict,
      risk_score: evaluation.risk_score,
      risk_breakdown: evaluation.risk_breakdown,
      primary_failure_modes: evaluation.primary_failure_modes,
      journalist_reaction: evaluation.journalist_reaction,
      recommendation: evaluation.recommendation,
    },
    ...(draft ? { draft } : {}),
  };

  try {
    writePendingDemoResult(result);
    return result;
  } catch (error) {
    console.error("Could not preserve demo result:", error);
    setDemoSaveNotice({
      type: "warning",
      message: "Your demo result could not be prepared for account saving in this browser.",
    });
    return null;
  }
};

useEffect(() => {
  if (!user) return;

  fetchHistory();
}, [user]);

useEffect(() => {
  if (!user || demoImportInFlight.current) return;

  const pendingResult = readPendingDemoResult();

  if (!pendingResult) return;

  demoImportInFlight.current = true;

  const importDemoResult = async () => {
    try {
      const headers = await getApiHeaders(true);
      const res = await fetch("/api/import-demo", {
        method: "POST",
        headers,
        body: JSON.stringify(pendingResult),
      });
      const data = await res.json();

      if (!res.ok || !data?.saved) {
        throw new Error(data?.error ?? "Could not save demo result");
      }

      clearPendingDemoResult(pendingResult.importId);
      setDemoSaveNotice({
        type: "success",
        message: "Your demo result has been saved to your account.",
      });
      await fetchHistory();
    } catch (error) {
      console.error("Demo result import failed:", error);
      setDemoSaveNotice({
        type: "warning",
        message: "We could not save your demo result yet. Your account is ready and we will retry after refresh.",
      });
    } finally {
      demoImportInFlight.current = false;
    }
  };

  importDemoResult();
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

const getApiHeaders = async (requireAuth = false) => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (!supabase) {
    if (requireAuth) throw new Error("Authentication required");
    return headers;
  }

  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  if (!accessToken) {
    if (requireAuth) throw new Error("Authentication required");
    return headers;
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

  if (data.demo) {
    setRemainingDemoChecks(
      typeof data.remainingChecks === "number" ? data.remainingChecks : 2
    );
    setRemainingDemoDrafts(
      typeof data.remainingDrafts === "number" ? data.remainingDrafts : 1
    );
    return;
  }

  setRemainingGenerations(
    typeof data.remaining_generations === "number" ? data.remaining_generations : null
  );
  setGenerationLimit(typeof data.generation_limit === "number" ? data.generation_limit : 5);
};

useEffect(() => {
  if (!authReady) return;

  fetchUsage().catch((e) => console.error("Usage fetch failed:", e));
}, [user, authReady]);

  const isAdminMode = Boolean(
    user &&
      (remainingGenerations === ADMIN_USAGE_SENTINEL ||
        generationLimit === ADMIN_USAGE_SENTINEL)
  );

  const handleEvaluate = async () => {
  if (!authReady) return;
  if (!prompt.trim()) return alert("Add your announcement first");
  if (!user && remainingDemoChecks <= 0) {
    return alert("You've used both free demo evaluations. Create a free account to continue.");
  }

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
        if (typeof data.remainingChecks === "number") {
          setRemainingDemoChecks(data.remainingChecks);
        }
        if (typeof data.remainingDrafts === "number") {
          setRemainingDemoDrafts(data.remainingDrafts);
        }

        const message =
          data?.error === "Evaluation could not be saved"
            ? "Evaluation could not be saved. Please try again before generating a press release."
            : data?.error ?? "Evaluation failed";

        return alert(message);
      }

      if (user && !data.id) {
        return alert("Evaluation could not be saved. Please try again before generating a press release.");
      }

      let nextEvalData = data;

      if (!user) {
        const pendingResult = persistDemoResult(data);

        if (pendingResult) {
          nextEvalData = {
            ...data,
            demoImportId: pendingResult.importId,
          };
        }
      }

      setEvalData(nextEvalData);
      setVerdict(data.verdict ?? "");
      if (typeof data.remainingChecks === "number") {
        setRemainingDemoChecks(data.remainingChecks);
      }
      if (typeof data.remainingDrafts === "number") {
        setRemainingDemoDrafts(data.remainingDrafts);
      }

      if (user) {
        fetchHistory().catch((e) => console.error("History refresh failed:", e));
      }

  } catch (e) {
    console.error(e);
    alert("Evaluation failed");
  } finally {
    setIsEvaluating(false);
  }
  };

  const handleSubmit = async () => {
    if (!authReady) return;
    if (!evalData) return alert("Run PR Readiness Check first");
    if (!(verdict === "GO" || verdict === "CONDITIONAL")) {
      return alert("PR Readiness Verdict is NO-GO. Generation is blocked.");
  }
    if (user && !evalData.id) {
      return alert("Evaluation was not saved, so generation cannot run. Please run the readiness check again.");
    }
    if (!user && !evalData.demoEvaluationToken) {
      return alert("Run a new PR readiness check before generating a demo draft.");
    }
    if (user && !isAdminMode && remainingGenerations !== null && remainingGenerations <= 0) {
      return alert(`You’ve used all ${generationLimit} free generations`);
    }
    if (!user && remainingDemoDrafts <= 0) {
      return alert("You've used your free demo draft. Create a free account to continue.");
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
        demoEvaluationToken: evalData?.demoEvaluationToken ?? null,
  }),
    });

    const data = await res.json();

    if (!res.ok) {
      if (typeof data.remainingChecks === "number") {
        setRemainingDemoChecks(data.remainingChecks);
      }
      if (typeof data.remainingDrafts === "number") {
        setRemainingDemoDrafts(data.remainingDrafts);
      }

      return alert(data?.error ?? "Generation failed");
    }

    if (typeof data.response !== "string" || data.response.length === 0) {
      return alert("Generation returned no draft");
    }

    setOutput(data.response);
    if (!user) {
      persistDemoResult(
        evalData,
        data.response,
        evalData?.demoImportId
      );
    }
    if (typeof data.remaining_generations === "number") {
      setRemainingGenerations(data.remaining_generations);
    }
    if (typeof data.remainingChecks === "number") {
      setRemainingDemoChecks(data.remainingChecks);
    }
    if (typeof data.remainingDrafts === "number") {
      setRemainingDemoDrafts(data.remainingDrafts);
    }
    if (user) {
      fetchHistory().catch((e) => console.error("History refresh failed:", e));
    }

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
  const hasGenerationGate = user ? Boolean(evalData?.id) : Boolean(evalData?.demoEvaluationToken);
  const hasGenerationAllowance = user
    ? isAdminMode || remainingGenerations === null || remainingGenerations > 0
    : remainingDemoDrafts > 0;
  const canGenerate = Boolean(
    hasGenerationGate &&
      hasGenerationAllowance &&
      (verdict === "GO" || verdict === "CONDITIONAL")
  );
  const generationStatus = !evalData
    ? user
      ? "Run and save a readiness evaluation before generating copy."
      : "Run a readiness evaluation before generating your demo draft."
    : verdict === "NO-GO"
    ? "Generation is blocked because this evaluation is NO-GO."
    : verdict === "GO" || verdict === "CONDITIONAL"
    ? user
      ? "Generation is available for this saved evaluation."
      : remainingDemoDrafts > 0
      ? "Your anonymous evaluation can generate one demo draft. It will not be saved."
      : "Your demo draft allowance is complete. Create a free account to continue."
    : "Run a readiness evaluation before generating copy.";
  const demoLimitReached = !user && (remainingDemoChecks <= 0 || remainingDemoDrafts <= 0);
  const demoStatusText =
    remainingDemoChecks === 2 && remainingDemoDrafts === 1
      ? "2 PR checks included · 1 draft generation included"
      : `${remainingDemoChecks} PR ${remainingDemoChecks === 1 ? "check" : "checks"} remaining · ${remainingDemoDrafts} draft ${remainingDemoDrafts === 1 ? "generation" : "generations"} remaining`;


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
            <span className="wordmark-copy">
              <strong>PR Copilot</strong>
              <small>Readiness desk</small>
            </span>
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
                  Create free account
                </Button>
              </>
            )}
          </div>
        </PageContainer>
      </nav>

      <section className="hero-section" id="top">
        <PageContainer className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">The PR readiness desk</p>
            <h1>
              Test the story before you ask the market to care.
            </h1>
            <p className="hero-description">
              PR Copilot gives founders and comms teams a clear editorial verdict, exposes
              evidence gaps, and releases drafting only when the announcement is ready.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="#workspace">
                Try Free PR Check
              </a>
              <Button variant="secondary" onClick={() => login("google")}>
                Create Free Account
              </Button>
            </div>
            <p className="hero-note">
              A structured assessment from brief to verdict to press-release draft.
            </p>
          </div>

          <Card className="hero-evaluation">
            <div className="hero-card-header">
              <div>
                <p className="eyebrow">Sample desk review</p>
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
              <span>Desk recommendation</span>
              <p>Strengthen the proof point and lead with what changes for the market, not the funding event.</p>
            </div>
          </Card>
        </PageContainer>
      </section>

      <section className="workflow-section" id="how-it-works">
        <PageContainer>
          <div className="process-index">
            <div className="process-index-intro">
              <p className="eyebrow">The operating sequence</p>
              <h2>Judgment first. Drafting second.</h2>
            </div>
            <ol className="process-index-list">
              <li>
                <span>01</span>
                <strong>Brief</strong>
                <small>Set out the claim and supporting evidence.</small>
              </li>
              <li>
                <span>02</span>
                <strong>Verdict</strong>
                <small>Test news value, proof, and likely journalist reaction.</small>
              </li>
              <li>
                <span>03</span>
                <strong>Draft</strong>
                <small>Proceed only on a GO or CONDITIONAL judgment.</small>
              </li>
            </ol>
          </div>
        </PageContainer>
      </section>

      <section className="features-section" id="features">
        <PageContainer>
          <div className="capabilities-heading">
            <p className="eyebrow">What the desk delivers</p>
            <h2>PR judgment with a working route forward.</h2>
            <p>
              The product separates the decision to pursue coverage from the work of drafting
              the announcement.
            </p>
          </div>

          <div className="capabilities-layout">
            <article className="capability-lead">
              <span className="feature-index">Core assessment</span>
              <h3>PR readiness evaluation</h3>
              <p>
                Test the strength, evidence, relevance, and timing of an announcement before
                outreach begins.
              </p>
            </article>
            <div className="capability-list">
              <article>
                <span>01</span>
                <div>
                  <h3>Editorial framing guidance</h3>
                  <p>Identify the strongest frame within the assessment without defaulting to company-centric messaging.</p>
                </div>
              </article>
              <article>
                <span>02</span>
                <div>
                  <h3>Next-action recommendations</h3>
                  <p>Turn weaknesses into a practical list of proof, positioning, and timing improvements.</p>
                </div>
              </article>
              <article>
                <span>03</span>
                <div>
                  <h3>Gated press-release drafting</h3>
                  <p>Generate a working press draft only after the underlying story clears the readiness gate.</p>
                </div>
              </article>
            </div>
          </div>
        </PageContainer>
      </section>

      <section className="proof-section" aria-labelledby="proof-heading">
        <PageContainer className="early-access-note">
          <div>
            <p className="eyebrow">Early access principle</p>
            <h2 id="proof-heading">Proof should be earned, not invented.</h2>
          </div>
          <div className="early-access-copy">
            <p>
              PR Copilot will publish founder feedback, customer quotes, and product milestones only
              when they are verified and permissioned.
            </p>
            <span>Until then, the working product is the evidence.</span>
          </div>
        </PageContainer>
      </section>

      <section className="comparison-section" id="why-pr-copilot">
        <PageContainer className="comparison-layout">
          <div className="comparison-intro">
            <p className="eyebrow">Purpose-built PR judgment</p>
            <h2>A writing assistant answers the prompt. PR Copilot tests the premise.</h2>
            <p>
              A general-purpose model can help write copy. PR Copilot is designed to decide whether
              the story deserves to be written in the first place.
            </p>
          </div>

          <div className="comparison-table" role="table" aria-label="ChatGPT and PR Copilot comparison">
            <div className="comparison-header" role="row">
              <span role="columnheader">Editorial question</span>
              <span role="columnheader">General assistant</span>
              <span role="columnheader">PR Copilot desk</span>
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

      <section className="workspace-intro">
        <PageContainer className="workspace-desk-heading">
          <div>
            <p className="eyebrow">PR readiness desk</p>
            <h2>The confidence to know whether an announcement is worth pitching.</h2>
          </div>
          <p>
            Submit the briefing note for editorial assessment. Drafting remains downstream of
            the verdict.
          </p>
        </PageContainer>
      </section>

      {authReady && !user && (
        <PageContainer>
          <div className={`demo-banner workspace-notice ${remainingDemoDrafts <= 0 ? "complete" : ""}`}>
            <div>
              <strong>{remainingDemoDrafts <= 0 ? "Demo Complete" : "Demo Mode"}</strong>
              <span>{demoStatusText}</span>
            </div>
            {remainingDemoChecks <= 0 && remainingDemoDrafts > 0 && (
              <Button variant="tertiary" size="small" onClick={() => login("google")}>
                Create a free account for more evaluations
              </Button>
            )}
          </div>
        </PageContainer>
      )}

      {demoSaveNotice && (
        <PageContainer>
          <div className={`demo-save-notice workspace-notice ${demoSaveNotice.type}`} role="status">
            <span>{demoSaveNotice.message}</span>
            <button
              type="button"
              aria-label="Dismiss message"
              onClick={() => setDemoSaveNotice(null)}
            >
              Close
            </button>
          </div>
        </PageContainer>
      )}

      <PageContainer className="workbench" id="workspace">
        <div className="primary-column">
          {authReady && demoLimitReached && (
            <section className="demo-signup-card workspace-notice">
              <p className="eyebrow">
                {remainingDemoDrafts <= 0 ? "Demo complete" : "Evaluation allowance used"}
              </p>
              <h2>You've used your free demo.</h2>
              <p>Create a free account to:</p>
              <ul className="demo-benefits">
                <li>Run additional PR readiness checks</li>
                <li>Generate more drafts</li>
                <li>Save your evaluations</li>
                <li>Build a launch history</li>
              </ul>
              <Button onClick={() => login("google")}>Create Free Account</Button>
            </section>
          )}

          <section className="workspace-document briefing-document">
            <div className="document-heading">
              <div>
                <p className="eyebrow">Announcement briefing</p>
                <h2>Brief the announcement</h2>
              </div>
              <span className="subtle-status">
                {user
                  ? isAdminMode
                    ? "Admin mode — Unlimited testing"
                    : "Ready to evaluate"
                  : remainingDemoChecks > 0
                  ? `${remainingDemoChecks} demo ${remainingDemoChecks === 1 ? "check" : "checks"} remaining`
                  : "Demo checks complete"}
              </span>
            </div>

            <p className="section-copy">
              Describe the announcement as you would brief a PR lead. Include the market, proof points,
              named partners, measurable outcomes, and any constraints a journalist would question.
            </p>

            <aside className="operator-note">
              <strong>Operator note</strong>
              <span>Specific evidence, named validation, and measurable outcomes improve the assessment.</span>
            </aside>

            <div className="field-grid briefing-metadata">
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

            <div className="action-row document-action">
              <Button
                onClick={handleEvaluate}
                disabled={!authReady || isEvaluating || (!user && remainingDemoChecks <= 0)}
              >
                {isEvaluating ? "Evaluating..." : "Run PR Readiness Check"}
              </Button>
              <span className="helper-text">
                {user
                  ? "Evaluation must be saved before generation is available."
                  : "Demo evaluations are not saved and do not appear in history."}
              </span>
            </div>
          </section>

          <section className={`workspace-document editorial-review verdict-panel ${verdictClass}`}>
            <div className="document-heading verdict-heading">
              <div>
                <p className="eyebrow">Editorial verdict</p>
                <h2 className={`verdict-word ${verdictClass}`}>{verdictLabel}</h2>
              </div>
              <span className="document-state">
                {isEvaluating ? "Assessment in progress" : evalData ? "Assessment complete" : "Awaiting briefing"}
              </span>
            </div>

            {!evalData ? (
              <div className="document-empty-state" role="status">
                <span>{isEvaluating ? "Reviewing briefing" : "No assessment yet"}</span>
                <p>
                  {isEvaluating
                    ? "The readiness desk is reviewing the announcement."
                    : "Run a readiness check to see the verdict, likely editorial reception, evidence gaps, and required next actions."}
                </p>
              </div>
            ) : (
              <>
                {evalData.journalist_reaction && (
                  <section className="document-section editorial-reception">
                    <h3>Likely Editorial Reception</h3>
                    <p>{evalData.journalist_reaction}</p>
                  </section>
                )}

                {evalData.recommendation?.summary && (
                  <section className="desk-instruction">
                    <h3>Desk recommendation</h3>
                    <p>{evalData.recommendation.summary}</p>
                  </section>
                )}

                <div className="assessment-details">
                  {Array.isArray(evalData.primary_failure_modes) &&
                    evalData.primary_failure_modes.length > 0 && (
                      <section className="evidence-gaps">
                        <h3>Evidence gaps and risks</h3>
                        <ul className="clean-list">
                          {evalData.primary_failure_modes.slice(0, 6).map((x: string, i: number) => (
                            <li key={i}>{x}</li>
                          ))}
                        </ul>
                      </section>
                    )}

                  {Array.isArray(evalData.recommendation?.next_actions) &&
                    evalData.recommendation.next_actions.length > 0 && (
                      <section className="required-actions">
                        <h3>Required next actions</h3>
                        <ol className="action-list">
                          {evalData.recommendation.next_actions.slice(0, 3).map((x: string, i: number) => (
                            <li key={i}>{x}</li>
                          ))}
                        </ol>
                      </section>
                    )}
                </div>

              </>
            )}
          </section>

          {!user && evalData && (
            <aside className="demo-result-save-prompt workspace-notice">
              <strong>Create a free account to save this PR check and continue.</strong>
              <Button size="small" onClick={() => login("google")}>
                Create Free Account
              </Button>
            </aside>
          )}

          <section className={`workspace-document drafting-document ${verdict === "NO-GO" ? "blocked" : canGenerate ? "available" : "pending"}`}>
            <div className="document-heading">
              <div>
                <p className="eyebrow">Drafting stage</p>
                <h2>Press-release draft</h2>
              </div>
              <span className="subtle-status">
                {user
                  ? isAdminMode
                    ? "Admin mode — Unlimited testing"
                    : remainingGenerations === null
                      ? "Checking usage"
                      : `${remainingGenerations} of ${generationLimit} free remaining`
                  : `${remainingDemoDrafts} demo ${remainingDemoDrafts === 1 ? "draft" : "drafts"} remaining`}
              </span>
            </div>

            <div className="draft-status">
              <strong>
                {isGenerating
                  ? "Drafting in progress"
                  : canGenerate
                  ? "Ready for drafting"
                  : verdict === "NO-GO"
                  ? "Drafting blocked"
                  : "Drafting unavailable"}
              </strong>
              <p>{generationStatus}</p>
            </div>

            <div className="action-row document-action">
              <Button
                onClick={handleSubmit}
                disabled={!authReady || isGenerating || !canGenerate}
              >
                {isGenerating ? "Generating..." : "Generate Press Release"}
              </Button>
            </div>

            {output ? (
              <article className="output-card draft-output">
                <div className="output-header">
                  <div>
                    <span>Draft document</span>
                    <h3>Generated press release</h3>
                  </div>
                  {user ? (
                    <Button variant="secondary" size="small" onClick={copyOutput}>
                      {copiedOutput ? "Copied" : "Copy"}
                    </Button>
                  ) : (
                    <span className="helper-text">Create an account to save this draft</span>
                  )}
                </div>
                <pre>{output}</pre>
              </article>
            ) : (
              <div className="document-empty-state compact">
                <span>No draft document</span>
                <p>Approved or conditional evaluations can produce a draft here.</p>
              </div>
            )}
          </section>
        </div>

        <aside className="history-panel desk-archive">
          <div className="archive-heading">
            <div>
              <p className="eyebrow">Desk archive</p>
              <h2>Recent evaluations</h2>
            </div>
          </div>

          {authReady && !user ? (
            <div className="anonymous-history-gate">
              <p className="archive-empty-state">
                Create a free account to save PR evaluations, generate additional drafts, and build a launch history.
              </p>
              <Button size="small" onClick={() => login("google")}>
                Create Free Account
              </Button>
            </div>
          ) : user && history.length === 0 ? (
            <p className="archive-empty-state">
              No saved evaluations yet. Completed checks will appear here.
            </p>
          ) : null}

          {user && <div className="history-list">
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
                <span className="history-item-topline">
                  <span className={`mini-verdict ${item.verdict === "GO" ? "go" : item.verdict === "CONDITIONAL" ? "conditional" : "nogo"}`}>
                    {item.verdict}
                  </span>
                  {item.created_at && (
                    <time dateTime={item.created_at}>
                      {new Date(item.created_at).toLocaleDateString(undefined, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </time>
                  )}
                </span>
                <span className="history-title">{item.announcement?.slice(0, 86)}...</span>
                <span className="history-meta">
                  {item.generations && item.generations.length > 0 ? "Draft generated" : "Evaluation only"}
                </span>
              </button>
            ))}
          </div>}
        </aside>
      </PageContainer>

      <section className="pricing-section" id="pricing" aria-labelledby="pricing-heading">
        <PageContainer>
          <div className="marketing-section-heading">
            <div>
              <p className="eyebrow">Planned access</p>
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
                Anonymous visitors can run two readiness checks and generate one draft. Signed-in usage
                is shown inside the workspace. Drafting remains available only for GO or CONDITIONAL evaluations.
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
