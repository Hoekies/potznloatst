import { authStatusFallback, CROP_SIZE } from './constants.js';
import { sanitizeText, sanitizeImageValue, fileToDataUrl } from './utils.js';
import { state, setState, createEmptyState, writeToStorage, persistAndRender } from './state.js';
import { primaryStorageKey } from './constants.js';
import {
  getSupabaseClient, isSupabaseConfigured, getCurrentSessionUser, saveProfileToCloud,
} from './cloud.js';

export function loginNaarEmail(gebruikersnaam) {
  return `${gebruikersnaam.toLowerCase().trim()}@potznloatst.local`;
}

export function emailNaarLogin(email) {
  return String(email || "").replace(/@potznloatst\.local$/, "");
}

export function isAdmin(user) {
  return user?.email === "admin@potznloatst.local";
}

let authModalBound = false;
let passwordResetModalBound = false;
let profileAvatarPreviewUrl = "";

export const cropState = {
  offset: { x: 0, y: 0 },
  scale: 1,
  baseScale: 1,
  naturalW: 0,
  naturalH: 0,
  pointerStart: null,
  offsetAtDragStart: null,
};

let _renderAccountUi;
export function setRenderAccountUiFn(fn) {
  _renderAccountUi = fn;
}

export function openPasswordResetModal() {
  const modal = document.querySelector("#password-reset-modal");
  const input = document.querySelector("#pw-reset-input");
  const status = document.querySelector("#pw-reset-status");
  if (!modal) return;
  if (input) input.value = "";
  if (status) { status.textContent = ""; status.hidden = true; }
  modal.hidden = false;
  bindPasswordResetModal();
}

export function closePasswordResetModal() {
  const modal = document.querySelector("#password-reset-modal");
  if (modal) modal.hidden = true;
}

function bindPasswordResetModal() {
  if (passwordResetModalBound) return;
  passwordResetModalBound = true;

  const form = document.querySelector("#password-reset-form");
  const toggle = document.querySelector("#pw-reset-toggle");
  const input = document.querySelector("#pw-reset-input");
  const status = document.querySelector("#pw-reset-status");

  const setStatus = (msg, isError = false) => {
    if (!status) return;
    status.textContent = msg;
    status.hidden = !msg;
    status.style.color = isError ? "#DC2626" : "";
  };

  toggle?.addEventListener("click", () => {
    if (!input) return;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    toggle.textContent = show ? "\u{1F648}" : "\u{1F441}";
    toggle.setAttribute("aria-label", show ? "Wachtwoord verbergen" : "Wachtwoord tonen");
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = String(input?.value || "");
    if (password.length < 6) {
      setStatus("Wachtwoord moet minimaal 6 tekens zijn.", true);
      return;
    }
    const client = getSupabaseClient();
    if (!client) { setStatus("Supabase is niet ingesteld.", true); return; }

    const submitBtn = form.querySelector('[type="submit"]');
    const origText = submitBtn?.textContent;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Opslaan…"; }
    setStatus("Wachtwoord wordt opgeslagen…");

    try {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      setStatus("Wachtwoord opgeslagen! Je bent nu ingelogd.");
      setTimeout(closePasswordResetModal, 2000);
    } catch (err) {
      setStatus(err?.message || "Opslaan mislukt.", true);
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = origText; }
    }
  });
}

export function openAuthModal(prefillUsername = "") {
  const authModal = document.querySelector("#auth-modal");
  const usernameInput = document.querySelector("#auth-username");
  const passwordInput = document.querySelector("#auth-password");
  if (!authModal || !usernameInput || !passwordInput) return;

  const statusNode = document.querySelector("#auth-status");
  if (statusNode) { statusNode.textContent = ""; statusNode.hidden = true; }
  usernameInput.value = prefillUsername || emailNaarLogin(state.auth?.email || "");
  passwordInput.value = "";
  authModal.hidden = false;
  bindAuthModal();
}

export function closeAuthModal() {
  const authModal = document.querySelector("#auth-modal");
  if (authModal) {
    authModal.hidden = true;
  }
}

export function setAuthStatus(message, isError = false) {
  const statusNode = document.querySelector("#auth-status");
  if (!statusNode) return;
  statusNode.textContent = message;
  statusNode.hidden = !message;
  statusNode.style.color = isError ? "#DC2626" : "";
}

export async function submitAuth() {
  const client = getSupabaseClient();
  if (!client) {
    setAuthStatus("Supabase is niet ingesteld.", true);
    return;
  }

  const usernameInput = document.querySelector("#auth-username");
  const passwordInput = document.querySelector("#auth-password");
  const gebruikersnaam = sanitizeText(usernameInput?.value || "", 80);
  const password = String(passwordInput?.value || "");

  if (!gebruikersnaam || password.length < 6) {
    setAuthStatus("Vul een gebruikersnaam en wachtwoord van minimaal 6 tekens in.", true);
    return;
  }

  const email = loginNaarEmail(gebruikersnaam);
  setAuthStatus("Inloggen...");

  try {
    const signInPromise = client.auth.signInWithPassword({ email, password });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Inloggen duurt te lang. Controleer je verbinding en probeer opnieuw.")), 15000)
    );
    const { data, error } = await Promise.race([signInPromise, timeoutPromise]);
    if (error) throw error;

    await upsertGebruiker(client, data.user, gebruikersnaam);
    setAuthStatus("Ingelogd. Je gegevens worden geladen.");
    closeAuthModal();
  } catch (error) {
    const msg = error?.message || "";
    const friendly = msg.includes("Invalid login") ? "Gebruikersnaam of wachtwoord klopt niet." : msg || "Inloggen is mislukt.";
    setAuthStatus(friendly, true);
  }
}

async function upsertGebruiker(client, user, gebruikersnaam) {
  if (!user) return;
  try {
    await client.from("gebruikers").upsert({
      id: user.id,
      gebruikersnaam,
      last_login_at: new Date().toISOString(),
    }, { onConflict: "id" });
  } catch (_) {}
}

export function bindAuthModal() {
  if (authModalBound) return;
  authModalBound = true;

  const authForm = document.querySelector("#auth-form");
  const closeAuthButton = document.querySelector("#close-auth");
  const authModal = document.querySelector("#auth-modal");
  const pwToggle = document.querySelector("#auth-password-toggle");
  const pwInput = document.querySelector("#auth-password");

  authForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAuth();
  });

  pwToggle?.addEventListener("click", () => {
    if (!pwInput) return;
    const show = pwInput.type === "password";
    pwInput.type = show ? "text" : "password";
    pwToggle.textContent = show ? "\u{1F648}" : "\u{1F441}";
    pwToggle.setAttribute("aria-label", show ? "Wachtwoord verbergen" : "Wachtwoord tonen");
  });

  closeAuthButton?.addEventListener("click", closeAuthModal);
  authModal?.addEventListener("click", (event) => {
    if (event.target?.dataset?.closeAuth === "true") closeAuthModal();
  });
}

let adminGebruikersModalBound = false;

export function openAdminGebruikersModal() {
  const modal = document.querySelector("#admin-gebruikers-modal");
  if (!modal) return;
  modal.hidden = false;
  bindAdminGebruikersModal();
  laadGebruikers();
}

export function closeAdminGebruikersModal() {
  const modal = document.querySelector("#admin-gebruikers-modal");
  if (modal) modal.hidden = true;
}

async function laadGebruikers() {
  const listEl = document.querySelector("#admin-gebruikers-list");
  if (!listEl) return;
  const client = getSupabaseClient();
  if (!client) return;

  listEl.textContent = "Laden…";
  const { data, error } = await client
    .from("gebruikers")
    .select("id, gebruikersnaam, created_at, last_login_at")
    .order("created_at", { ascending: true });

  if (error || !data) {
    listEl.textContent = "Kon gebruikers niet laden.";
    return;
  }

  if (!data.length) {
    listEl.innerHTML = '<p style="color:var(--muted);font-size:0.85rem;">Nog geen gebruikers.</p>';
    return;
  }

  listEl.innerHTML = data.map(g => {
    const isAdminUser = g.gebruikersnaam === "admin";
    const login = new Date(g.last_login_at || g.created_at).toLocaleDateString("nl-NL");
    return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">
      <div style="flex:1;min-width:0;">
        <strong style="font-size:0.9rem;">${sanitizeText(g.gebruikersnaam)}</strong>
        ${isAdminUser ? '<span style="font-size:0.7rem;background:var(--primary);color:#fff;border-radius:4px;padding:1px 5px;margin-left:4px;">admin</span>' : ""}
        <div style="font-size:0.75rem;color:var(--muted);">Laatste login: ${login}</div>
      </div>
      ${!isAdminUser ? `<button class="ghost-button ghost-button--small" data-verwijder-gebruiker="${g.id}" style="color:#DC2626;">Verwijder</button>` : ""}
    </div>`;
  }).join("");

  listEl.querySelectorAll("[data-verwijder-gebruiker]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Deze gebruiker verwijderen?")) return;
      const uid = btn.dataset.verwijderGebruiker;
      const client2 = getSupabaseClient();
      await client2.from("gebruikers").delete().eq("id", uid);
      await laadGebruikers();
    });
  });
}

function bindAdminGebruikersModal() {
  if (adminGebruikersModalBound) return;
  adminGebruikersModalBound = true;

  document.querySelector("#close-admin-gebruikers")?.addEventListener("click", closeAdminGebruikersModal);
  document.querySelector("#admin-gebruikers-modal")?.addEventListener("click", e => {
    if (e.target?.dataset?.closeAdminGebruikers === "true") closeAdminGebruikersModal();
  });

  document.querySelector("#admin-gebruiker-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const statusEl = document.querySelector("#admin-gebruiker-status");
    const naamInput = document.querySelector("#admin-gebruiker-naam");
    const wwInput = document.querySelector("#admin-gebruiker-ww");
    const submitBtn = e.target.querySelector('[type="submit"]');

    const gebruikersnaam = sanitizeText(naamInput?.value || "", 40);
    const password = String(wwInput?.value || "");

    const setStatus = (msg, isError = false) => {
      if (!statusEl) return;
      statusEl.textContent = msg;
      statusEl.hidden = !msg;
      statusEl.style.color = isError ? "#DC2626" : "var(--success, #16a34a)";
    };

    if (!gebruikersnaam || password.length < 6) {
      setStatus("Vul een gebruikersnaam en wachtwoord van min. 6 tekens in.", true);
      return;
    }

    const client = getSupabaseClient();
    if (!client) { setStatus("Supabase niet ingesteld.", true); return; }

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Aanmaken…"; }
    setStatus("Bezig…");

    try {
      const email = loginNaarEmail(gebruikersnaam);
      const { data, error } = await client.auth.signUp({ email, password });
      if (error) throw error;

      if (data?.user) {
        await client.from("gebruikers").upsert({
          id: data.user.id,
          gebruikersnaam,
          last_login_at: null,
        }, { onConflict: "id" });
      }

      setStatus(`Gebruiker "${gebruikersnaam}" aangemaakt.`);
      if (naamInput) naamInput.value = "";
      if (wwInput) wwInput.value = "";
      await laadGebruikers();
    } catch (err) {
      const msg = err?.message || "";
      const friendly = msg.includes("already registered") ? `Gebruikersnaam "${gebruikersnaam}" bestaat al.` : msg || "Aanmaken mislukt.";
      setStatus(friendly, true);
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Aanmaken"; }
    }
  });
}

let _renderFn;
export function setAuthRenderFn(fn) {
  _renderFn = fn;
}

export async function toggleLocalLoginState(showToast) {
  if (state.auth?.loggedIn) {
    setState(createEmptyState());
    writeToStorage(primaryStorageKey, JSON.stringify(state));
    if (_renderFn) _renderFn();

    const client = getSupabaseClient();
    if (client) {
      try {
        await Promise.race([
          client.auth.signOut({ scope: "local" }),
          new Promise((_, reject) => setTimeout(() => reject(new Error("signOut timeout")), 3000)),
        ]);
      } catch (_) {}
    }
    return;
  }

  const client = getSupabaseClient();
  if (!client) {
    showToast("Supabase is nog niet ingesteld. Vul eerst supabase-config.js in.", "info");
    return;
  }
  openAuthModal();
}

export function getProfileName(profileNameInput) {
  return sanitizeText(profileNameInput?.value || state.profile?.name || "", 80) || "Lokaal profiel";
}

export function getProfileAvatarSource(profileAvatarFileInput, profileAvatarUrlInput) {
  const uploadedFile = profileAvatarFileInput?.files?.[0];
  if (uploadedFile) {
    if (profileAvatarPreviewUrl) {
      URL.revokeObjectURL(profileAvatarPreviewUrl);
    }
    profileAvatarPreviewUrl = URL.createObjectURL(uploadedFile);
    return profileAvatarPreviewUrl;
  }
  if (profileAvatarPreviewUrl) {
    URL.revokeObjectURL(profileAvatarPreviewUrl);
    profileAvatarPreviewUrl = "";
  }
  return sanitizeImageValue(profileAvatarUrlInput?.value || state.profile?.avatarUrl || "");
}

export function openProfileModal(dom) {
  if (!dom.profileModal) return;
  if (dom.profileNameInput) dom.profileNameInput.value = state.profile?.name || "";
  if (dom.profileAvatarUrlInput) dom.profileAvatarUrlInput.value = state.profile?.avatarUrl || "";
  if (dom.profileAvatarFileInput) dom.profileAvatarFileInput.value = "";
  if (_renderAccountUi) _renderAccountUi();
  dom.profileModal.hidden = false;
}

export function closeProfileModal(dom) {
  if (!dom.profileModal) return;
  dom.profileModal.hidden = true;
  resetCropper();
  if (dom.profileAvatarFileInput) dom.profileAvatarFileInput.value = "";
  if (profileAvatarPreviewUrl) {
    URL.revokeObjectURL(profileAvatarPreviewUrl);
    profileAvatarPreviewUrl = "";
  }
  if (_renderAccountUi) _renderAccountUi();
}

export async function saveProfile(event, dom) {
  event.preventDefault();
  state.profile.name = sanitizeText(dom.profileNameInput.value, 80);
  state.profile.avatarUrl = sanitizeImageValue(dom.profileAvatarUrlInput?.value || "");

  if (dom.profileAvatarFileInput.files?.[0]) {
    const blob = await getCroppedAvatarBlob();
    state.profile.avatarUrl = await fileToDataUrl(blob || dom.profileAvatarFileInput.files[0]);
  }

  persistAndRender();
  const user = await getCurrentSessionUser();
  if (user) {
    await saveProfileToCloud(user);
  }
  closeProfileModal(dom);
}

export function initCropper(file) {
  const wrap = document.querySelector("#avatar-crop-wrap");
  const img = document.querySelector("#avatar-crop-img");
  const zoom = document.querySelector("#avatar-crop-zoom");
  if (!wrap || !img || !zoom) return;
  const url = URL.createObjectURL(file);
  img.onload = () => {
    URL.revokeObjectURL(url);
    cropState.naturalW = img.naturalWidth;
    cropState.naturalH = img.naturalHeight;
    cropState.baseScale = Math.max(CROP_SIZE / cropState.naturalW, CROP_SIZE / cropState.naturalH);
    cropState.scale = cropState.baseScale;
    cropState.offset = clampCropOffset({
      x: (CROP_SIZE - cropState.naturalW * cropState.scale) / 2,
      y: (CROP_SIZE - cropState.naturalH * cropState.scale) / 2,
    });
    zoom.value = 100;
    applyCropTransform();
    wrap.hidden = false;
  };
  img.src = url;
}

export function clampCropOffset(offset) {
  const scaledW = cropState.naturalW * cropState.scale;
  const scaledH = cropState.naturalH * cropState.scale;
  return {
    x: Math.min(Math.max(offset.x, CROP_SIZE - scaledW), 0),
    y: Math.min(Math.max(offset.y, CROP_SIZE - scaledH), 0),
  };
}

export function applyCropTransform() {
  const img = document.querySelector("#avatar-crop-img");
  if (img) img.style.transform = `translate(${cropState.offset.x}px,${cropState.offset.y}px) scale(${cropState.scale})`;
}

export function resetCropper() {
  const wrap = document.querySelector("#avatar-crop-wrap");
  const img = document.querySelector("#avatar-crop-img");
  const zoom = document.querySelector("#avatar-crop-zoom");
  if (wrap) wrap.hidden = true;
  if (img) img.src = "";
  if (zoom) zoom.value = 100;
  cropState.offset = { x: 0, y: 0 };
  cropState.scale = 1;
  cropState.baseScale = 1;
  cropState.naturalW = 0;
  cropState.naturalH = 0;
  cropState.pointerStart = null;
}

export async function getCroppedAvatarBlob() {
  const img = document.querySelector("#avatar-crop-img");
  if (!img || !cropState.naturalW) return null;
  const OUT = 400;
  const canvas = document.createElement("canvas");
  canvas.width = OUT;
  canvas.height = OUT;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img,
    -cropState.offset.x / cropState.scale, -cropState.offset.y / cropState.scale,
    CROP_SIZE / cropState.scale, CROP_SIZE / cropState.scale,
    0, 0, OUT, OUT
  );
  return new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
}
