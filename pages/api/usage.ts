import { createClient } from '@supabase/supabase-js';
import { getDemoAllowance, getDemoVisitorHash } from "../../lib/server/demoUsage";
import {
  ADMIN_USAGE_SENTINEL,
  isAdminConfigPresent,
  isAdminUser,
  normalizeAdminEmail,
} from "../../lib/server/admin";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const FREE_GENERATION_LIMIT = 5;

async function getOptionalVerifiedUser(req) {
  const authHeader = Array.isArray(req.headers.authorization)
    ? req.headers.authorization[0]
    : req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return null;
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

    const verifiedUser = await getOptionalVerifiedUser(req);

    if (!verifiedUser) {
      const demoAllowance = await getDemoAllowance(
        supabase,
        getDemoVisitorHash(req)
      );

      return res.status(200).json({
        demo: true,
        ...demoAllowance,
      });
    }

    const adminConfigPresent = isAdminConfigPresent();
    const authenticatedEmail = normalizeAdminEmail(verifiedUser.email);
    const isAdmin = isAdminUser(verifiedUser);
    const adminDiagnostics = {
      adminConfigPresent,
      isAdmin,
      ...(process.env.NODE_ENV !== "production" ? { authenticatedEmail } : {}),
    };

    console.info("[admin-usage-diagnostic]", {
      adminConfigPresent,
      authenticatedEmail,
      isAdmin,
    });

    if (isAdmin) {
      return res.status(200).json({
        generations_used: 0,
        remaining_generations: ADMIN_USAGE_SENTINEL,
        generation_limit: ADMIN_USAGE_SENTINEL,
        ...adminDiagnostics,
      });
    }

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
      ...adminDiagnostics,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Invalid Supabase access token") {
      return res.status(401).json({ error: "Invalid Supabase access token" });
    }

    console.error('Usage API error:', err);
    return res.status(500).json({ error: 'Something went wrong on the server.' });
  }
}
