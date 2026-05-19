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
  const [history, setHistory] = useState<any[]>([]);
  const [selectedGeneration, setSelectedGeneration] = useState<any>(null);

useEffect(() => {
  if (!supabase) return;
  supabase.auth.getUser().then(({ data }) => setUser(data?.user ?? null));
}, []);

useEffect(() => {
  if (!user) return;

  const fetchHistory = async () => {
    const { data, error } = await supabase
      .from("evaluations")
      .select("*, generations(id)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) {
      console.error("Error fetching history:", error);
    } else {
      setHistory(data || []);
    }
  };

  fetchHistory();
}, [user]);

const login = async () => {
  if (!supabase) {
    alert("Supabase is not configured");
    return;
  }
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo: window.location.origin,
    },
  });
  console.log("LOGIN DATA:", data);
  console.log("LOGIN ERROR:", error);
};

const getApiHeaders = async () => {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (!supabase) return headers;

  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  return headers;
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
  setOutput("");
  setSelectedGeneration(null);

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
    if (!evalData.id && !evalData.evaluation_token) {
      return alert("Evaluation state is missing, so generation cannot run. Please run the readiness check again.");
    }
    if (pitchesUsed >= 5) return alert('You’ve used all 5 free pitches');

  setIsGenerating(true);
  try {
    const headers = await getApiHeaders();

    const res = await fetch('/api/generate', {

      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt,
        email: user?.email ?? null,
        evaluation_id: evalData?.id ?? null,
        evaluation_token: evalData?.evaluation_token ?? null,
  }),
    });

    const data = await res.json();
    console.log("API RESPONSE:", data);

    if (!res.ok) {
      return alert(data?.error ?? "Generation failed");
    }

    if (typeof data.response !== "string" || data.response.length === 0) {
      return alert("Generation returned no draft");
    }

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
  <strong>Verdict:</strong>{" "}
  {verdict ? (
    (() => {
      const v = verdict.toUpperCase();

      const isGo = v === "GO";
      const isConditional = v === "CONDITIONAL";
      const isNoGo = v === "NO-GO" || v === "NO GO";

      const bg = isGo
        ? "#d4edda"
        : isConditional
        ? "#fff3cd"
        : "#f8d7da";

      const color = isGo
        ? "#155724"
        : isConditional
        ? "#856404"
        : "#721c24";

      return (
        <span
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            fontWeight: 600,
            backgroundColor: bg,
            color: color,
          }}
        >
          {v}
        </span>
      );
    })()
  ) : (
    "(not evaluated yet)"
  )}
</div>

<div style={{ marginTop: 6 }}>
  <strong>Risk score:</strong> {riskScore === null ? "(n/a)" : `${riskScore}/100`}
</div>

{evalData?.risk_breakdown && (
  <div style={{ marginTop: 8 }}>
    <strong>Risk breakdown</strong>
    <ul style={{ marginTop: 6 }}>
      <li>External validation: {evalData.risk_breakdown.external_validation} / 30</li>
      <li>Beneficiary clarity: {evalData.risk_breakdown.beneficiary_clarity} / 20</li>
      <li>Explainability: {evalData.risk_breakdown.explainability} / 20</li>
      <li>Third-party support: {evalData.risk_breakdown.third_party_support} / 15</li>
      <li>Impact vs activity: {evalData.risk_breakdown.impact_vs_activity} / 15</li>
    </ul>
  </div>
)}

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


<h3>Recent evaluations</h3>

{history.length === 0 && <p>No history yet</p>}

<ul>
  {history.map((item) => (
    <li
      key={item.id}

      onClick={async () => {
        setEvalData(item.evaluation_json?.raw ?? null);
        setVerdict(item.verdict ?? "");
        setRiskScore(item.risk_score ?? null);
        setPrompt(item.announcement ?? "");
        setMarket(item.market ?? "");
        setPartners(item.partners ?? "");
        setFunding(item.funding ?? "");

        const { data, error } = await supabase
          .from("generations")
          .select("*")
          .eq("evaluation_id", item.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (error) {
          console.error("Error fetching generation:", error);
          setSelectedGeneration(null);
          setOutput("");
        } else {
          setSelectedGeneration(data);
          setOutput(data?.output ?? "");
        }
      }}

      style={{ cursor: "pointer", marginBottom: 8 }}
    >
      <strong>{item.verdict}</strong>
      {" "}
      {item.generations && item.generations.length > 0 ? "• generated" : "• no generation"}
      {" — "}
      {item.announcement?.slice(0, 60)}...
    </li>
  ))}
</ul>
    </main>
  );
}
