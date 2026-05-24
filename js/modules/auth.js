import { authStatusFallback, CROP_SIZE } from './constants.js';
import { sanitizeText, sanitizeImageValue, fileToDataUrl } from './utils.js';
import { state, setState, createEmptyState, writeToStorage, persistAndRender } from './state.js';
import { primaryStorageKey } from './constants.js';
import {
  getSupabaseClient, isSupabaseConfigured, getCurrentSessionUser, saveProfileToCloud,
} from './cloud.js';

let authModalBound = false;
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

export function openAuthModal(prefillEmail = "") {
  const authModal = document.querySelector("#auth-modal");
  const emailInput = document.querySelector("#auth-email");
  const passwordInput = document.querySelector("#auth-password");
  if (!authModal || !emailInput || !passwordInput) return;

  const statusNode = document.querySelector("#auth-status");
  if (statusNode) { statusNode.textContent = ""; statusNode.hidden = true; }
  emailInput.value = prefillEmail || state.auth?.email || "";
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

export async function submitAuth(mode) {
  const client = getSupabaseClient();
  if (!client) {
    setAuthStatus("Vul eerst `supabase-config.js` in met je Supabase URL en anon key.", true);
    return;
  }

  const emailInput = document.querySelector("#auth-email");
  const passwordInput = document.querySelector("#auth-password");
  const email = sanitizeText(emailInput?.value || "", 120);
  const password = String(passwordInput?.value || "");
  const displayName = sanitizeText(state.profile?.name || "", 80);

  if (!email || password.length < 6) {
    setAuthStatus("Vul een geldig e-mailadres en een wachtwoord van minimaal 6 tekens in.", true);
    return;
  }

  setAuthStatus(mode === "signup" ? "Account wordt aangemaakt..." : "Inloggen...");

  try {
    if (mode === "signup") {
      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          data: {
            display_name: displayName,
          },
        },
      });
      if (error) {
        throw error;
      }

      if (displayName) {
        state.profile.name = displayName;
      }

      if (data?.session?.user) {
        await saveProfileToCloud(data.session.user);
        setAuthStatus("Account aangemaakt. Je bent ingelogd en je data wordt nu gesynchroniseerd.");
        closeAuthModal();
      } else {
        setAuthStatus("Account aangemaakt. Bevestig je e-mail en log daarna in.");
      }
      if (_renderAccountUi) _renderAccountUi();
      return;
    }

    const signInPromise = client.auth.signInWithPassword({ email, password });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Inloggen duurt te lang. Controleer je verbinding en probeer opnieuw.")), 15000)
    );
    const { data, error } = await Promise.race([signInPromise, timeoutPromise]);
    if (error) {
      throw error;
    }

    setAuthStatus("Ingelogd. Je gegevens worden geladen.");
    closeAuthModal();
  } catch (error) {
    setAuthStatus(error?.message || "Inloggen is mislukt.", true);
  }
}

export function bindAuthModal() {
  if (authModalBound) return;
  authModalBound = true;

  const authForm = document.querySelector("#auth-form");
  const authSignUpButton = document.querySelector("#auth-sign-up");
  const closeAuthButton = document.querySelector("#close-auth");
  const authModal = document.querySelector("#auth-modal");
  const pwToggle = document.querySelector("#auth-password-toggle");
  const pwInput = document.querySelector("#auth-password");

  authForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAuth("signin");
  });

  authSignUpButton?.addEventListener("click", async () => {
    await submitAuth("signup");
  });

  pwToggle?.addEventListener("click", () => {
    if (!pwInput) return;
    const show = pwInput.type === "password";
    pwInput.type = show ? "text" : "password";
    pwToggle.textContent = show ? "\u{1F648}" : "\u{1F441}";
    pwToggle.setAttribute("aria-label", show ? "Wachtwoord verbergen" : "Wachtwoord tonen");
  });

  const forgotButton = document.querySelector("#auth-forgot");
  forgotButton?.addEventListener("click", async () => {
    const emailInput = document.querySelector("#auth-email");
    const email = sanitizeText(emailInput?.value || "", 120);
    if (!email) {
      setAuthStatus("Vul eerst je e-mailadres in.", true);
      emailInput?.focus();
      return;
    }
    const client = getSupabaseClient();
    if (!client) {
      setAuthStatus("Supabase is niet ingesteld.", true);
      return;
    }
    setAuthStatus("Reset-mail wordt verstuurd...");
    try {
      const resetPromise = client.auth.resetPasswordForEmail(email, {
        redirectTo: "https://potznloatst.vercel.app",
      });
      const { error } = await Promise.race([
        resetPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Versturen duurt te lang. Probeer opnieuw.")), 15000)
        ),
      ]);
      if (error) throw error;
      setAuthStatus("E-mail verstuurd. Check je inbox (en de spamfolder) voor de reset-link.");
    } catch (error) {
      setAuthStatus(error?.message || "Versturen is mislukt.", true);
    }
  });

  closeAuthButton?.addEventListener("click", closeAuthModal);
  authModal?.addEventListener("click", (event) => {
    if (event.target?.dataset?.closeAuth === "true") closeAuthModal();
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
