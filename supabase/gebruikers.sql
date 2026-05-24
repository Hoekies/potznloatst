-- Gebruikers tabel voor Pot z'n Loatst
-- Koppelt Supabase Auth users aan leesbare gebruikersnamen

CREATE TABLE IF NOT EXISTS gebruikers (
  id             uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  gebruikersnaam text NOT NULL UNIQUE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);

-- Alleen admin (= ingelogde gebruiker met email admin@potznloatst.local) mag alles lezen
ALTER TABLE gebruikers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin leest alle gebruikers"
  ON gebruikers FOR SELECT
  USING (auth.jwt() ->> 'email' = 'admin@potznloatst.local');

CREATE POLICY "Gebruiker leest eigen rij"
  ON gebruikers FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Gebruiker schrijft eigen rij"
  ON gebruikers FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Gebruiker updatet eigen rij"
  ON gebruikers FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Admin verwijdert gebruikers"
  ON gebruikers FOR DELETE
  USING (auth.jwt() ->> 'email' = 'admin@potznloatst.local');
