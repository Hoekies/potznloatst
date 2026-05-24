import { primaryStorageKey } from './constants.js';
import { sanitizeText, sanitizeAmount, sanitizeDate, sanitizeImageValue, fallbackColor } from './utils.js';
import { categoryLabels } from './constants.js';
import {
  state, setState, normalizeState, normalizeEstimate, createEmptyState, hasMeaningfulState,
  writeToStorage, getCloudHydrating, setCloudHydrating,
  markMigrationDone, wasMigrationDone,
} from './state.js';

let supabaseClientInstance = null;
let authStateListenerBound = false;
let cloudSyncPromise = null;
let cloudSyncQueued = false;

let _render;
export function setRenderFn(fn) {
  _render = fn;
}

export function getSupabaseConfig() {
  const config = globalThis.POTZLOATS_CONFIG || {};
  return {
    supabaseUrl: sanitizeText(config.supabaseUrl || "", 240),
    supabaseAnonKey: sanitizeText(config.supabaseAnonKey || "", 2048),
    mediaBucket: sanitizeText(config.mediaBucket || "potzloats-media", 120) || "potzloats-media",
  };
}

export function isSupabaseConfigured() {
  const config = getSupabaseConfig();
  return Boolean(config.supabaseUrl && config.supabaseAnonKey && globalThis.supabase?.createClient);
}

export function getSupabaseClient() {
  if (!isSupabaseConfigured()) {
    return null;
  }

  if (!supabaseClientInstance) {
    const config = getSupabaseConfig();
    supabaseClientInstance = globalThis.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  return supabaseClientInstance;
}

export async function getCurrentSessionUser() {
  const client = getSupabaseClient();
  if (!client) {
    return null;
  }

  const { data: sessionData } = await client.auth.getSession();
  if (!sessionData?.session) {
    return null;
  }

  const { data, error } = await client.auth.getUser();
  if (error) {
    console.warn("Gebruiker ophalen uit Supabase mislukte:", error);
    return null;
  }

  return data?.user || null;
}

export async function getSignedReceiptUrl(path) {
  const client = getSupabaseClient();
  if (!client || !path) {
    return "";
  }

  const { data, error } = await client.storage
    .from(getSupabaseConfig().mediaBucket)
    .createSignedUrl(path, 60 * 60);

  if (error) {
    console.warn("Signed URL voor bon ophalen mislukte:", error);
    return "";
  }

  return data?.signedUrl || "";
}

export async function ensureReceiptUploaded(expense, userId) {
  const client = getSupabaseClient();
  if (!client || !expense) {
    return expense;
  }

  if (!expense.receiptImage && !expense.receiptPath) {
    return expense;
  }

  if (!/^data:image\//.test(expense.receiptImage || "")) {
    if (expense.receiptPath && !expense.receiptImage) {
      return {
        ...expense,
        receiptImage: await getSignedReceiptUrl(expense.receiptPath),
      };
    }
    return expense;
  }

  const blob = await fetch(expense.receiptImage).then((response) => response.blob());
  const extension = blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg";
  const path = `receipts/${userId}/${expense.id}.${extension}`;

  const { error } = await client.storage
    .from(getSupabaseConfig().mediaBucket)
    .upload(path, blob, {
      upsert: true,
      contentType: blob.type || "image/jpeg",
    });

  if (error) {
    console.warn("Bon uploaden naar Supabase mislukte:", error);
    return expense;
  }

  return {
    ...expense,
    receiptPath: path,
    receiptImage: await getSignedReceiptUrl(path),
    ocrStatus: "reviewed",
  };
}

export async function fetchExistingReceiptPaths(userId) {
  const client = getSupabaseClient();
  if (!client || !userId) {
    return [];
  }

  const { data, error } = await client
    .from("uitgaven")
    .select("bon_path")
    .eq("user_id", userId)
    .neq("bon_path", "");

  if (error) {
    console.warn("Bestaande bonpaden ophalen mislukte:", error);
    return [];
  }

  return (data || []).map((item) => sanitizeText(item.bon_path || "", 240)).filter(Boolean);
}

export async function saveProfileToCloud(user) {
  const client = getSupabaseClient();
  if (!client || !user) {
    return;
  }

  const payload = {
    id: user.id,
    email: user.email || "",
    display_name: state.profile?.name || "",
    avatar_url: state.profile?.avatarUrl || "",
  };

  const { error } = await client.from("profiles").upsert(payload, { onConflict: "id" });
  if (error) {
    console.warn("Profiel opslaan in Supabase mislukte:", error);
  }
}

export async function buildCloudStateForUser(user) {
  const client = getSupabaseClient();
  if (!client || !user) {
    return createEmptyState();
  }

  const [profileResult, participantsResult, contributionsResult, expensesResult] = await Promise.all([
    client.from("profiles").select("display_name, avatar_url").eq("id", user.id).maybeSingle(),
    client.from("deelnemers").select("id, naam, kleur").eq("user_id", user.id).order("created_at", { ascending: true }),
    client.from("extra_inleg").select("id, participant_id, bedrag, type, omschrijving, datum").eq("user_id", user.id).order("datum", { ascending: false }),
    client.from("uitgaven").select("id, omschrijving, bedrag, categorie, betaald_door, datum, notitie, bon_path, is_gecontroleerd, is_raming").eq("user_id", user.id).order("datum", { ascending: false }),
  ]);

  if (participantsResult.error || contributionsResult.error || expensesResult.error) {
    throw new Error("Clouddata ophalen is mislukt.");
  }

  const participants = (participantsResult.data || []).map((item, index) => ({
    id: item.id,
    name: sanitizeText(item.naam) || `Deelnemer ${index + 1}`,
    color: item.kleur || fallbackColor(index),
  }));

  const contributions = (contributionsResult.data || []).map((item) => ({
    id: item.id,
    participantId: sanitizeText(item.participant_id || "", 80),
    amount: sanitizeAmount(item.bedrag),
    type: item.type === "initial" ? "initial" : "topup",
    note: sanitizeText(item.omschrijving),
    date: sanitizeDate(String(item.datum || "").slice(0, 10)),
  }));

  const expenseRows = expensesResult.data || [];
  const expenseRecords = [];
  const estimateRecords = [];

  for (const item of expenseRows) {
    const baseRecord = {
      id: item.id,
      description: sanitizeText(item.omschrijving) || (item.is_raming ? "Raming" : "Uitgave"),
      amount: sanitizeAmount(item.bedrag),
      category: categoryLabels[item.categorie] ? item.categorie : "overig",
      paidBy: sanitizeText(item.betaald_door),
      date: sanitizeDate(String(item.datum || "").slice(0, 10)),
      note: sanitizeText(item.notitie),
      receiptPath: sanitizeText(item.bon_path || "", 240),
      receiptImage: "",
      ocrStatus: item.is_gecontroleerd ? "reviewed" : "manual",
    };

    if (baseRecord.receiptPath) {
      baseRecord.receiptImage = await getSignedReceiptUrl(baseRecord.receiptPath);
    }

    if (item.is_raming) {
      estimateRecords.push(normalizeEstimate(baseRecord, participants.length));
    } else {
      expenseRecords.push(baseRecord);
    }
  }

  return normalizeState({
    weekend: state.weekend,
    auth: {
      loggedIn: true,
      provider: "supabase",
      email: user.email || "",
      userId: user.id,
      lastSyncedAt: new Date().toISOString(),
    },
    profile: {
      name: sanitizeText(profileResult.data?.display_name || state.profile?.name || "", 80),
      avatarUrl: sanitizeImageValue(profileResult.data?.avatar_url || state.profile?.avatarUrl || ""),
    },
    participants,
    contributions,
    expenses: expenseRecords,
    estimates: estimateRecords,
  });
}

function isCloudStateEmpty(cloudState) {
  return !hasMeaningfulState({
    participants: cloudState.participants,
    contributions: cloudState.contributions,
    expenses: cloudState.expenses,
    estimates: cloudState.estimates,
    profile: cloudState.profile,
  });
}

export function applyCloudState(cloudState, user) {
  setCloudHydrating(true);
  setState(normalizeState({
    ...cloudState,
    auth: {
      loggedIn: true,
      provider: "supabase",
      email: user.email || "",
      userId: user.id,
      lastSyncedAt: new Date().toISOString(),
    },
  }));
  writeToStorage(primaryStorageKey, JSON.stringify(state));
  _render();
  setCloudHydrating(false);
}

export async function syncStateToCloud(reason = "auto") {
  const client = getSupabaseClient();
  const user = await getCurrentSessionUser();
  if (!client || !user || getCloudHydrating()) {
    return;
  }

  const normalized = normalizeState(state);
  const uploadedExpenses = [];
  for (const expense of normalized.expenses) {
    uploadedExpenses.push(await ensureReceiptUploaded(expense, user.id));
  }

  normalized.expenses = uploadedExpenses;
  state.expenses = uploadedExpenses;

  await saveProfileToCloud(user);

  const currentPaths = await fetchExistingReceiptPaths(user.id);
  const desiredPaths = new Set(uploadedExpenses.map((item) => item.receiptPath).filter(Boolean));
  const orphanPaths = currentPaths.filter((path) => !desiredPaths.has(path));

  const contributionsRows = normalized.contributions.map((item) => ({
    id: item.id,
    user_id: user.id,
    participant_id: item.type === "initial" ? item.participantId || null : null,
    omschrijving: item.note || "",
    bedrag: item.amount,
    type: item.type,
    is_raming: false,
    datum: `${item.date}T12:00:00.000Z`,
  }));

  const participantRows = normalized.participants.map((item) => ({
    id: item.id,
    user_id: user.id,
    naam: item.name,
    kleur: item.color,
  }));

  const expenseRows = normalized.expenses.map((item) => ({
    id: item.id,
    user_id: user.id,
    participant_id: null,
    omschrijving: item.description,
    bedrag: item.amount,
    categorie: item.category,
    betaald_door: item.paidBy || "",
    is_raming: false,
    is_gecontroleerd: item.ocrStatus === "reviewed",
    datum: `${item.date}T12:00:00.000Z`,
    notitie: item.note || "",
    bon_path: item.receiptPath || "",
  }));

  const estimateRows = normalized.estimates.map((item) => ({
    id: item.id,
    user_id: user.id,
    participant_id: null,
    omschrijving: item.description,
    bedrag: item.amount,
    categorie: item.category,
    betaald_door: item.paidBy || "",
    is_raming: true,
    is_gecontroleerd: false,
    datum: `${item.date}T12:00:00.000Z`,
    notitie: item.note || "",
    bon_path: "",
  }));

  const { error: deleteContributionsError } = await client.from("extra_inleg").delete().eq("user_id", user.id);
  if (deleteContributionsError) {
    throw deleteContributionsError;
  }

  const { error: deleteExpensesError } = await client.from("uitgaven").delete().eq("user_id", user.id);
  if (deleteExpensesError) {
    throw deleteExpensesError;
  }

  const { error: deleteParticipantsError } = await client.from("deelnemers").delete().eq("user_id", user.id);
  if (deleteParticipantsError) {
    throw deleteParticipantsError;
  }

  if (participantRows.length) {
    const { error } = await client.from("deelnemers").insert(participantRows);
    if (error) throw error;
  }

  if (contributionsRows.length) {
    const { error } = await client.from("extra_inleg").insert(contributionsRows);
    if (error) throw error;
  }

  if (expenseRows.length || estimateRows.length) {
    const { error } = await client.from("uitgaven").insert([...expenseRows, ...estimateRows]);
    if (error) throw error;
  }

  if (orphanPaths.length) {
    await client.storage.from(getSupabaseConfig().mediaBucket).remove(orphanPaths);
  }

  state.auth.loggedIn = true;
  state.auth.provider = "supabase";
  state.auth.email = user.email || "";
  state.auth.userId = user.id;
  state.auth.lastSyncedAt = new Date().toISOString();
  writeToStorage(primaryStorageKey, JSON.stringify(state));
  _render();
  if (reason === "manual") {
    console.info("Cloud-sync voltooid.");
  }
}

export function queueCloudSync(reason = "auto") {
  if (!state.auth?.loggedIn || getCloudHydrating() || !isSupabaseConfigured()) {
    return;
  }

  if (cloudSyncPromise) {
    cloudSyncQueued = true;
    return;
  }

  cloudSyncPromise = syncStateToCloud(reason)
    .catch((error) => {
      console.warn("Cloud-sync mislukte:", error);
    })
    .finally(() => {
      cloudSyncPromise = null;
      if (cloudSyncQueued) {
        cloudSyncQueued = false;
        queueCloudSync("queued");
      }
    });
}

export async function hydrateFromSupabaseSession(user) {
  const cloudState = await buildCloudStateForUser(user);
  if (isCloudStateEmpty(cloudState) && hasMeaningfulState(state) && !wasMigrationDone(user.id)) {
    await syncStateToCloud("initial-migration");
    markMigrationDone(user.id);
    applyCloudState(await buildCloudStateForUser(user), user);
    return;
  }

  applyCloudState(cloudState, user);
}

export function warmUpSupabase() {
  const client = getSupabaseClient();
  if (!client) return;
  // Stille ping: wekt zowel de auth-service als de database op
  client.auth.getSession().catch(() => {});
  client.from("profiles").select("id").limit(1).catch(() => {});
}

export async function bootstrapCloudFeatures(bindAuthModal, renderAccountUi, onPasswordRecovery) {
  bindAuthModal();
  renderAccountUi();

  const client = getSupabaseClient();
  if (!client) {
    return;
  }

  if (!authStateListenerBound) {
    authStateListenerBound = true;
    client.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        if (onPasswordRecovery) onPasswordRecovery();
        return;
      }
      if (event === "SIGNED_OUT" || !session?.user) {
        if (state.auth?.loggedIn) {
          setState(createEmptyState());
          writeToStorage(primaryStorageKey, JSON.stringify(state));
          _render();
        }
        return;
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION") {
        const user = session.user;
        // Gebruik setTimeout(0) zodat de Supabase SDK zijn interne Promise-chain
        // eerst kan afronden vóór we zware DB-queries starten. Zonder deze
        // verschuiving blokkeert de hydration de resolve van signInWithPassword,
        // waardoor closeAuthModal() pas na de DB-queries wordt aangeroepen.
        setTimeout(() => {
          hydrateFromSupabaseSession(user).catch((err) => {
            console.warn("Hydration mislukt, gebruik lokale staat:", err);
            applyCloudState(createEmptyState(), user);
          });
        }, 0);
      }
    });
  }

  // Hydrate eenmalig bij bootstrap als er al een actieve sessie is.
  // De onAuthStateChange listener handelt INITIAL_SESSION al af via setTimeout(0),
  // dus hier alleen hydrateren als de listener de sessie nog niet oppikt
  // (d.w.z. we wachten een tick om dubbele hydration te vermijden).
  await new Promise((resolve) => setTimeout(resolve, 0));
  const user = await getCurrentSessionUser();
  if (user && !state.auth?.loggedIn) {
    await hydrateFromSupabaseSession(user);
  }
}

export async function handleCloudSync(openAuthModal, showToast) {
  if (!isSupabaseConfigured()) {
    openAuthModal();
    showToast("Vul eerst `supabase-config.js` in met je Supabase URL en anon key. Daarna werkt online sync meteen.", "info");
    return;
  }

  const user = await getCurrentSessionUser();
  if (!user) {
    openAuthModal();
    return;
  }

  try {
    await syncStateToCloud("manual");
    showToast("De weekendpot is gesynchroniseerd met Supabase.", "success");
  } catch (error) {
    console.warn("Handmatige cloud-sync mislukte:", error);
    showToast("Cloud-sync is mislukt. Controleer of je SQL-setup en bucket in Supabase klaarstaan.", "error");
  }
}
