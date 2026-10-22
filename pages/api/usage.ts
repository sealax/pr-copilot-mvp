import { readUsage, UsageError } from "../../lib/server/apiUsage";
import { createClient } from '@supabase/supabase-js';
import { getDemoVisitorHash } from "../../lib/server/demoUsage";
import {
  isAdminConfigPresent,
  isAdminUser,
  normalizeAdminEmail,
} from "../../lib/server/admin";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);


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
      const demoAllowance = await readUsage(supabase, null, getDemoVisitorHash(req), false);

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

    const allowance = await readUsage(supabase, verifiedUser.id, null, isAdmin);
    return res.status(200).json({ ...allowance, ...adminDiagnostics });
  } catch (err) {
    if (err instanceof UsageError) return res.status(err.status).json({ error: err.message });
    if (err instanceof Error && err.message === "Invalid Supabase access token") {
      return res.status(401).json({ error: "Invalid Supabase access token" });
    }

    console.error('Usage API error:', err);
    return res.status(500).json({ error: 'Something went wrong on the server.' });
  }
}
