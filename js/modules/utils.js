import { dateFormatter } from './constants.js';

export function createId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function cloneData(value) {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function sanitizeText(value, maxLength = 240) {
  return String(value || "").replace(/[<>\"'&]/g, "").trim().slice(0, maxLength);
}

export function sanitizeColor(value) {
  const s = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : "#0A1B36";
}

export function sanitizeAmount(value) {
  let str = String(value ?? "").trim();
  if (str.includes(",")) {
    // NL-notatie: punt is duizendtal-scheiding, komma is decimaal (bv. "1.234,56")
    str = str.replace(/\./g, "").replace(",", ".");
  }
  const amount = Number(str);
  if (!Number.isFinite(amount)) {
    return 0;
  }
  return Math.max(0, Math.min(999999, Math.round(amount * 100) / 100));
}

export function sanitizeDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? value : todayIso();
}

export function sanitizeImageValue(value) {
  const nextValue = String(value || "");
  if (!nextValue) {
    return "";
  }
  return /^(data:image\/|blob:|https?:\/\/|\.\/|\/)/.test(nextValue) ? nextValue : "";
}

export function formatDate(value) {
  return dateFormatter.format(new Date(value));
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function fallbackColor(index) {
  return ["#0A1B36", "#2563EB", "#06B6D4", "#7C3AED", "#1E3A8A"][index % 5];
}

export function categoryColor(category) {
  return {
    accommodatie: "#0A1B36",
    eten: "#7C3AED",
    drinken: "#06B6D4",
    activiteit: "#2563EB",
    vervoer: "#1E3A8A",
    overig: "#2563EB",
  }[category] || "#2563EB";
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Kon de bonfoto niet lezen."));
    reader.readAsDataURL(file);
  });
}

export function readFileAsText(file) {
  if (typeof file.text === "function") {
    return file.text();
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Kon dit bestand niet lezen."));
    reader.readAsText(file);
  });
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") {
    return;
  }
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./sw.js");
    } catch (error) {
      console.warn("Service worker registreren mislukt:", error);
    }
  });
}

/**
 * Werk de sync-status badge bij in de header.
 * @param {'local'|'syncing'|'synced'} status
 */
export function updateSyncStatus(status) {
  const badge = document.querySelector('#sync-status-badge');
  if (!badge) return;

  badge.className = `sync-badge sync-badge--${status}`;

  const iconEl = badge.querySelector('.sync-badge__icon');
  const labelEl = badge.querySelector('.sync-badge__label');

  const map = {
    local:   { icon: '\u{1F4BE}', label: 'Lokaal' },
    syncing: { icon: '☁️', label: 'Syncing…' },
    synced:  { icon: '✓', label: 'Gesynchroniseerd' },
  };

  const info = map[status] || map.local;
  if (iconEl) iconEl.textContent = info.icon;
  if (labelEl) labelEl.textContent = info.label;

  if (status === 'synced') {
    clearTimeout(badge._hideTimer);
    badge._hideTimer = setTimeout(() => {
      badge.classList.add('sync-badge--fade');
    }, 3000);
  } else {
    badge.classList.remove('sync-badge--fade');
  }
}

export function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = 'toast toast--' + type;
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast--visible'));
  setTimeout(() => {
    toast.classList.remove('toast--visible');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

