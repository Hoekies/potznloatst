import { primaryStorageKey, storageKey, migrationStorageKey, categoryLabels } from './constants.js';
import { sanitizeText, sanitizeAmount, sanitizeDate, sanitizeImageValue, fallbackColor, cloneData, createId, todayIso } from './utils.js';

function buildDemoState() {
  const participants = [
    { id: createId(), name: "Rene", color: "#0A1B36" },
    { id: createId(), name: "Sven", color: "#2563EB" },
    { id: createId(), name: "Joep", color: "#7C3AED" },
  ];

  return {
    weekend: {
      name: "Op z'n Loatst",
      appName: "Pot z,n Loatst",
    },
    auth: {
      loggedIn: false,
      provider: "local",
      email: "",
    },
    profile: {
      name: "",
      avatarUrl: "",
    },
    participants,
    contributions: [
      { id: createId(), participantId: participants[0].id, amount: 75, type: "initial", note: "Startpot", date: todayIso() },
      { id: createId(), participantId: participants[1].id, amount: 75, type: "initial", note: "Startpot", date: todayIso() },
      { id: createId(), participantId: participants[2].id, amount: 75, type: "initial", note: "Startpot", date: todayIso() },
      { id: createId(), participantId: "", amount: 20, type: "topup", note: "Extra drankbudget", date: todayIso() },
    ],
    expenses: [
      {
        id: createId(),
        description: "Accommodatie voorschot",
        amount: 120,
        category: "accommodatie",
        date: todayIso(),
        note: "Huisje alvast vastgelegd",
        receiptImage: "",
        ocrStatus: "manual",
      },
    ],
    estimates: [
      {
        id: createId(),
        description: "Boodschappen vrijdag",
        amount: 95,
        category: "eten",
        date: todayIso(),
        note: "Verwachte weekendboodschappen",
        pricingMode: "per_person",
        perPersonAmount: 31.67,
        participantCountSnapshot: 3,
      },
    ],
  };
}

export let state = null;

export function getState() {
  return state;
}

export function setState(newState) {
  state = newState;
}

export function readFromStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn("Lokale opslag lezen mislukt:", error);
    return null;
  }
}

export function writeToStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn("Lokale opslag bewaren mislukt:", error);
  }
}

export function normalizeEstimate(item, participantCount) {
  const pricingMode = item.pricingMode === "per_person" ? "per_person" : "total";
  const snapshot = pricingMode === "per_person"
    ? Math.max(1, Number(item.participantCountSnapshot) || participantCount || 1)
    : 0;
  const perPersonAmount = pricingMode === "per_person"
    ? sanitizeAmount(item.perPersonAmount || (snapshot ? Number(item.amount) / snapshot : 0))
    : 0;
  const amount = pricingMode === "per_person"
    ? sanitizeAmount(perPersonAmount * snapshot)
    : sanitizeAmount(item.amount);

  return {
    id: item.id || createId(),
    description: sanitizeText(item.description) || "Raming",
    amount,
    category: categoryLabels[item.category] ? item.category : "overig",
    paidBy: sanitizeText(item.paidBy),
    date: sanitizeDate(item.date),
    note: sanitizeText(item.note),
    pricingMode,
    perPersonAmount,
    participantCountSnapshot: snapshot,
  };
}

export function normalizeState(rawState) {
  const nextState = rawState && typeof rawState === "object" ? rawState : {};
  const participants = Array.isArray(nextState.participants) ? nextState.participants : [];
  const contributions = Array.isArray(nextState.contributions) ? nextState.contributions : [];
  const expenses = Array.isArray(nextState.expenses) ? nextState.expenses : [];
  const estimates = Array.isArray(nextState.estimates) ? nextState.estimates : [];

  return {
    weekend: {
      name: nextState.weekend?.name || "Op z'n Loatst",
      appName: nextState.weekend?.appName || "Pot z,n Loatst",
    },
    auth: {
      loggedIn: Boolean(nextState.auth?.loggedIn),
      provider: sanitizeText(nextState.auth?.provider || "local", 40) || "local",
      email: sanitizeText(nextState.auth?.email || "", 120),
      userId: sanitizeText(nextState.auth?.userId || "", 80),
      lastSyncedAt: sanitizeText(nextState.auth?.lastSyncedAt || "", 80),
    },
    profile: {
      name: sanitizeText(nextState.profile?.name || "", 80),
      avatarUrl: sanitizeImageValue(nextState.profile?.avatarUrl || ""),
    },
    participants: participants.map((participant, index) => ({
      id: participant.id || createId(),
      name: sanitizeText(participant.name) || `Deelnemer ${index + 1}`,
      color: participant.color || fallbackColor(index),
    })),
    contributions: contributions
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        id: item.id || createId(),
        participantId: item.type === "topup" ? "" : sanitizeText(item.participantId || "", 80),
        amount: sanitizeAmount(item.amount),
        type: item.type === "topup" ? "topup" : "initial",
        note: sanitizeText(item.note),
        date: sanitizeDate(item.date),
      })),
    expenses: expenses
      .filter((item) => item && typeof item === "object")
      .map((item) => ({
        id: item.id || createId(),
        description: sanitizeText(item.description) || "Uitgave",
        amount: sanitizeAmount(item.amount),
        category: categoryLabels[item.category] ? item.category : "overig",
        paidBy: sanitizeText(item.paidBy),
        date: sanitizeDate(item.date),
        note: sanitizeText(item.note),
        receiptImage: sanitizeImageValue(item.receiptImage),
        receiptPath: sanitizeText(item.receiptPath || "", 240),
        ocrStatus: sanitizeText(item.ocrStatus || "manual", 40) || "manual",
      })),
    estimates: estimates
      .filter((item) => item && typeof item === "object")
      .map((item) => normalizeEstimate(item, participants.length)),
  };
}

export function createEmptyState() {
  return normalizeState({
    weekend: {
      name: "Op z'n Loatst",
      appName: "Pot z,n Loatst",
    },
    auth: {
      loggedIn: false,
      provider: "local",
      email: "",
      userId: "",
      lastSyncedAt: "",
    },
    profile: {
      name: "",
      avatarUrl: "",
    },
    participants: [],
    contributions: [],
    expenses: [],
    estimates: [],
  });
}

export function loadState() {
  const v5 = readFromStorage(primaryStorageKey);
  if (v5) {
    try {
      return normalizeState(JSON.parse(v5));
    } catch (error) {
      return normalizeState(cloneData(buildDemoState()));
    }
  }

  const v4 = readFromStorage(storageKey);
  if (v4) {
    try {
      const parsed = normalizeState(JSON.parse(v4));
      writeToStorage(primaryStorageKey, JSON.stringify(parsed));
      try { localStorage.removeItem(storageKey); } catch (_) {}
      return parsed;
    } catch (error) {
      return normalizeState(cloneData(buildDemoState()));
    }
  }

  return normalizeState(cloneData(buildDemoState()));
}

let _render;
export function setRenderFn(fn) {
  _render = fn;
}

let _cloudHydrating = false;
export function getCloudHydrating() {
  return _cloudHydrating;
}
export function setCloudHydrating(val) {
  _cloudHydrating = val;
}

let _queueCloudSync;
export function setQueueCloudSync(fn) {
  _queueCloudSync = fn;
}

export function persistAndRender() {
  writeToStorage(primaryStorageKey, JSON.stringify(state));
  _render();
  if (!_cloudHydrating && _queueCloudSync) {
    _queueCloudSync("local-change");
  }
}

export function hasMeaningfulState(candidateState) {
  return Boolean(
    candidateState?.participants?.length ||
    candidateState?.contributions?.length ||
    candidateState?.expenses?.length ||
    candidateState?.estimates?.length ||
    candidateState?.profile?.name ||
    candidateState?.profile?.avatarUrl
  );
}

export function getMigrationMap() {
  try {
    const raw = readFromStorage(migrationStorageKey);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {};
  }
}

export function markMigrationDone(userId) {
  const map = getMigrationMap();
  map[userId] = new Date().toISOString();
  writeToStorage(migrationStorageKey, JSON.stringify(map));
}

export function wasMigrationDone(userId) {
  return Boolean(getMigrationMap()[userId]);
}
