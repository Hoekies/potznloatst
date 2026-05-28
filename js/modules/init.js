import * as dom from './dom.js';
import { state, setState, loadState, persistAndRender, createEmptyState, normalizeState, writeToStorage, setRenderFn, setQueueCloudSync } from './state.js';
import { primaryStorageKey, CROP_SIZE } from './constants.js';
import { todayIso, createId, readFileAsText, showToast, fileToDataUrl, updateSyncStatus, registerServiceWorker } from './utils.js';
import {
  render, renderWeekendLogo, renderParticipants, renderTopups, renderTimeline,
  renderAccountUi, renderTabs,
} from './render.js';
import {
  setActiveTab, getActiveTab,
  setEditingParticipantId, getEditingParticipantId,
  setEditingTopupId, getEditingTopupId,
  setEditingRecord, getEditingRecord,
} from './ui-state.js';
import {
  collectExpenseForm, resetExpenseComposer, showReceiptReview, openReceiptModal, closeReceiptModal,
  setPendingReceiptImage, getPendingReceiptImage,
  saveParticipantEdits, saveTopupEdits, saveExpenseEdits, saveTimelineEdits,
  convertEstimateToExpense, removeRecord, renderExpenseComposerState, updateEstimateEditMode,
} from './forms.js';
import {
  openAuthModal, closeAuthModal, bindAuthModal, toggleLocalLoginState,
  openProfileModal, closeProfileModal, saveProfile, initCropper, getCroppedAvatarBlob,
  clampCropOffset, applyCropTransform, resetCropper,
  getProfileName, getProfileAvatarSource, cropState,
  setRenderAccountUiFn, setAuthRenderFn, openPasswordResetModal,
  openAdminGebruikersModal, submitAuth,
} from './auth.js';
import {
  bootstrapCloudFeatures, handleCloudSync, queueCloudSync, setRenderFn as setCloudRenderFn,
  warmUpSupabase,
} from './cloud.js';

export function initializeApp() {
  registerServiceWorker();
  warmUpSupabase(); // Ping Supabase direct bij opstart zodat het project alvast wakker wordt

  // Altijd starten als niet ingelogd — Supabase herstelt een geldige sessie automatisch
  const loadedState = loadState();
  if (loadedState.auth) loadedState.auth.loggedIn = false;
  setState(loadedState);

  setRenderFn(() => renderAll());
  setCloudRenderFn(() => renderAll());
  setAuthRenderFn(() => renderAll());

  // Sync-badge koppelen: wrapper rond queueCloudSync die de badge bijwerkt
  setQueueCloudSync((reason) => {
    updateSyncStatus('syncing');
    const result = queueCloudSync(reason);
    // Na kort moment: als er geen actieve sync is, toon 'synced'
    setTimeout(() => {
      if (state.auth?.loggedIn) {
        updateSyncStatus('synced');
      } else {
        updateSyncStatus('local');
      }
    }, 1800);
    return result;
  });
  setRenderAccountUiFn(() => renderAccountUiNow());

  setupEventListeners();

  dom.expenseDateInput.value = todayIso();
  renderWeekendLogo(getDomBundle());
  try { renderExpenseComposerState(getDomBundle(), state); } catch (e) { console.warn('renderExpenseComposerState:', e); }
  renderAccountUiNow();
  positionMenuPanel();

  renderAll();

  // Login overlay toont nu (loggedIn=false) — het formulier zit direct IN de overlay.
  // Focus op het gebruikersnaamveld zodat de gebruiker direct kan typen.
  setTimeout(() => {
    const usernameInput = document.querySelector("#auth-username");
    usernameInput?.focus();
  }, 50);

  bootstrapCloudFeatures(
    () => bindAuthModal(),
    () => renderAccountUiNow(),
    () => openPasswordResetModal(),
    () => closeAuthModal(),
  );
}

function getDomBundle() {
  return {
    ...dom,
    positionMenuPanel,
  };
}

function renderAll() {
  render(getDomBundle());
  renderAccountUiNow();
}

function renderAccountUiNow() {
  renderAccountUi(
    getDomBundle(),
    () => getProfileName(dom.profileNameInput),
    () => getProfileAvatarSource(dom.profileAvatarFileInput, dom.profileAvatarUrlInput),
  );
}

function positionMenuPanel() {
  if (!dom.menuPanelContent || !dom.menuPanelTrigger || !dom.menuPanel?.classList.contains("is-open")) {
    if (dom.menuPanelContent) {
      dom.menuPanelContent.hidden = true;
    }
    dom.menuBackdrop.hidden = true;
    return;
  }

  dom.menuBackdrop.hidden = false;
  dom.menuPanelContent.hidden = false;
}

function toggleMenuPanel() {
  if (!dom.menuPanel) return;
  const nextOpen = !dom.menuPanel.classList.contains("is-open");
  dom.menuPanel.classList.toggle("is-open", nextOpen);
  if (dom.menuPanelTrigger) {
    dom.menuPanelTrigger.setAttribute("aria-expanded", nextOpen ? "true" : "false");
  }
  positionMenuPanel();
}

function closeMenuPanel() {
  if (!dom.menuPanel) return;
  dom.menuPanel.classList.remove("is-open");
  if (dom.menuPanelTrigger) {
    dom.menuPanelTrigger.setAttribute("aria-expanded", "false");
  }
  dom.menuBackdrop.hidden = true;
  if (dom.menuPanelContent) {
    dom.menuPanelContent.hidden = true;
  }
}

function toggleAccountDropdown() {
  if (!dom.accountDropdown) return;
  const next = dom.accountDropdown.hidden;
  dom.accountDropdown.hidden = !next;
  dom.accountToggleButton?.setAttribute("aria-expanded", next ? "true" : "false");
}

function closeAccountDropdown() {
  if (!dom.accountDropdown) return;
  dom.accountDropdown.hidden = true;
  dom.accountToggleButton?.setAttribute("aria-expanded", "false");
}

function resetUiState() {
  setPendingReceiptImage("");
  setEditingParticipantId(null);
  setEditingTopupId(null);
  setEditingRecord(null);
  setActiveTab("overzicht");
  closeReceiptModal(dom);
  resetExpenseComposer(dom);
}

async function exportStateToFile() {
  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    app: "Pot z,n Loatst",
    data: state,
  };
  const fileName = `potzloats-${todayIso()}.json`;
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });

  if (typeof File === "function" && navigator.share && navigator.canShare) {
    try {
      const shareFile = new File([blob], fileName, { type: "application/json" });
      if (navigator.canShare({ files: [shareFile] })) {
        await navigator.share({
          files: [shareFile],
          title: "Pot z,n Loatst export",
          text: "Bewaar of deel je potbestand.",
        });
        return;
      }
    } catch (error) {
      console.warn("Delen van exportbestand mislukt, probeer downloadfallback.", error);
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);

  if (/iPad|iPhone|iPod/.test(navigator.userAgent) && !navigator.share) {
    window.open(url, "_blank", "noopener");
  }
}

async function importStateFromFile(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    const text = await readFileAsText(file);
    const parsed = JSON.parse(text);
    const nextValue = parsed && typeof parsed === "object" ? parsed.data || parsed : null;
    if (!nextValue || typeof nextValue !== "object" || Array.isArray(nextValue)) {
      throw new Error("Ongeldig bestand");
    }
    setState(normalizeState(nextValue));
    resetUiState();
    persistAndRender();
  } catch (error) {
    showToast("Kon dit bestand niet inlezen als Pot z,n Loatst-data.", "error");
  } finally {
    if (dom.importStateFileInput) dom.importStateFileInput.value = "";
  }
}

function setupEventListeners() {
  dom.tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveTab(button.dataset.tabTarget);
      renderTabs(getDomBundle());
    });
  });

  dom.menuPanelTrigger?.addEventListener("click", toggleMenuPanel);
  window.addEventListener("resize", positionMenuPanel);
  window.addEventListener("scroll", positionMenuPanel, { passive: true });
  dom.menuBackdrop.addEventListener("click", (event) => {
    if (event.target === dom.menuBackdrop) {
      closeMenuPanel();
    }
  });
  document.addEventListener("click", (event) => {
    if (dom.accountDropdown && !dom.accountDropdown.hidden) {
      if (!dom.accountToggleButton?.contains(event.target) && !dom.accountDropdown.contains(event.target)) {
        closeAccountDropdown();
      }
    }
    if (!dom.menuPanel?.classList?.contains("is-open")) {
      return;
    }
    if (dom.menuPanel?.contains(event.target) || dom.menuPanelContent?.contains(event.target)) {
      return;
    }
    closeMenuPanel();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenuPanel();
    }
  });

  dom.participantForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = dom.participantNameInput.value.trim();
    const amount = Number(dom.participantInitialInput.value);
    const color = dom.participantColorInput.value;

    if (!name || !Number.isFinite(amount) || amount < 0) {
      return;
    }

    const submitBtn = dom.participantForm.querySelector('[type="submit"]');
    const origText = submitBtn?.textContent;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Toevoegen…"; }

    const participantId = createId();
    state.participants.push({
      id: participantId,
      name,
      color,
    });

    state.contributions.push({
      id: createId(),
      participantId,
      amount,
      type: "initial",
      note: "Startinleg",
      date: todayIso(),
    });

    dom.participantForm.reset();
    dom.participantColorInput.value = "#2563EB";
    persistAndRender();

    if (submitBtn) {
      setTimeout(() => { submitBtn.disabled = false; submitBtn.textContent = origText; }, 400);
    }
  });

  dom.topupForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const amount = Number(dom.topupAmountInput.value);
    const note = dom.topupNoteInput.value.trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      return;
    }

    const submitBtn = dom.topupForm.querySelector('[type="submit"]');
    const origText = submitBtn?.textContent;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Toevoegen…"; }

    state.contributions.unshift({
      id: createId(),
      participantId: "",
      amount,
      type: "topup",
      note,
      date: todayIso(),
    });

    dom.topupForm.reset();
    persistAndRender();

    if (submitBtn) {
      setTimeout(() => { submitBtn.disabled = false; submitBtn.textContent = origText; }, 400);
    }
  });

  dom.expenseForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitBtn = dom.expenseForm.querySelector('#expense-submit');
    const origText = submitBtn?.textContent;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Opslaan…"; }

    const payload = await collectExpenseForm(dom);
    if (!payload) {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = origText; }
      return;
    }

    const targetCollection = payload.kind === "estimate" ? state.estimates : state.expenses;
    const { kind, ...record } = payload;
    targetCollection.unshift(record);
    if (kind === "estimate") {
      setActiveTab("overzicht");
      dom.filterCategory.value = "all";
    }
    resetExpenseComposer(dom);
    persistAndRender();

    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = origText; }
  });

  dom.expenseKindInput.addEventListener("change", () => renderExpenseComposerState(getDomBundle(), state));
  dom.estimatePricingModeInput.addEventListener("change", () => renderExpenseComposerState(getDomBundle(), state));
  dom.expenseAmountInput.addEventListener("input", () => renderExpenseComposerState(getDomBundle(), state));
  dom.estimatePerPersonAmountInput?.addEventListener("input", () => renderExpenseComposerState(getDomBundle(), state));


  dom.participantsList.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;

    const participantId = target.dataset.id;

    if (target.dataset.action === "edit-participant") {
      setEditingParticipantId(participantId);
      renderParticipants(getDomBundle());
      return;
    }

    if (target.dataset.action === "cancel-participant") {
      setEditingParticipantId(null);
      renderParticipants(getDomBundle());
      return;
    }

    if (target.dataset.action === "save-participant") {
      const card = target.closest("[data-participant-card]");
      saveParticipantEdits(participantId, card);
      setEditingParticipantId(null);
      return;
    }

    if (target.dataset.action === "remove-participant") {
      state.participants = state.participants.filter((p) => p.id !== participantId);
      state.contributions = state.contributions.filter((item) => item.participantId !== participantId);
      if (getEditingParticipantId() === participantId) {
        setEditingParticipantId(null);
      }
      persistAndRender();
    }
  });

  function handleReceiptFileChange(event) {
    if (!event.target.matches('[data-field="receipt-file"]')) return;
    const file = event.target.files?.[0];
    if (!file) return;
    const card = event.target.closest('[data-expense-card], [data-timeline-card]');
    if (!card) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const hidden = card.querySelector('[data-field="receipt-data"]');
      if (hidden) hidden.value = e.target.result;
      const thumb = card.querySelector('.inline-edit-receipt__thumb');
      if (thumb) { thumb.src = e.target.result; thumb.hidden = false; }
    };
    reader.readAsDataURL(file);
  }

  dom.expenseList.addEventListener("change", (event) => {
    if (event.target.matches('[data-field="pricingMode"]')) {
      updateEstimateEditMode(event.target.closest('[data-expense-card], [data-timeline-card]'));
    }
    handleReceiptFileChange(event);
  });

  dom.timeline.addEventListener("change", (event) => {
    if (event.target.matches('[data-field="pricingMode"]')) {
      updateEstimateEditMode(event.target.closest('[data-expense-card], [data-timeline-card]'));
    }
    handleReceiptFileChange(event);
  });

  dom.expenseList.addEventListener("input", (event) => {
    if (event.target.matches('[data-field="perPersonAmount"], [data-field="participantCountSnapshot"]')) {
      updateEstimateEditMode(event.target.closest('[data-expense-card], [data-timeline-card]'));
    }
  });

  dom.timeline.addEventListener("input", (event) => {
    if (event.target.matches('[data-field="perPersonAmount"], [data-field="participantCountSnapshot"]')) {
      updateEstimateEditMode(event.target.closest('[data-expense-card], [data-timeline-card]'));
    }
  });

  dom.topupList.addEventListener("click", (event) => {
    const target = event.target.closest("[data-topup-action]");
    if (!target) return;

    const topupId = target.dataset.id;

    if (target.dataset.topupAction === "edit") {
      setEditingTopupId(topupId);
      renderTopups(getDomBundle());
      return;
    }

    if (target.dataset.topupAction === "cancel") {
      setEditingTopupId(null);
      renderTopups(getDomBundle());
      return;
    }

    if (target.dataset.topupAction === "save") {
      const row = target.closest("[data-topup-card]");
      saveTopupEdits(topupId, row);
      setEditingTopupId(null);
      return;
    }

    if (target.dataset.topupAction === "remove") {
      state.contributions = state.contributions.filter((item) => item.id !== topupId);
      if (getEditingTopupId() === topupId) {
        setEditingTopupId(null);
      }
      persistAndRender();
    }
  });

  dom.expenseList.addEventListener("click", (event) => {
    const target = event.target.closest("[data-expense-action]");
    if (!target) return;

    const expenseId = target.dataset.id;
    const expenseKind = target.dataset.kind || "expense";

    if (target.dataset.expenseAction === "edit") {
      setEditingRecord({ kind: expenseKind, id: expenseId, scope: "management" });
      renderAll();
      return;
    }

    if (target.dataset.expenseAction === "cancel") {
      setEditingRecord(null);
      renderAll();
      return;
    }

    if (target.dataset.expenseAction === "save") {
      const row = target.closest("[data-expense-card]");
      saveExpenseEdits(expenseId, expenseKind, row);
      setEditingRecord(null);
      return;
    }

    if (target.dataset.expenseAction === "remove") {
      removeRecord(expenseKind, expenseId);
      persistAndRender();
      return;
    }

    if (target.dataset.expenseAction === "convert") {
      convertEstimateToExpense(expenseId);
      return;
    }

    if (target.dataset.expenseAction === "view-receipt") {
      const expense = state.expenses.find((item) => item.id === expenseId);
      if (expense?.receiptImage) {
        openReceiptModal(expense.receiptImage, dom);
      }
    }
  });

  dom.timeline.addEventListener("click", (event) => {
    const target = event.target.closest("[data-timeline-action]");
    if (!target) return;

    const kind = target.dataset.kind;
    const id = target.dataset.id;
    const action = target.dataset.timelineAction;

    if (action === "edit") {
      setEditingRecord({ kind, id, scope: "timeline" });
      renderTimeline(getDomBundle());
      return;
    }

    if (action === "cancel") {
      setEditingRecord(null);
      renderTimeline(getDomBundle());
      return;
    }

    if (action === "save") {
      const row = target.closest("[data-timeline-card]");
      saveTimelineEdits(kind, id, row);
      setEditingRecord(null);
      return;
    }

    if (action === "remove") {
      removeRecord(kind, id);
      persistAndRender();
      return;
    }

    if (action === "convert") {
      convertEstimateToExpense(id);
    }
  });

  dom.filterCategory.addEventListener("change", () => renderTimeline(getDomBundle()));

  dom.resetDemoButton?.addEventListener("click", () => {
    setState(createEmptyState());
    resetUiState();
    persistAndRender();
  });

  dom.expenseReceiptInput.addEventListener("change", async () => {
    if (!dom.expenseReceiptInput.files[0]) {
      setPendingReceiptImage("");
      dom.receiptReview.hidden = true;
      return;
    }
    setPendingReceiptImage(await fileToDataUrl(dom.expenseReceiptInput.files[0]));
    showReceiptReview("Bon toegevoegd. Tik op de afbeelding om te vergroten.", "klaar_voor_review", dom);
  });

  dom.receiptPreview.addEventListener("click", () => {
    if (getPendingReceiptImage()) {
      openReceiptModal(getPendingReceiptImage(), dom);
    }
  });

  dom.closeReceiptModalButton.addEventListener("click", () => closeReceiptModal(dom));
  dom.receiptModal.addEventListener("click", (event) => {
    if (event.target.dataset.closeReceiptModal === "true") {
      closeReceiptModal(dom);
    }
  });

  dom.exportStateButton?.addEventListener("click", exportStateToFile);
  dom.importStateButton?.addEventListener("click", () => dom.importStateFileInput?.click());
  dom.importStateFileInput?.addEventListener("change", importStateFromFile);
  dom.accountToggleButton?.addEventListener("click", toggleAccountDropdown);
  dom.accountLoginButton?.addEventListener("click", () => {
    closeAccountDropdown();
    toggleLocalLoginState(showToast);
  });
  dom.openProfileButton?.addEventListener("click", () => {
    closeAccountDropdown();
    openProfileModal(dom);
  });
  document.querySelector("#open-admin-gebruikers")?.addEventListener("click", () => {
    closeAccountDropdown();
    openAdminGebruikersModal();
  });
  dom.closeProfileButton?.addEventListener("click", () => closeProfileModal(dom));
  dom.profileModal?.addEventListener("click", (event) => {
    if (event.target?.dataset?.closeProfile === "true") {
      closeProfileModal(dom);
    }
  });
  dom.profileResetAvatarButton?.addEventListener("click", () => {
    if (dom.profileAvatarUrlInput) dom.profileAvatarUrlInput.value = "";
    if (dom.profileAvatarFileInput) dom.profileAvatarFileInput.value = "";
    resetCropper();
    state.profile.avatarUrl = "";
    renderAccountUiNow();
  });
  dom.profileNameInput?.addEventListener("input", renderAccountUiNow);
  dom.profileAvatarUrlInput?.addEventListener("input", renderAccountUiNow);
  dom.profileAvatarFileInput?.addEventListener("change", () => {
    const file = dom.profileAvatarFileInput.files?.[0];
    if (file) initCropper(file); else resetCropper();
    renderAccountUiNow();
  });
  dom.profileForm?.addEventListener("submit", (event) => saveProfile(event, dom));
  dom.syncCloudButton?.addEventListener("click", () => handleCloudSync(() => openAuthModal(), showToast));

  document.querySelector("#login-wall-btn")?.addEventListener("click", () => openAuthModal());

  dom.cropStage?.addEventListener("pointerdown", (e) => {
    dom.cropStage.setPointerCapture(e.pointerId);
    cropState.pointerStart = { x: e.clientX, y: e.clientY };
    cropState.offsetAtDragStart = { ...cropState.offset };
  });
  dom.cropStage?.addEventListener("pointermove", (e) => {
    if (!cropState.pointerStart) return;
    cropState.offset = clampCropOffset({
      x: cropState.offsetAtDragStart.x + e.clientX - cropState.pointerStart.x,
      y: cropState.offsetAtDragStart.y + e.clientY - cropState.pointerStart.y,
    });
    applyCropTransform();
  });
  dom.cropStage?.addEventListener("pointerup", () => { cropState.pointerStart = null; });
  dom.cropStage?.addEventListener("pointercancel", () => { cropState.pointerStart = null; });

  dom.cropZoom?.addEventListener("input", () => {
    if (!cropState.naturalW) return;
    const newScale = cropState.baseScale * (dom.cropZoom.value / 100);
    const cx = CROP_SIZE / 2;
    const cy = CROP_SIZE / 2;
    const imgCx = (cx - cropState.offset.x) / cropState.scale;
    const imgCy = (cy - cropState.offset.y) / cropState.scale;
    cropState.scale = newScale;
    cropState.offset = clampCropOffset({ x: cx - imgCx * cropState.scale, y: cy - imgCy * cropState.scale });
    applyCropTransform();
  });

  document.querySelector("#avatar-crop-reset")?.addEventListener("click", () => {
    resetCropper();
    if (dom.profileAvatarFileInput) dom.profileAvatarFileInput.value = "";
  });

  // Binding voor #login-overlay-form en #login-overlay-eye zit in app.js
  // (top-level, vóór init-chain) zodat ze gegarandeerd worden gebonden.
}
