import { sanitizeAmount, sanitizeText, fileToDataUrl, todayIso, createId, showToast } from './utils.js';
import { currencyFormatter } from './constants.js';
import { state, persistAndRender } from './state.js';
import { getEstimateAmount } from './calculations.js';
import { setEditingRecord, getEditingRecord, renderEstimateSummaryText } from './render.js';

let pendingReceiptImage = "";

export function getPendingReceiptImage() { return pendingReceiptImage; }
export function setPendingReceiptImage(val) { pendingReceiptImage = val; }

export async function collectExpenseForm(dom) {
  const kind = dom.expenseKindInput.value;
  const description = dom.expenseDescriptionInput.value.trim();
  const category = dom.expenseCategoryInput.value;
  const date = dom.expenseDateInput.value;
  const note = dom.expenseNoteInput.value.trim();
  const pricingMode = kind === "estimate" ? dom.estimatePricingModeInput.value : "total";
  const participantCountSnapshot = kind === "estimate" && pricingMode === "per_person" ? state.participants.length : 0;
  const perPersonAmount = kind === "estimate" && pricingMode === "per_person"
    ? sanitizeAmount(dom.estimatePerPersonAmountInput?.value)
    : 0;
  const amount = kind === "estimate" && pricingMode === "per_person"
    ? sanitizeAmount(perPersonAmount * participantCountSnapshot)
    : sanitizeAmount(dom.expenseAmountInput.value);

  if (kind === "estimate" && pricingMode === "per_person" && participantCountSnapshot < 1) {
    showToast("Voeg eerst minimaal 1 deelnemer toe voordat je een raming per persoon opslaat.", "info");
    return null;
  }

  if (!description || !Number.isFinite(amount) || amount <= 0 || !date) {
    return null;
  }

  const receiptImage = kind === "expense"
    ? pendingReceiptImage || (dom.expenseReceiptInput.files[0] ? await fileToDataUrl(dom.expenseReceiptInput.files[0]) : "")
    : "";

  return {
    id: createId(),
    kind,
    description,
    amount,
    category,
    date,
    note,
    receiptImage,
    ocrStatus: receiptImage ? "reviewed" : "manual",
    pricingMode,
    perPersonAmount,
    participantCountSnapshot,
  };
}

export function resetExpenseComposer(dom) {
  dom.expenseForm.reset();
  dom.expenseKindInput.value = "expense";
  dom.estimatePricingModeInput.value = "total";
  dom.expenseDateInput.value = todayIso();
  pendingReceiptImage = "";
  dom.receiptReview.hidden = true;
}

export function showReceiptReview(message, status, dom) {
  dom.ocrMessage.textContent = message;
  dom.ocrStatus.textContent = status.replace(/_/g, " ");
  if (dom.receiptPreviewImage) {
    dom.receiptPreviewImage.src = pendingReceiptImage || "";
  }
  dom.receiptReview.hidden = false;
}

export function openReceiptModal(imageSource, dom) {
  dom.receiptModalImage.src = imageSource;
  dom.receiptModal.hidden = false;
}

export function closeReceiptModal(dom) {
  dom.receiptModal.hidden = true;
  dom.receiptModalImage.src = "";
}


export function saveParticipantEdits(participantId, card) {
  const participant = state.participants.find((item) => item.id === participantId);
  const initialContribution = state.contributions.find((item) => item.participantId === participantId && item.type === "initial");
  if (!participant || !initialContribution || !card) {
    return;
  }

  const name = card.querySelector('[data-field="name"]').value.trim();
  const color = card.querySelector('[data-field="color"]').value;
  const initialAmount = Number(card.querySelector('[data-field="initial"]').value);
  const isEstimateField = card.querySelector('[data-field="initialIsEstimate"]');

  if (!name || !Number.isFinite(initialAmount) || initialAmount < 0) {
    return;
  }

  participant.name = name;
  participant.color = color;
  initialContribution.amount = initialAmount;
  if (isEstimateField) initialContribution.isEstimate = isEstimateField.checked;
  persistAndRender();
}

export function saveTopupEdits(topupId, row) {
  const topup = state.contributions.find((item) => item.id === topupId && item.type === "topup");
  if (!topup || !row) {
    return;
  }

  const amount = Number(row.querySelector('[data-field="amount"]').value);
  const note = row.querySelector('[data-field="note"]').value.trim();
  const isEstimateField = row.querySelector('[data-field="isEstimate"]');

  if (!Number.isFinite(amount) || amount <= 0) {
    return;
  }

  topup.participantId = "";
  topup.amount = amount;
  topup.note = note;
  if (isEstimateField) topup.isEstimate = isEstimateField.checked;
  persistAndRender();
}

export function saveExpenseEdits(expenseId, kind, row) {
  const collection = kind === "estimate" ? state.estimates : state.expenses;
  const expense = collection.find((item) => item.id === expenseId);
  if (!expense || !row) {
    return;
  }

  const description = row.querySelector('[data-field="description"]').value.trim();
  const category = row.querySelector('[data-field="category"]').value;
  const date = row.querySelector('[data-field="date"]').value;
  const note = row.querySelector('[data-field="note"]').value.trim();
  const pricingMode = kind === "estimate" ? row.querySelector('[data-field="pricingMode"]').value : "total";
  const participantCountSnapshot = kind === "estimate" ? Math.max(0, Number(row.querySelector('[data-field="participantCountSnapshot"]').value) || state.participants.length) : 0;
  const perPersonAmount = kind === "estimate" && pricingMode === "per_person"
    ? sanitizeAmount(row.querySelector('[data-field="perPersonAmount"]').value)
    : 0;
  const amount = kind === "estimate" && pricingMode === "per_person"
    ? sanitizeAmount(perPersonAmount * participantCountSnapshot)
    : sanitizeAmount(row.querySelector('[data-field="amount"]').value);

  if (!description || !Number.isFinite(amount) || amount <= 0 || !date) {
    return;
  }

  expense.description = description;
  expense.amount = amount;
  expense.category = category;
  expense.date = date;
  expense.note = note;
  if (kind === "estimate") {
    expense.pricingMode = pricingMode;
    expense.perPersonAmount = pricingMode === "per_person" ? perPersonAmount : 0;
    expense.participantCountSnapshot = pricingMode === "per_person" ? participantCountSnapshot : 0;
  }
  const receiptData = row.querySelector('[data-field="receipt-data"]')?.value;
  if (receiptData) {
    expense.receiptImage = receiptData;
    expense.receiptPath = "";
    expense.ocrStatus = "reviewed";
  }
  persistAndRender();
}

export function saveTimelineEdits(kind, id, row) {
  if (kind === "contribution" || kind === "contribution-estimate" || kind === "topup" || kind === "topup-estimate") {
    const item = state.contributions.find((entry) => entry.id === id);
    if (!item || !row) return;
    const amount = Number(row.querySelector('[data-field="amount"]').value);
    const date = row.querySelector('[data-field="date"]').value;
    const note = row.querySelector('[data-field="note"]').value.trim();
    if (!Number.isFinite(amount) || amount < 0 || !date) return;
    item.amount = amount;
    item.date = date;
    item.note = note;
    persistAndRender();
    return;
  }

  saveExpenseEdits(id, kind, row);
}

export function convertEstimateToExpense(id) {
  const estimate = state.estimates.find((item) => item.id === id);
  if (!estimate) return;

  state.expenses.unshift({
    id: createId(),
    description: estimate.description,
    amount: estimate.amount,
    category: estimate.category,
    date: estimate.date,
    note: estimate.note,
    receiptImage: "",
    ocrStatus: "manual",
  });
  state.estimates = state.estimates.filter((item) => item.id !== id);
  const editingRecord = getEditingRecord();
  if (editingRecord?.id === id && editingRecord?.kind === "estimate") {
    setEditingRecord(null);
  }
  persistAndRender();
}

export function renderExpenseComposerState(dom, stateRef) {
  const isEstimate = dom.expenseKindInput.value === "estimate";
  const perPersonMode = isEstimate && dom.estimatePricingModeInput.value === "per_person";

  dom.estimatePerPersonWrap.hidden = !isEstimate;

  const perPersonAmountLabel = dom.estimatePerPersonAmountInput?.closest("label");
  if (perPersonAmountLabel) perPersonAmountLabel.hidden = !perPersonMode;
  if (dom.estimateCalculation) dom.estimateCalculation.hidden = !perPersonMode;

  dom.expenseForm.querySelector('button[type="submit"]').textContent = isEstimate ? "Raming opslaan" : "Uitgave opslaan";
  dom.expenseReceiptInput.closest("label").hidden = isEstimate;
  if (isEstimate) dom.receiptReview.hidden = true;

  if (perPersonMode) {
    const participantCount = Math.max(0, stateRef.participants.length);
    const perPersonAmount = sanitizeAmount(dom.estimatePerPersonAmountInput?.value);
    dom.expenseAmountInput.placeholder = "Wordt automatisch berekend";
    dom.expenseAmountInput.readOnly = true;
    dom.expenseAmountInput.value = participantCount ? String(sanitizeAmount(perPersonAmount * participantCount)) : "";
    if (dom.estimateCalculation) {
      dom.estimateCalculation.textContent = participantCount
        ? `${currencyFormatter.format(perPersonAmount)} p.p. Ã— ${participantCount} deelnemers = ${currencyFormatter.format(perPersonAmount * participantCount)}`
        : "Voeg eerst deelnemers toe om per persoon te berekenen.";
    }
  } else {
    dom.expenseAmountInput.readOnly = false;
    dom.expenseAmountInput.placeholder = "125";
  }
}

export function updateEstimateEditMode(container) {
  if (!container) {
    return;
  }
  const pricingModeField = container.querySelector('[data-field="pricingMode"]');
  if (!pricingModeField) {
    return;
  }
  const isPerPerson = pricingModeField.value === "per_person";
  container.querySelectorAll("[data-per-person-group], [data-per-person-summary]").forEach((element) => {
    element.hidden = !isPerPerson;
  });
  if (!isPerPerson) {
    return;
  }
  const perPersonAmount = sanitizeAmount(container.querySelector('[data-field="perPersonAmount"]')?.value);
  const participantCountSnapshot = Math.max(1, Number(container.querySelector('[data-field="participantCountSnapshot"]')?.value) || state.participants.length || 1);
  const summary = container.querySelector("[data-per-person-summary]");
  if (summary) {
    summary.textContent = renderEstimateSummaryText({
      pricingMode: "per_person",
      perPersonAmount,
      participantCountSnapshot,
      amount: sanitizeAmount(perPersonAmount * participantCountSnapshot),
    });
  }
}

export function removeRecord(kind, id) {
  if (kind === "contribution" || kind === "contribution-estimate" || kind === "topup" || kind === "topup-estimate") {
    state.contributions = state.contributions.filter((item) => item.id !== id);
  } else if (kind === "estimate") {
    state.estimates = state.estimates.filter((item) => item.id !== id);
  } else {
    state.expenses = state.expenses.filter((item) => item.id !== id);
  }

  const editingRecord = getEditingRecord();
  if (editingRecord?.id === id && editingRecord?.kind === kind) {
    setEditingRecord(null);
  }
}
