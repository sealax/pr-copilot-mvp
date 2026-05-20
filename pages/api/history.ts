import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getVerifiedUser(req) {
  const authHeader = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Missing Supabase access token");
  }

  const accessToken = authHeader.slice("Bearer ".length);
  const { data, error } = await supabase.auth.getUser(accessToken);

  if (error || !data?.user) {
    throw new Error("Invalid Supabase access token");
  }

  return data.user;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const verifiedUser = await getVerifiedUser(req);

    const { data: evaluations, error: evaluationError } = await supabase
      .from("evaluations")
      .select("*")
      .eq("user_id", verifiedUser.id)
      .order("created_at", { ascending: false })
      .limit(5);

    if (evaluationError) {
      console.error("Supabase history evaluation fetch error:", evaluationError);
      return res.status(500).json({ error: "Could not fetch history" });
    }

    const evaluationIds = (evaluations || []).map((item) => item.id).filter(Boolean);

    if (evaluationIds.length === 0) {
      return res.status(200).json({ history: [] });
    }

    const { data: generations, error: generationError } = await supabase
      .from("generations")
      .select("id, evaluation_id, output, created_at")
      .eq("user_id", verifiedUser.id)
      .in("evaluation_id", evaluationIds)
      .order("created_at", { ascending: false });

    if (generationError) {
      console.error("Supabase history generation fetch error:", generationError);
      return res.status(500).json({ error: "Could not fetch history" });
    }

    const generationsByEvaluation = new Map<string, any[]>();

    (generations || []).forEach((generation) => {
      const existing = generationsByEvaluation.get(generation.evaluation_id) || [];
      existing.push(generation);
      generationsByEvaluation.set(generation.evaluation_id, existing);
    });

    return res.status(200).json({
      history: (evaluations || []).map((evaluation) => {
        const evaluationGenerations = generationsByEvaluation.get(evaluation.id) || [];

        return {
          ...evaluation,
          generations: evaluationGenerations.map((generation) => ({ id: generation.id })),
          latest_generation: evaluationGenerations[0] ?? null,
        };
      }),
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Missing Supabase access token") {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (err instanceof Error && err.message === "Invalid Supabase access token") {
      return res.status(401).json({ error: "Invalid Supabase access token" });
    }

    console.error("History API error:", err);
    return res.status(500).json({ error: "Something went wrong on the server." });
  }
}
