const SUPABASE_URL = "https://vujjmbjvddnkvarfztpg.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1amptYmp2ZGRua3ZhcmZ6dHBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxMzI3NjIsImV4cCI6MjA5NDcwODc2Mn0.R1TfsFZIl_VSNg-0keeQgJO_pB2UqOxdm1hSdLRygaw";

export default async function handler(req, res) {
  try {
    // Ping auth én database zodat beide wakker zijn vóór gebruikers inloggen
    const [authRes, dbRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/auth/v1/health`, {
        headers: { apikey: SUPABASE_ANON_KEY },
      }),
      fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id&limit=1`, {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
      }),
    ]);

    res.status(200).json({
      ok: true,
      auth: authRes.status,
      db: dbRes.status,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
}
