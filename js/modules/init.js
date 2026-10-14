import * as dom from './dom.js';
import { state, setState, loadState, persistAndRender, createEmptyState, normalizeState, writeToStorage, setRenderFn, setQueueCloudSync, readBackupSnapshot } from './state.js';
import { primaryStorageKey, CROP_SIZE, categoryLabels, currencyFormatter } from './constants.js';
import { todayIso, createId, readFileAsText, showToast, fileToDataUrl, compressImageToDataUrl, updateSyncStatus, registerServiceWorker, sanitizeAmount, fallbackColor, formatDate } from './utils.js';
import { calculateSummary, getSortedParticipants, getEstimateAmount } from './calculations.js';
import {
  render, renderWeekendLogo, renderParticipants, renderExpenses, renderTimeline,
  renderAccountUi, renderTabs, setGroupOpen, toggleExpandedRow, collapseTimeline,
} from './render.js';
import {
  setActiveTab, getActiveTab,
  setEditingParticipantId, getEditingParticipantId,
  setEditingRecord, getEditingRecord,
} from './ui-state.js';
import {
  collectExpenseForm, resetExpenseComposer, showReceiptReview, openReceiptModal, closeReceiptModal,
  setPendingReceiptImage, getPendingReceiptImage, syncCategoryChips,
  saveParticipantEdits, saveExpenseEdits, saveTimelineEdits,
  convertEstimateToExpense, convertExpenseToEstimate, convertInlegEstimate, removeRecord, renderExpenseComposerState, updateEstimateEditMode,
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
  bootstrapCloudFeatures, handleCloudSync, queueCloudSync, syncStateToCloud, setRenderFn as setCloudRenderFn,
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
  return { ...dom };
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

function toggleAccountDropdown() {
  if (!dom.accountDropdown) return;
  const next = dom.accountDropdown.hidden;
  dom.accountDropdown.hidden = !next;
  dom.accountToggleButton?.setAttribute("aria-expanded", next ? "true" : "false");
  if (next && dom.restoreBackupButton) {
    dom.restoreBackupButton.hidden = !readBackupSnapshot();
  }
}

function closeAccountDropdown() {
  if (!dom.accountDropdown) return;
  dom.accountDropdown.hidden = true;
  dom.accountToggleButton?.setAttribute("aria-expanded", "false");
}

function resetUiState() {
  setPendingReceiptImage("");
  setEditingParticipantId(null);
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

let jsPdfLoadPromise = null;

// jsPDF wordt pas opgehaald zodra iemand echt op "Balans delen" klikt, zodat
// de eerste paginalading niet wacht op een library die de meeste sessies
// nooit gebruiken.
function ensureJsPdfLoaded() {
  if (window.jspdf?.jsPDF) {
    return Promise.resolve(window.jspdf.jsPDF);
  }
  if (!jsPdfLoadPromise) {
    jsPdfLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      script.onload = () => resolve(window.jspdf?.jsPDF || null);
      script.onerror = () => reject(new Error("jsPDF kon niet geladen worden"));
      document.head.appendChild(script);
    }).catch((error) => {
      jsPdfLoadPromise = null;
      throw error;
    });
  }
  return jsPdfLoadPromise;
}

function buildBalancePdfBlob(JsPdfCtor) {
  if (!JsPdfCtor) {
    return null;
  }

  const doc = new JsPdfCtor({ unit: "mm", format: "a4" });
  const summary = calculateSummary(state);
  const marginX = 18;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  let y = 20;

  const ensureSpace = (needed = 7) => {
    if (y + needed > pageHeight - 16) {
      doc.addPage();
      y = 20;
    }
  };

  const addSectionHeader = (text) => {
    ensureSpace(14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(27, 94, 32);
    doc.text(text, marginX, y);
    y += 5;
    doc.setDrawColor(46, 125, 50);
    doc.setLineWidth(0.4);
    doc.line(marginX, y, pageWidth - marginX, y);
    doc.setTextColor(20, 20, 20);
    y += 6;
  };

  const addRow = (label, amount, opts = {}) => {
    ensureSpace();
    doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(10);
    const maxLabelWidth = pageWidth - marginX * 2 - 32;
    const labelLines = doc.splitTextToSize(label, maxLabelWidth);
    doc.text(labelLines, marginX, y);
    if (typeof amount === "number") {
      doc.text(currencyFormatter.format(amount), pageWidth - marginX, y, { align: "right" });
    }
    y += 5 * labelLines.length;
  };

  const addNote = (text) => {
    ensureSpace();
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9.5);
    doc.setTextColor(90, 90, 90);
    doc.text(text, marginX, y);
    doc.setTextColor(20, 20, 20);
    y += 6;
  };

  const addSpacer = (amount = 4) => { y += amount; };

  // Titel
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(20, 20, 20);
  doc.text(`Balans — ${state.weekend?.name || "Pot z'n Loatst"}`, marginX, y);
  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text(`Gegenereerd op ${new Date().toLocaleDateString("nl-NL")}`, marginX, y);
  doc.setTextColor(20, 20, 20);
  y += 10;

  // Samenvatting
  addSectionHeader("Samenvatting");
  addRow("Totaal ingelegd", summary.totalInitial + summary.totalTopups, { bold: true });
  addRow("Uitgegeven", -summary.totalExpenses);
  addRow("Resterend budget", summary.remaining, { bold: true });
  if (summary.participantCount) {
    addRow("Per persoon over", summary.remainingPerPerson);
  }
  addSpacer(6);

  // Inleg per persoon
  addSectionHeader("Inleg per persoon");
  const participants = getSortedParticipants(state);
  if (!participants.length) {
    addNote("Nog geen deelnemers toegevoegd.");
  } else {
    let perPersonTotal = 0;
    participants.forEach((participant) => {
      const contribution = state.contributions.find((item) => item.participantId === participant.id && item.type === "initial");
      const amount = contribution?.amount || 0;
      perPersonTotal += amount;
      addRow(`${participant.name}${contribution?.isEstimate ? " (raming)" : ""}`, amount);
    });
    addRow("Subtotaal inleg per persoon", perPersonTotal, { bold: true });
  }
  addSpacer(6);

  // Extra inleg
  addSectionHeader("Extra inleg");
  const topups = state.contributions.filter((item) => item.type === "topup");
  if (!topups.length) {
    addNote("Geen extra inleg.");
  } else {
    let topupTotal = 0;
    topups.forEach((topup) => {
      topupTotal += topup.amount;
      addRow(`${topup.note || "Extra inleg"}${topup.isEstimate ? " (raming)" : ""} — ${formatDate(topup.date)}`, topup.amount);
    });
    addRow("Subtotaal extra inleg", topupTotal, { bold: true });
  }
  addSpacer(6);

  // Uitgaven per categorie
  addSectionHeader("Uitgaven per categorie");
  if (!state.expenses.length) {
    addNote("Nog geen uitgaven geregistreerd.");
  } else {
    Object.entries(categoryLabels).forEach(([key, label]) => {
      const items = state.expenses.filter((item) => item.category === key);
      if (!items.length) return;
      ensureSpace(10);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10.5);
      doc.text(label, marginX, y);
      y += 5.5;
      let categoryTotal = 0;
      items.forEach((item) => {
        categoryTotal += item.amount;
        addRow(`   ${item.description} — ${formatDate(item.date)}`, item.amount);
      });
      addRow(`   Subtotaal ${label.toLowerCase()}`, categoryTotal, { bold: true });
      addSpacer(3);
    });
  }
  addRow("Totaal uitgaven", summary.totalExpenses, { bold: true });
  addSpacer(6);

  // Ramingen (nog niet definitief)
  if (state.estimates.length) {
    addSectionHeader("Ramingen (nog niet definitief)");
    let estimateTotal = 0;
    state.estimates.forEach((item) => {
      const amount = getEstimateAmount(item);
      estimateTotal += amount;
      addRow(`${item.description} (${categoryLabels[item.category] || "Overig"})`, amount);
    });
    addRow("Subtotaal ramingen", estimateTotal, { bold: true });
  }

  return doc.output("blob");
}

// Tekst met *vet* in WhatsApp-opmaak. Volgorde: wat is er nu (ingelegd,
// uitgegeven, in de pot, per persoon), dan wat er nog in de raming staat,
// en tot slot wat er na de ramingen overblijft.
function buildBalanceWhatsappText() {
  const s = calculateSummary(state);
  const eur = (value) => currencyFormatter.format(value);
  const title = state.weekend?.name || "Pot z'n Loatst";
  const lines = [
    `*${title} — stand van de pot*`,
    `_${formatDate(todayIso())}_`,
    "",
    `💰 Ingelegd: *${eur(s.totalInitial + s.totalTopups)}*`,
    `🧾 Uitgegeven: *${eur(s.totalExpenses)}*`,
    `🏦 Nu in de pot: *${eur(s.remaining)}*`,
    `👤 Per persoon over: *${eur(s.remainingPerPerson)}*${s.participantCount ? ` (${s.participantCount} ${s.participantCount === 1 ? "deelnemer" : "deelnemers"})` : ""}`,
  ];

  if (s.totalEstimates > 0 || s.totalInlegEstimates > 0) {
    lines.push("", "🔮 *Nog in de raming (niet definitief)*");
    if (s.totalEstimates > 0) lines.push(`• Nog uit te geven: ${eur(s.totalEstimates)}`);
    if (s.totalInlegEstimates > 0) lines.push(`• Nog te ontvangen inleg: ${eur(s.totalInlegEstimates)}`);
    lines.push(
      "",
      `➡️ Na ramingen in de pot: *${eur(s.remainingAfterEstimates)}*`,
      `➡️ Per persoon na ramingen: *${eur(s.remainingAfterEstimatesPerPerson)}*`,
    );
  }

  return lines.join("\n");
}

function shareBalanceWhatsapp() {
  const text = buildBalanceWhatsappText();
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}

async function shareBalancePdf() {
  let JsPdfCtor;
  try {
    JsPdfCtor = await ensureJsPdfLoaded();
  } catch (error) {
    showToast("PDF-bibliotheek kon niet geladen worden. Controleer je internetverbinding en probeer opnieuw.", "error");
    return;
  }

  const blob = buildBalancePdfBlob(JsPdfCtor);
  if (!blob) {
    showToast("PDF-bibliotheek kon niet geladen worden. Controleer je internetverbinding en probeer opnieuw.", "error");
    return;
  }

  const fileName = `pot-balans-${todayIso()}.pdf`;

  if (typeof File === "function" && navigator.share && navigator.canShare) {
    try {
      const shareFile = new File([blob], fileName, { type: "application/pdf" });
      if (navigator.canShare({ files: [shareFile] })) {
        await navigator.share({
          files: [shareFile],
          title: "Balans van de pot",
          text: "Hier is de balans van de weekendpot.",
        });
        return;
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
      console.warn("Delen van PDF mislukt, probeer downloadfallback.", error);
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
  showToast("PDF gedownload. Open 'm vanuit je downloads om te delen via WhatsApp.", "info");
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

function restoreFromLocalBackup() {
  const backup = readBackupSnapshot();
  if (!backup) {
    showToast("Geen lokale back-up gevonden op dit toestel.", "info");
    return;
  }

  const { data, savedAt } = backup;
  const savedLabel = savedAt ? new Date(savedAt).toLocaleString("nl-NL") : "onbekend moment";
  const summary = `${data.participants.length} deelnemers, ${data.contributions.length} inlegposten, `
    + `${data.expenses.length} uitgaven en ${data.estimates.length} ramingen`;

  const confirmed = confirm(
    `Lokale back-up van ${savedLabel} herstellen?\n\n${summary}\n\n`
    + "Dit vervangt de huidige gegevens op dit toestel (en wordt meteen gesynchroniseerd naar de cloud als je bent ingelogd)."
  );
  if (!confirmed) return;

  setState({ ...data, auth: state.auth, sharedView: state.sharedView });
  resetUiState();
  persistAndRender();
  showToast("Back-up hersteld.", "success");
}

async function startFreshBalance() {
  const newName = prompt("Naam voor de nieuwe balans:", state.weekend?.name || "");
  if (newName === null) return;

  const trimmedName = newName.trim();
  if (!trimmedName) {
    showToast("Vul een naam in voor de nieuwe balans.", "error");
    return;
  }

  const confirmed = confirm(
    `Nieuwe, lege balans "${trimmedName}" beginnen?\n\n`
    + "Alle huidige deelnemers, inleg en uitgaven worden gewist (lokaal én in de cloud als je bent ingelogd).\n\n"
    + "Er is automatisch een lokale back-up van de huidige balans bewaard — die kun je via \"Herstel back-up\" terugzetten als dit een vergissing was."
  );
  if (!confirmed) return;

  const preservedAuth = { ...state.auth };
  const preservedProfile = { ...state.profile };
  setState(createEmptyState());
  state.auth = preservedAuth;
  state.profile = preservedProfile;
  state.weekend = { name: trimmedName, appName: state.weekend?.appName || "Pot z,n Loatst" };

  resetUiState();
  persistAndRender();

  // Direct en bewust aanroepen i.p.v. via queueCloudSync(): die wachtrij kan
  // een lopende sync samenvoegen tot één vervolg-aanroep met reason "queued",
  // waardoor "reset-confirmed" verloren gaat en de cloud-wipe (het
  // vangnet in syncStateToCloud weigert normaal een lege staat te
  // synchroniseren) stilletjes wordt overgeslagen — en de oude clouddata
  // bij de volgende hydration gewoon terugkomt.
  if (state.auth?.loggedIn) {
    try {
      await syncStateToCloud("reset-confirmed");
    } catch (error) {
      console.warn("Cloud-reset mislukte:", error);
      showToast(`Lokaal gereset naar "${trimmedName}", maar synchroniseren met de cloud is mislukt. Probeer het later opnieuw.`, "error");
      return;
    }
  }

  showToast(`Nieuwe balans "${trimmedName}" gestart.`, "success");
}

function participantNameRowHtml() {
  return `
    <div class="participant-name-row">
      <label class="icon-field">
        <span class="icon-field__icon" aria-hidden="true">&#128100;</span>
        <input type="text" class="participant-name-input" placeholder="Naam" autocomplete="off" aria-label="Naam" />
      </label>
      <label class="inline-raming" title="Nog een raming">
        <input type="checkbox" class="participant-raming-input" aria-label="Raming" />
        <span aria-hidden="true">&#128302;</span>
      </label>
    </div>
  `;
}

function addParticipantNameRow() {
  if (!dom.participantNameRows) return;
  dom.participantNameRows.insertAdjacentHTML("beforeend", participantNameRowHtml());
}

function resetParticipantNameRows() {
  if (!dom.participantNameRows) return;
  dom.participantNameRows.innerHTML = participantNameRowHtml();
  syncParticipantAmountMode();
}

function syncParticipantAmountMode() {
  if (!dom.participantInitialInput) return;
  dom.participantInitialInput.placeholder = dom.participantAmountModeInput?.checked
    ? "Totaalbedrag, wordt verdeeld"
    : "Startinleg per persoon";
}

function setupEventListeners() {
  dom.tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveTab(button.dataset.tabTarget);
      renderTabs(getDomBundle());
    });
  });

  document.addEventListener("click", (event) => {
    if (dom.accountDropdown && !dom.accountDropdown.hidden) {
      if (!dom.accountToggleButton?.contains(event.target) && !dom.accountDropdown.contains(event.target)) {
        closeAccountDropdown();
      }
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAccountDropdown();
    }
  });

  dom.participantForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const amount = sanitizeAmount(dom.participantInitialInput.value);

    if (!Number.isFinite(amount) || amount < 0) {
      showToast("Vul een geldige startinleg in.", "error");
      return;
    }

    const rows = Array.from(dom.participantNameRows?.querySelectorAll(".participant-name-row") || []);
    const entries = rows
      .map((row) => ({
        name: row.querySelector(".participant-name-input")?.value.trim() || "",
        isEstimate: row.querySelector(".participant-raming-input")?.checked || false,
      }))
      .filter((entry) => entry.name);

    if (!entries.length) {
      showToast("Vul minstens één naam in.", "error");
      return;
    }

    const isTotalMode = Boolean(dom.participantAmountModeInput?.checked);
    const amountPerPerson = isTotalMode ? sanitizeAmount(amount / entries.length) : amount;

    const submitBtn = dom.participantForm.querySelector('[type="submit"]');
    const origText = submitBtn?.textContent;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Toevoegen…"; }

    entries.forEach((entry) => {
      const participantId = createId();
      state.participants.push({
        id: participantId,
        name: entry.name,
        color: fallbackColor(state.participants.length),
      });
      state.contributions.push({
        id: createId(),
        participantId,
        amount: amountPerPerson,
        type: "initial",
        isEstimate: entry.isEstimate,
        note: "Startinleg",
        date: todayIso(),
      });
    });

    dom.participantForm.reset();
    resetParticipantNameRows();
    persistAndRender();

    if (submitBtn) {
      setTimeout(() => { submitBtn.disabled = false; submitBtn.textContent = origText; }, 400);
    }
  });

  dom.addParticipantRowButton?.addEventListener("click", () => addParticipantNameRow());
  dom.participantAmountModeInput?.addEventListener("change", syncParticipantAmountMode);

  dom.topupForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const amount = sanitizeAmount(dom.topupAmountInput.value);
    const note = dom.topupNoteInput.value.trim();
    const isEstimate = dom.topupIsEstimateInput?.checked || false;

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
      isEstimate,
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
    resetExpenseComposer(dom);
    persistAndRender();

    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = origText; }
  });

  dom.expenseKindInput.addEventListener("change", () => renderExpenseComposerState(getDomBundle(), state));
  dom.estimatePricingModeInput.addEventListener("change", () => renderExpenseComposerState(getDomBundle(), state));
  dom.expenseAmountInput.addEventListener("input", () => renderExpenseComposerState(getDomBundle(), state));


  dom.participantsList.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) {
      const row = event.target.closest("[data-row-toggle]");
      if (row) {
        toggleExpandedRow(row.dataset.rowToggle);
        renderParticipants(getDomBundle());
      }
      return;
    }

    const participantId = target.dataset.id;

    if (target.dataset.action === "convert-participant") {
      const initial = state.contributions.find((item) => item.participantId === participantId && item.type === "initial");
      if (initial) convertInlegEstimate(initial.id);
      return;
    }

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
      if (!confirm("Deze deelnemer én zijn/haar inleg verwijderen? Dit kan niet ongedaan worden gemaakt.")) return;
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
    compressImageToDataUrl(file)
      .catch((error) => {
        console.warn("Bonfoto verkleinen mislukt, originele foto wordt gebruikt:", error);
        return fileToDataUrl(file);
      })
      .then((dataUrl) => {
        const hidden = card.querySelector('[data-field="receipt-data"]');
        if (hidden) hidden.value = dataUrl;
        const thumb = card.querySelector('.inline-edit-receipt__thumb');
        if (thumb) { thumb.src = dataUrl; thumb.hidden = false; }
      });
  }

  // Wijzig-formulieren gebruiken dezelfde categorie-chips en camera/upload-
  // knoppen als het invoegformulier, maar dan dynamisch opnieuw gerenderd
  // bij elke edit — daarom hier via delegatie i.p.v. de eenmalige binding
  // die het statische invoegformulier gebruikt.
  function handleEditCategoryClick(event) {
    const chip = event.target.closest("[data-edit-category]");
    if (!chip) return;
    const editCard = chip.closest(".edit-card");
    if (!editCard) return;
    editCard.querySelectorAll(".category-chips .category-chip").forEach((c) => {
      c.classList.toggle("is-active", c === chip);
    });
    const hidden = editCard.querySelector('[data-field="category"]');
    if (hidden) hidden.value = chip.dataset.editCategory;
  }

  function handleReceiptTriggerClick(event) {
    const trigger = event.target.closest("[data-receipt-trigger]");
    if (!trigger) return;
    const card = trigger.closest('[data-expense-card], [data-timeline-card]');
    const input = card?.querySelector(`[data-receipt-input="${trigger.dataset.receiptTrigger}"]`);
    input?.click();
  }

  function handleEditPerPersonChange(event) {
    const checkbox = event.target.closest("[data-edit-per-person]");
    if (!checkbox) return;
    const editCard = checkbox.closest(".edit-card");
    const hidden = editCard?.querySelector('[data-field="pricingMode"]');
    if (hidden) hidden.value = checkbox.checked ? "per_person" : "total";
    updateEstimateEditMode(checkbox.closest('[data-expense-card], [data-timeline-card]'));
  }

  dom.expenseList.addEventListener("click", handleEditCategoryClick);
  dom.expenseList.addEventListener("click", handleReceiptTriggerClick);
  dom.timeline.addEventListener("click", handleEditCategoryClick);
  dom.timeline.addEventListener("click", handleReceiptTriggerClick);

  dom.expenseList.addEventListener("change", (event) => {
    handleEditPerPersonChange(event);
    handleReceiptFileChange(event);
  });

  dom.timeline.addEventListener("change", (event) => {
    handleEditPerPersonChange(event);
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

  dom.expenseList.addEventListener("click", (event) => {
    const target = event.target.closest("[data-expense-action]");
    if (!target) {
      const row = event.target.closest("[data-row-toggle]");
      if (row) {
        toggleExpandedRow(row.dataset.rowToggle);
        renderExpenses(getDomBundle());
      }
      return;
    }

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
      if (!confirm("Deze uitgave verwijderen? Dit kan niet ongedaan worden gemaakt.")) return;
      removeRecord(expenseKind, expenseId);
      persistAndRender();
      return;
    }

    if (target.dataset.expenseAction === "convert") {
      convertEstimateToExpense(expenseId);
      return;
    }

    if (target.dataset.expenseAction === "convert-to-estimate") {
      convertExpenseToEstimate(expenseId);
      return;
    }

    if (target.dataset.expenseAction === "view-receipt") {
      const expense = state.expenses.find((item) => item.id === expenseId);
      if (expense?.receiptImage) {
        openReceiptModal(expense.receiptImage, dom);
      }
    }
  });

  // "toggle" op <details> bubbelt niet, dus luisteren in de capture-fase
  // op een voorouder om bij te houden welke groep (categorie/inleg) de
  // gebruiker open heeft staan. Zonder dit zou elke her-render (bv. na een
  // andere wijziging) alle groepen weer dichtklappen.
  const timelinePanel = dom.timeline.closest("details");
  timelinePanel?.addEventListener("toggle", (event) => {
    if (event.target !== timelinePanel || timelinePanel.open) return;
    collapseTimeline();
    renderTimeline(getDomBundle());
  });

  const trackGroupToggles = (container) => {
    container.addEventListener("toggle", (event) => {
      const details = event.target.closest?.("[data-group-key]");
      if (!details) return;
      setGroupOpen(details.dataset.groupKey, details.open);
      if (details.open) {
        container.querySelectorAll("details[data-group-key][open]").forEach((other) => {
          if (other !== details) other.open = false;
        });
      }
    }, true);
  };
  trackGroupToggles(dom.timeline);
  trackGroupToggles(dom.expenseList);

  dom.timeline.addEventListener("click", (event) => {
    const target = event.target.closest("[data-timeline-action]");
    if (!target) {
      const card = event.target.closest("[data-timeline-toggle]");
      if (card) {
        toggleExpandedRow(card.dataset.timelineToggle);
        renderTimeline(getDomBundle());
      }
      return;
    }

    const kind = target.dataset.kind;
    const id = target.dataset.id;
    const action = target.dataset.timelineAction;

    if (action === "view-receipt") {
      const expense = state.expenses.find((item) => item.id === id);
      if (expense?.receiptImage) {
        openReceiptModal(expense.receiptImage, dom);
      }
      return;
    }

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
      if (!confirm("Deze regel verwijderen? Dit kan niet ongedaan worden gemaakt.")) return;
      removeRecord(kind, id);
      persistAndRender();
      return;
    }

    if (action === "convert") {
      convertEstimateToExpense(id);
      return;
    }

    if (action === "convert-inleg") {
      convertInlegEstimate(id);
      return;
    }

    if (action === "convert-to-estimate") {
      convertExpenseToEstimate(id);
    }
  });

  const handleReceiptPickerChange = async (fileInput) => {
    const file = fileInput.files[0];
    if (!file) return;
    try {
      setPendingReceiptImage(await compressImageToDataUrl(file));
    } catch (error) {
      console.warn("Bonfoto verkleinen mislukt, originele foto wordt gebruikt:", error);
      setPendingReceiptImage(await fileToDataUrl(file));
    }
    showReceiptReview("Bon toegevoegd. Tik op de afbeelding om te vergroten.", "klaar_voor_review", dom);
  };

  dom.expenseReceiptInput.addEventListener("change", () => handleReceiptPickerChange(dom.expenseReceiptInput));
  dom.expenseReceiptUploadInput?.addEventListener("change", () => handleReceiptPickerChange(dom.expenseReceiptUploadInput));
  dom.receiptCameraButton?.addEventListener("click", () => dom.expenseReceiptInput.click());
  dom.receiptUploadButton?.addEventListener("click", () => dom.expenseReceiptUploadInput.click());

  document.querySelectorAll(".category-chips .category-chip").forEach((chip) => {
    chip.addEventListener("click", () => syncCategoryChips(dom, chip.dataset.category));
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

  dom.shareWhatsappButton?.addEventListener("click", shareBalanceWhatsapp);
  dom.shareBalancePdfButton?.addEventListener("click", () => {
    closeAccountDropdown();
    shareBalancePdf();
  });
  dom.exportStateButton?.addEventListener("click", exportStateToFile);
  dom.importStateButton?.addEventListener("click", () => dom.importStateFileInput?.click());
  dom.importStateFileInput?.addEventListener("change", importStateFromFile);
  dom.restoreBackupButton?.addEventListener("click", restoreFromLocalBackup);
  dom.startFreshBalanceButton?.addEventListener("click", () => {
    closeAccountDropdown();
    startFreshBalance();
  });
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
