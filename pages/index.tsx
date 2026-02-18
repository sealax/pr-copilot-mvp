import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

export default function Home() {
  const [prompt, setPrompt] = useState('');
  const [output, setOutput] = useState('');
  const [user, setUser] = useState(null);
  const [pitchesUsed, setPitchesUsed] = useState(0);

  const [evaluation, setEvaluation] = useState("");
  const [verdict, setVerdict] = useState<"GO" | "CONDITIONAL" | "NO-GO" | "">("");
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const [market, setMarket] = useState("Fintech compliance");
  const [funding, setFunding] = useState("$3M seed");
  const [partners, setPartners] = useState("AcmePay (regulated UK fintech)");

  const [riskScore, setRiskScore] = useState<number | null>(null);
  const [showFullEvaluation, setShowFullEvaluation] = useState(false);

  const [evalData, setEvalData] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data?.user ?? null));
  }, []);

  const login = async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'github' });
    console.log("LOGIN DATA:", data);
    console.log("LOGIN ERROR:", error);
  };

  function extractVerdict(text: string): "GO" | "CONDITIONAL" | "NO-GO" | "" {
    const m = text.match(/PR Readiness Verdict:\s*(GO|CONDITIONAL|NO-GO)/i);
    if (!m) return "";
    const v = m[1].toUpperCase();
    return (v === "GO" || v === "CONDITIONAL" || v === "NO-GO") ? (v as any) : "";
  }

  function extractRiskScore(text: string): number | null {
  const m = text.match(/Overall Risk Score \(0–100\):\s*(\d+)/i);
  if (!m) return null;
  return parseInt(m[1], 10);
  }

  const handleEvaluate = async () => {
  if (!prompt.trim()) return alert("Add your announcement first");

  setIsEvaluating(true);
  setEvaluation("");
  setVerdict("");

  try {
    const res = await fetch("/api/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

      setEvalData(data);
      setVerdict(data.verdict ?? "");
      setRiskScore(typeof data.risk_score === "number" ? data.risk_score : null);

      setShowFullEvaluation(false);



  } catch (e) {
    console.error(e);
    alert("Evaluation failed");
  } finally {
    setIsEvaluating(false);
  }
};

  const handleSubmit = async () => {
    console.log("SUBMIT clicked");

    if (!evalData) return alert("Run PR Readiness Check first");
    if (!(verdict === "GO" || verdict === "CONDITIONAL")) {
      return alert("PR Readiness Verdict is NO-GO. Generation is blocked.");
  }
    if (pitchesUsed >= 5) return alert('You’ve used all 5 free pitches');

  setIsGenerating(true);
  try {

    const res = await fetch('/api/generate', {
      
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, email: user?.email ?? null }),
    });

    const data = await res.json();
    console.log("API RESPONSE:", data);
    setOutput(data.response);
    setPitchesUsed(prev => prev + 1);

  } finally {
    setIsGenerating(false);
  }
  };




  return (
    <main style={{ padding: 40 }}>
      <h1>PR Copilot</h1>
      {!user && <button onClick={login}>Sign in with GitHub</button>}
      {user ? <p>Welcome {user.email}</p> : <p>(Not logged in — demo mode)</p>}




      <div style={{ marginBottom: 12 }}>
        <label>Market&nbsp;</label>
        <input
        value={market}
        onChange={(e) => setMarket(e.target.value)}
        style={{ width: 420 }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label>Partners/Customers&nbsp;</label>
        <input
        value={partners}
        onChange={(e) => setPartners(e.target.value)}
        style={{ width: 420 }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label>Funding&nbsp;</label>
        <input
        value={funding}
        onChange={(e) => setFunding(e.target.value)}
        style={{ width: 420 }}
        />
      </div>



      <textarea rows={6} value={prompt} onChange={e => setPrompt(e.target.value)} />
      <button onClick={handleEvaluate} disabled={isEvaluating}>
  {isEvaluating ? "Evaluating..." : "Run PR Readiness Check"}
</button>

<div style={{ marginTop: 12 }}>
  <strong>Verdict:</strong> {verdict || "(not evaluated yet)"}
</div>

<div style={{ marginTop: 6 }}>
  <strong>Risk score:</strong> {riskScore === null ? "(n/a)" : `${riskScore}/100`}
</div>

{evalData && (
  <div style={{ marginTop: 12 }}>
    <button onClick={() => setShowFullEvaluation((v) => !v)}>
      {showFullEvaluation ? "Hide details" : "Show details"}
    </button>

    {showFullEvaluation && (
      <div style={{ marginTop: 12 }}>
        {Array.isArray(evalData.primary_failure_modes) &&
          evalData.primary_failure_modes.length > 0 && (
            <>
              <strong>Primary failure modes</strong>
              <ul>
                {evalData.primary_failure_modes.slice(0, 6).map((x: string, i: number) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </>
          )}

        {evalData.journalist_reaction && (
          <>
            <strong>Journalist reaction</strong>
            <p style={{ marginTop: 6 }}>{evalData.journalist_reaction}</p>
          </>
        )}

        {evalData.recommendation?.summary && (
          <>
            <strong>Recommendation</strong>
            <p style={{ marginTop: 6 }}>{evalData.recommendation.summary}</p>
          </>
        )}

        {Array.isArray(evalData.recommendation?.next_actions) &&
          evalData.recommendation.next_actions.length > 0 && (
            <>
              <strong>Next actions</strong>
              <ol>
                {evalData.recommendation.next_actions.slice(0, 3).map((x: string, i: number) => (
                  <li key={i}>{x}</li>
                ))}
              </ol>
            </>
          )}
      </div>
    )}
  </div>
)}

<button
  onClick={handleSubmit}
  disabled={isGenerating || !(verdict === "GO" || verdict === "CONDITIONAL")}
  style={{ marginTop: 12 }}
>
  {isGenerating ? "Generating..." : "Generate Press Release"}
</button>

      <pre>{output}</pre>

      <p>{5 - pitchesUsed} free generations remaining (local)</p>
    </main>
  );
}