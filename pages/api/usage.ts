import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const FREE_GENERATION_LIMIT = 5;

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
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const verifiedUser = await getVerifiedUser(req);

    const { count: generationsUsed, error } = await supabase
      .from("generations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", verifiedUser.id);

    if (error || typeof generationsUsed !== "number") {
      console.error("Supabase usage count error:", error);
      return res.status(500).json({ error: "Could not check generation usage" });
    }

    return res.status(200).json({
      generations_used: generationsUsed,
      remaining_generations: Math.max(0, FREE_GENERATION_LIMIT - generationsUsed),
      generation_limit: FREE_GENERATION_LIMIT,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Missing Supabase access token") {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (err instanceof Error && err.message === "Invalid Supabase access token") {
      return res.status(401).json({ error: "Invalid Supabase access token" });
    }

    console.error('Usage API error:', err);
    return res.status(500).json({ error: 'Something went wrong on the server.' });
  }
}
