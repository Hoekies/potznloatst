import { currencyFormatter, categoryLabels, categoryShortLabels, typeLabels, categoryEmoji, authStatusFallback } from './constants.js';
import { escapeHtml, formatDate, categoryColor, sanitizeAmount } from './utils.js';
import { state } from './state.js';
import { calculateSummary, getSortedParticipants, getEstimateAmount, calculateSettlements } from './calculations.js';
import { isSupabaseConfigured } from './cloud.js';
import { emailNaarLogin, isAdmin } from './auth.js';
import {
  getActiveTab, setActiveTab,
  getEditingParticipantId, setEditingParticipantId,
  getEditingRecord, setEditingRecord,
} from './ui-state.js';

export { getActiveTab, setActiveTab, getEditingParticipantId, setEditingParticipantId, getEditingRecord, setEditingRecord };

// Welke timeline-groepen (per categorie + inleg) open staan. De lijst wordt
// bij elke actie volledig opnieuw opgebouwd (innerHTML), dus zonder dit zou
// een open groep telkens weer dichtklappen - ook als je net op Wijzig had
// geklikt op een regel erin.
const openTimelineGroups = new Set();

// Accordeon: er staat maar één groep tegelijk open.
export function setTimelineGroupOpen(groupKey, isOpen) {
  if (isOpen) {
    openTimelineGroups.clear();
    openTimelineGroups.add(groupKey);
  } else {
    openTimelineGroups.delete(groupKey);
  }
}

// Lijstregels (overzicht, uitgaven, deelnemers) zijn ingeklapt: icoon, naam,
// bedrag. Eén regel tegelijk klapt uit met details en knoppen.
let expandedRowKey = null;

const timelineEntryKey = (entry) => `timeline:${entry.kind}:${entry.id}`;

export function toggleExpandedRow(key) {
  expandedRowKey = expandedRowKey === key ? null : key;
}

export function render(dom) {
  renderLoginGate(dom);
  renderTabs(dom);
  renderSummary(dom);
  renderParticipants(dom);
  renderExpenses(dom);
  renderTimeline(dom);
  renderWeekendLogo(dom);
  renderSharedViewBadge(dom);
}

export function renderSharedViewBadge(dom) {
  const badge = document.querySelector("#shared-view-badge");
  if (badge) {
    if (state.sharedView) {
      badge.textContent = `👁 Je kijkt mee met ${state.sharedView.ownerName}`;
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  const isViewer = !!state.sharedView;
  ["#participant-form", "#topup-form", "#expense-form"].forEach((sel) => {
    const el = document.querySelector(sel);
    if (el) el.hidden = isViewer;
  });
}

export function renderLoginGate(dom) {
  const loggedIn = !!state.auth?.loggedIn;

  const overlay = document.querySelector("#login-overlay");
  if (overlay) overlay.hidden = loggedIn;

  const main = document.querySelector("main.layout");
  if (main) main.hidden = !loggedIn;
}

export function renderTabs(dom) {
  dom.tabButtons.forEach((button) => {
    const isActive = button.dataset.tabTarget === getActiveTab();
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  dom.tabPanels.forEach((panel) => {
    const isActive = panel.dataset.tabPanel === getActiveTab();
    panel.classList.toggle("is-active", isActive);
    panel.hidden = !isActive;
  });
}

export function renderSummary(dom) {
  const {
    totalInitial,
    totalTopups,
    totalTopupEstimates,
    totalInlegEstimates,
    totalExpenses,
    totalEstimates,
    remaining,
    remainingPerPerson,
    remainingAfterEstimates,
    remainingAfterEstimatesPerPerson,
    participantCount,
  } = calculateSummary(state);

  const werkelijkCards = [
    {
      label: "Totaal ingelegd",
      value: totalInitial + totalTopups,
      hint: `${currencyFormatter.format(totalInitial)} start en ${currencyFormatter.format(totalTopups)} extra`,
      tone: "positive",
    },
    {
      label: "Uitgegeven",
      value: totalExpenses,
      hint: "Alle definitieve uitgaven samen",
      tone: "expense",
    },
    {
      label: "Resterend budget",
      value: remaining,
      hint: participantCount ? `${participantCount} deelnemers` : "Nog geen deelnemers",
      tone: remaining < 0 ? "negative" : "positive",
    },
    {
      label: "Per persoon over",
      value: remainingPerPerson,
      hint: "Gezamenlijke pot gedeeld door alle deelnemers",
      tone: remainingPerPerson < 0 ? "negative" : "positive",
    },
  ];

  const ramingCards = [
    {
      label: "Verwachte inleg",
      value: totalInlegEstimates,
      hint: totalInlegEstimates ? "Raming, telt nog niet mee in saldo" : "Geen raming inleg open",
      tone: totalInlegEstimates ? "positive" : "positive",
    },
    {
      label: "Openstaande ramingen",
      value: totalEstimates,
      hint: totalEstimates ? "Vooruitblik, telt nog niet mee in saldo" : "Nog geen ramingen open",
      tone: totalEstimates ? "estimate" : "positive",
    },
    {
      label: "Na ramingen over",
      value: remainingAfterEstimates,
      hint: "Definitief saldo plus verwachte inleg minus openstaande ramingen",
      tone: remainingAfterEstimates < 0 ? "negative" : "forecast",
    },
    {
      label: "Per persoon na ramingen",
      value: remainingAfterEstimatesPerPerson,
      hint: participantCount ? "Rekening houdend met open ramingen" : "Nog geen deelnemers",
      tone: remainingAfterEstimatesPerPerson < 0 ? "negative" : "forecast",
    },
  ];

  const renderCard = (card) => `
    <article class="summary-card summary-card--${card.tone}">
      <p class="summary-card__label">${card.label}</p>
      <p class="summary-card__value">${currencyFormatter.format(card.value)}</p>
    </article>
  `;

  dom.summaryCards.innerHTML = `
    <div class="summary-row summary-row--current">
      ${werkelijkCards.map(renderCard).join("")}
    </div>
    <div class="summary-row summary-row--remaining">
      ${ramingCards.map(renderCard).join("")}
    </div>
    ${renderSettlements(state)}
  `;
}

export function renderSettlements(stateRef) {
  const settlements = calculateSettlements(stateRef);

  if (!stateRef.participants.length) return "";

  if (!settlements.length) {
    return "";
  }

  const cards = settlements.map((s) => `
    <div class="settlement-card">
      <span class="settlement-card__from">${escapeHtml(s.from)}</span>
      <span class="settlement-card__arrow" aria-hidden="true">&#8594;</span>
      <span class="settlement-card__to">${escapeHtml(s.to)}</span>
      <span class="settlement-card__amount">${currencyFormatter.format(s.amount)}</span>
    </div>
  `).join("");

  return `
    <div class="settlements-section">
      <p class="settlements-title" hidden>Afrekenen</p>
      <div class="settlements-grid">${cards}</div>
    </div>
  `;
}

export function renderParticipants(dom) {
  if (!state.participants.length) {
    dom.participantsList.innerHTML = `<p class="muted">Voeg je eerste weekendgenoot toe om te starten.</p>`;
    return;
  }

  const isEstimateParticipant = (participant) => Boolean(state.contributions.find((item) => item.participantId === participant.id && item.type === "initial")?.isEstimate);
  dom.participantsList.innerHTML = getSortedParticipants(state)
    .sort((a, b) => Number(isEstimateParticipant(b)) - Number(isEstimateParticipant(a)))
    .map((participant) => {
      const initialContribution = state.contributions.find((item) => item.participantId === participant.id && item.type === "initial");
      const isEditing = getEditingParticipantId() === participant.id;
      const rowKey = `participant:${participant.id}`;
      const isExpanded = !isEditing && expandedRowKey === rowKey;
      const isEstimate = Boolean(initialContribution?.isEstimate);

      if (!isEditing) {
        return `
          <article class="person-card${isEstimate ? " person-card--estimate" : ""}${isExpanded ? " person-card--expanded" : ""}" data-participant-card="${participant.id}" data-row-toggle="${rowKey}" aria-expanded="${isExpanded}">
            ${participantLogo(participant, "person-card__avatar")}
            <div class="person-card__meta">
              <strong>${escapeHtml(participant.name)}${isEstimate ? ` ${ESTIMATE_PILL}` : ""}</strong>
              ${isExpanded ? `<span>Startinleg ${isEstimate ? "verwacht, nog niet ontvangen" : "ingelegd"}</span>` : ""}
            </div>
            <span class="person-card__amount${isEstimate ? " estimate-amount" : ""}">${isEstimate ? "&asymp; " : ""}${currencyFormatter.format(initialContribution?.amount ?? 0)}</span>
            ${isExpanded && !state.sharedView ? `
            <div class="person-card__actions">
              <button class="soft-button" type="button" data-action="edit-participant" data-id="${participant.id}">Wijzig</button>
              <button class="icon-button" type="button" data-action="remove-participant" data-id="${participant.id}">Verwijder</button>
            </div>
            ` : ""}
          </article>
        `;
      }

      return `
        <article class="person-card person-card--editing${isEstimate ? " person-card--estimate" : ""}" data-participant-card="${participant.id}">
          <div class="person-card__meta">
            <div class="edit-card">
              <div class="field-row">
                <label class="icon-field">
                  <span class="icon-field__icon" aria-hidden="true">&#128100;</span>
                  <input data-field="name" type="text" value="${escapeHtml(participant.name)}" aria-label="Naam" />
                </label>
                <div class="icon-field icon-field--amount">
                  <span class="icon-field__icon" aria-hidden="true">&euro;</span>
                  <input data-field="initial" type="text" inputmode="decimal" value="${initialContribution?.amount ?? 0}" aria-label="Startinleg" />
                  <label class="inline-raming" title="Raming">
                    <input data-field="initialIsEstimate" type="checkbox" ${isEstimate ? "checked" : ""} aria-label="Raming" />
                    <span aria-hidden="true">&#128302;</span>
                  </label>
                </div>
              </div>
              <div class="edit-card__footer">
                <button class="soft-button" type="button" data-action="save-participant" data-id="${participant.id}">Opslaan</button>
                <button class="ghost-button ghost-button--small" type="button" data-action="cancel-participant" data-id="${participant.id}">Annuleer</button>
              </div>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

export function renderExpenses(dom) {
  const records = [
    ...state.expenses.map((item) => ({ ...item, kind: "expense" })),
    ...state.estimates.map((item) => ({ ...item, amount: getEstimateAmount(item), kind: "estimate" })),
  ].sort((a, b) => (Number(b.kind === "estimate") - Number(a.kind === "estimate")) || (new Date(b.date) - new Date(a.date)));

  if (!records.length) {
    dom.expenseList.innerHTML = `<p class="muted management-empty">Nog geen uitgaven of ramingen toegevoegd.</p>`;
    return;
  }

  dom.expenseList.innerHTML = records
    .map((record) => {
      const isEditing = getEditingRecord()?.scope === "management" && getEditingRecord().id === record.id && getEditingRecord().kind === record.kind;
      const categoryIcon = categoryEmoji[record.category] || categoryEmoji.overig;
      const detailBits = [categoryLabels[record.category], formatDate(record.date)];
      if (record.kind === "estimate" && record.pricingMode === "per_person") {
        detailBits.push(renderEstimateSummaryText(record));
      }
      if (record.note) detailBits.push(escapeHtml(record.note));

      if (isEditing) {
        return `
          <article class="management-card management-card--expense management-card--editing${record.kind === "estimate" ? " management-card--estimate" : ""}" data-expense-card="${record.id}">
            <div class="management-card__meta">${renderRecordEditFields(record)}</div>
          </article>
        `;
      }

      const rowKey = `expense:${record.kind}:${record.id}`;
      const isExpanded = expandedRowKey === rowKey;
      return `
        <article class="management-card management-card--expense${record.kind === "estimate" ? " management-card--estimate" : ""}${isExpanded ? " management-card--expanded" : ""}" data-expense-card="${record.id}" data-row-toggle="${rowKey}" aria-expanded="${isExpanded}">
          <div class="management-card__logo" aria-hidden="true">${categoryIcon}</div>
          <div class="management-card__meta">
            <div class="management-card__top">
              <strong class="management-card__title">${escapeHtml(record.description)}${record.kind === "estimate" ? ` ${ESTIMATE_PILL}` : ""}</strong>
              <span class="management-card__amount-tag${record.kind === "estimate" ? " estimate-amount" : ""}">${record.kind === "estimate" ? "&asymp; " : ""}${currencyFormatter.format(record.amount)}</span>
            </div>
            ${isExpanded ? `
              <span class="management-card__detail">${detailBits.join(" · ")}</span>
              ${record.kind === "expense" ? renderReceiptBadge(record, "data-expense-action") : ""}
            ` : ""}
          </div>
          ${isExpanded && !state.sharedView ? `
          <div class="management-card__actions">
            ${record.kind === "estimate" ? `<button class="ghost-button ghost-button--small" type="button" data-expense-action="convert" data-kind="estimate" data-id="${record.id}">Maak definitief</button>` : ""}
            ${record.kind === "expense" ? `<button class="ghost-button ghost-button--small" type="button" data-expense-action="convert-to-estimate" data-kind="expense" data-id="${record.id}">Maak raming</button>` : ""}
            <button class="soft-button" type="button" data-expense-action="edit" data-kind="${record.kind}" data-id="${record.id}">Wijzig</button>
            <button class="icon-button" type="button" data-expense-action="remove" data-kind="${record.kind}" data-id="${record.id}">Verwijder</button>
          </div>
          ` : ""}
        </article>
      `;
    })
    .join("");
}

export function renderTimeline(dom) {
  const entries = [
    ...state.contributions.map((item) => ({
      id: item.id,
      kind: item.type === "initial"
        ? (item.isEstimate ? "contribution-estimate" : "contribution")
        : (item.isEstimate ? "topup-estimate" : "topup"),
      category: null,
      title: item.type === "initial"
        ? (item.isEstimate ? "Raming startinleg" : "Startinleg")
        : (item.isEstimate ? "Raming inleg" : "Extra inleg"),
      amount: item.amount,
      personId: item.type === "initial" ? item.participantId : "",
      paidBy: "",
      date: item.date,
      note: item.note,
    })),
    ...state.expenses.map((record) => ({
      id: record.id,
      kind: "expense",
      category: record.category,
      title: record.description,
      description: record.description,
      amount: record.amount,
      personId: "",
      date: record.date,
      note: record.note,
      receiptImage: record.receiptImage,
      receiptPath: record.receiptPath,
    })),
    ...state.estimates.map((record) => ({
      id: record.id,
      kind: "estimate",
      category: record.category,
      title: record.description,
      description: record.description,
      amount: getEstimateAmount(record),
      personId: "",
      pricingMode: record.pricingMode,
      perPersonAmount: record.perPersonAmount,
      participantCountSnapshot: record.participantCountSnapshot,
      date: record.date,
      note: record.note,
    })),
  ]
    .sort((a, b) => {
      // Per categorie (inleg heeft er geen), daarbinnen ramingen bovenaan,
      // dan op datum.
      const categoryOrder = Object.keys(categoryLabels);
      const aCategoryIndex = a.category ? categoryOrder.indexOf(a.category) : -1;
      const bCategoryIndex = b.category ? categoryOrder.indexOf(b.category) : -1;
      if (aCategoryIndex !== bCategoryIndex) return aCategoryIndex - bCategoryIndex;

      const aIsEstimate = a.kind === "estimate" || a.kind === "topup-estimate" || a.kind === "contribution-estimate";
      const bIsEstimate = b.kind === "estimate" || b.kind === "topup-estimate" || b.kind === "contribution-estimate";
      if (aIsEstimate !== bIsEstimate) return aIsEstimate ? -1 : 1;

      return new Date(b.date) - new Date(a.date);
    });

  if (!entries.length) {
    dom.timeline.innerHTML = `<p class="muted">Nog geen bewegingen in de pot.</p>`;
    return;
  }

  const isInlegKind = (kind) => kind === "contribution" || kind === "contribution-estimate" || kind === "topup" || kind === "topup-estimate";
  const isEstimateKind = (kind) => kind === "estimate" || kind === "topup-estimate" || kind === "contribution-estimate";
  const renderGroupTitle = (label, items) => {
    const total = items.reduce((sum, entry) => sum + entry.amount, 0);
    const estimateTotal = items.filter((entry) => isEstimateKind(entry.kind)).reduce((sum, entry) => sum + entry.amount, 0);
    const finalTotal = total - estimateTotal;
    return `
      <span class="timeline-inleg-group__title">
        <span>${label} &mdash; totaal ${currencyFormatter.format(total)}</span>
        ${estimateTotal > 0 ? `
          <span class="timeline-inleg-group__split">
            <span class="amount-pill amount-pill--estimate">Raming ${currencyFormatter.format(estimateTotal)}</span>
            <span class="amount-pill amount-pill--final">Definitief ${currencyFormatter.format(finalTotal)}</span>
          </span>
        ` : ""}
      </span>
    `;
  };

  const otherEntries = entries.filter((entry) => !isInlegKind(entry.kind));
  const inlegEntries = entries.filter((entry) => isInlegKind(entry.kind));

  // Net als inleg: per categorie ingeklapt met alleen het totaalbedrag,
  // zodat de lijst compact blijft totdat je een categorie openklikt.
  const editingRecord = getEditingRecord();
  const groupContainsEditingEntry = (items) => editingRecord?.scope === "timeline"
    && items.some((entry) => entry.id === editingRecord.id && entry.kind === editingRecord.kind);
  const isGroupOpen = (groupKey, items) => openTimelineGroups.has(groupKey) || groupContainsEditingEntry(items);

  const categoryOrder = Object.keys(categoryLabels);
  const otherHtml = categoryOrder
    .map((categoryKey) => {
      const items = otherEntries.filter((entry) => entry.category === categoryKey);
      if (!items.length) return "";
      const groupKey = `category:${categoryKey}`;
      return `
        <details class="timeline-inleg-group" data-group-key="${groupKey}" ${isGroupOpen(groupKey, items) ? "open" : ""}>
          <summary class="timeline-inleg-group__summary">
            ${renderGroupTitle(`${categoryEmoji[categoryKey] || categoryEmoji.overig} ${categoryLabels[categoryKey]}`, items)}
            <span class="timeline-inleg-group__count">${items.length} ${items.length === 1 ? "post" : "posten"}</span>
          </summary>
          <div class="timeline-inleg-group__list">${items.map((entry) => renderTimelineEntryCard(entry)).join("")}</div>
        </details>
      `;
    })
    .join("");

  let inlegHtml = "";
  if (inlegEntries.length) {
    inlegHtml = `
      <details class="timeline-inleg-group" data-group-key="inleg" ${isGroupOpen("inleg", inlegEntries) ? "open" : ""}>
        <summary class="timeline-inleg-group__summary">
          ${renderGroupTitle("&#128176; Inleg", inlegEntries)}
          <span class="timeline-inleg-group__count">${inlegEntries.length} ${inlegEntries.length === 1 ? "post" : "posten"}</span>
        </summary>
        <div class="timeline-inleg-group__list">${inlegEntries.map((entry) => renderTimelineEntryCard(entry)).join("")}</div>
      </details>
    `;
  }

  dom.timeline.innerHTML = otherHtml + inlegHtml;
}

const ESTIMATE_PILL = `<span class="amount-pill amount-pill--estimate estimate-flag">Nog niet definitief</span>`;

// Een bon met receiptPath (en geen lokale data-URL meer) staat in Supabase
// Storage; een data-URL zonder pad is alleen nog lokaal en wacht op upload.
function renderReceiptBadge(record, actionAttr) {
  if (!record.receiptImage && !record.receiptPath) return "";
  const isUploaded = Boolean(record.receiptPath) && !/^data:image\//.test(record.receiptImage || "");
  return `<button type="button" class="receipt-badge ${isUploaded ? "receipt-badge--uploaded" : "receipt-badge--local"}" ${actionAttr}="view-receipt" data-kind="expense" data-id="${record.id}" title="${isUploaded ? "Bon staat in de cloud" : "Bon staat alleen op dit apparaat"}">&#128206; ${isUploaded ? "Bon in cloud" : "Bon nog niet geüpload"}</button>`;
}

function renderTimelineEntryCard(entry) {
  const participant = state.participants.find((person) => person.id === entry.personId);
  const isEditing = getEditingRecord()?.scope === "timeline" && getEditingRecord().id === entry.id && getEditingRecord().kind === entry.kind;
  if (isEditing) {
    return renderTimelineEditCard(entry);
  }
  const isExpenseKind = entry.kind === "expense" || entry.kind === "estimate";
  const isEstimateKind = entry.kind === "estimate" || entry.kind === "topup-estimate" || entry.kind === "contribution-estimate";
  const badgeText = isExpenseKind ? categoryEmoji[entry.category] || categoryEmoji.overig : "\u{1F4B8}";
  const amountClass = isExpenseKind ? "negative" : "positive";
  const amountPrefix = isExpenseKind ? "-" : "+";
  const detailBits = [];
  if ((entry.kind === "contribution" || entry.kind === "contribution-estimate") && participant) detailBits.push(`Door ${escapeHtml(participant.name)}`);
  if (isExpenseKind) {
    detailBits.push(categoryLabels[entry.category] || "Uitgave");
    if (entry.kind === "estimate" && entry.pricingMode === "per_person") {
      detailBits.push(renderEstimateSummaryText(entry));
    }
  }
  detailBits.push(formatDate(entry.date));
  if (entry.note) detailBits.push(escapeHtml(entry.note));
  const isExpanded = expandedRowKey === timelineEntryKey(entry);

  return `
    <article class="timeline-card ${isEstimateKind ? "timeline-card--estimate" : ""}${isExpanded ? " timeline-card--expanded" : ""}" data-timeline-card="${entry.id}" data-timeline-toggle="${timelineEntryKey(entry)}" aria-expanded="${isExpanded}">
      <div class="timeline-card__badge ${isExpenseKind ? "" : "participant-logo"}" style="background:${isExpenseKind ? categoryColor(entry.category) : participant?.color || "#0A1B36"}">${isExpenseKind ? badgeText : "<span></span>"}</div>
      <div class="timeline-card__main">
        <strong>${escapeHtml(entry.title)}${isEstimateKind ? ` ${ESTIMATE_PILL}` : ""}</strong>
        ${isExpanded ? `<div class="timeline-card__details">${detailBits.map((bit) => `<span>${bit}</span>`).join("")}${entry.kind === "expense" ? renderReceiptBadge(entry, "data-timeline-action") : ""}</div>` : ""}
      </div>
      <span class="timeline-card__amount ${isEstimateKind ? "is-estimate" : amountClass}">${isEstimateKind ? "&asymp; " : ""}${amountPrefix}${currencyFormatter.format(entry.amount)}</span>
      ${isExpanded && !state.sharedView ? `
      <div class="timeline-card__actions">
          ${entry.kind === "estimate" ? `<button class="ghost-button ghost-button--small" type="button" data-timeline-action="convert" data-kind="estimate" data-id="${entry.id}">Definitief</button>` : ""}
          ${entry.kind === "expense" ? `<button class="ghost-button ghost-button--small" type="button" data-timeline-action="convert-to-estimate" data-kind="expense" data-id="${entry.id}">Maak raming</button>` : ""}
          ${entry.kind === "contribution-estimate" || entry.kind === "topup-estimate" ? `<button class="ghost-button ghost-button--small" type="button" data-timeline-action="convert-inleg" data-kind="${entry.kind}" data-id="${entry.id}">Definitief</button>` : ""}
          <button class="soft-button" type="button" data-timeline-action="edit" data-kind="${entry.kind}" data-id="${entry.id}">Wijzig</button>
          <button class="icon-button" type="button" data-timeline-action="remove" data-kind="${entry.kind}" data-id="${entry.id}">Verwijder</button>
      </div>
      ` : ""}
    </article>
  `;
}

export function renderRecordEditFields(record, { actionAttr = "data-expense-action" } = {}) {
  const pricingMode = record.pricingMode === "per_person" ? "per_person" : "total";
  const participantCountSnapshot = pricingMode === "per_person" ? Math.max(1, Number(record.participantCountSnapshot) || state.participants.length || 1) : 0;
  const perPersonAmount = pricingMode === "per_person"
    ? sanitizeAmount(record.perPersonAmount || (participantCountSnapshot ? record.amount / participantCountSnapshot : 0))
    : 0;
  return `
    <div class="edit-card">
      <div class="field-row">
        <label class="icon-field">
          <span class="icon-field__icon" aria-hidden="true">&#9999;&#65039;</span>
          <input data-field="description" type="text" value="${escapeHtml(record.description)}" aria-label="Omschrijving" />
        </label>
        <div class="icon-field icon-field--amount">
          <span class="icon-field__icon" aria-hidden="true">&euro;</span>
          <input data-field="amount" type="text" inputmode="decimal" value="${record.amount}" aria-label="Bedrag" />
          ${
            record.kind === "estimate"
              ? `
                <input type="hidden" data-field="pricingMode" value="${pricingMode}" />
                <label class="inline-raming" title="Bedrag is per persoon, niet totaal">
                  <input type="checkbox" data-edit-per-person ${pricingMode === "per_person" ? "checked" : ""} aria-label="Bedrag is per persoon, niet totaal" />
                  <span aria-hidden="true">&#128101;</span>
                </label>
              `
              : ""
          }
        </div>
      </div>
      ${
        record.kind === "estimate"
          ? `
            <div class="field-row" data-per-person-group ${pricingMode === "per_person" ? "" : 'hidden'}>
              <label class="icon-field">
                <span class="icon-field__icon" aria-hidden="true">&#128100;</span>
                <input data-field="perPersonAmount" type="text" inputmode="decimal" value="${perPersonAmount || ""}" aria-label="Bedrag per persoon" />
              </label>
              <label class="icon-field">
                <span class="icon-field__icon" aria-hidden="true">&#128101;</span>
                <input data-field="participantCountSnapshot" type="number" min="1" step="1" value="${participantCountSnapshot || ""}" aria-label="Aantal deelnemers" />
              </label>
            </div>
            <span class="field-help" data-per-person-summary ${pricingMode === "per_person" ? "" : 'hidden'}>${renderEstimateSummaryText({ pricingMode, perPersonAmount, participantCountSnapshot, amount: record.amount })}</span>
          `
          : ""
      }
      <div class="category-chips" role="group" aria-label="Categorie">
        ${Object.entries(categoryLabels)
          .map(([value, label]) => `<button type="button" class="category-chip${record.category === value ? " is-active" : ""}" data-edit-category="${value}" title="${label}" aria-label="${label}"><span class="category-chip__icon" aria-hidden="true">${categoryEmoji[value] || categoryEmoji.overig}</span><span class="category-chip__label">${categoryShortLabels[value] || label}</span></button>`)
          .join("")}
      </div>
      <input type="hidden" data-field="category" value="${record.category}" />
      <div class="field-row field-row--date-receipt">
        <label class="icon-field">
          <span class="icon-field__icon" aria-hidden="true">&#128197;</span>
          <input data-field="date" type="date" value="${record.date}" aria-label="Datum" />
        </label>
        ${record.kind === "expense" ? `
        <div class="receipt-actions">
          <button type="button" class="ghost-button ghost-button--small" data-receipt-trigger="camera" title="Foto maken" aria-label="Foto maken"><span class="receipt-action-icon" aria-hidden="true">&#128247;</span><span class="receipt-action-label">${record.receiptImage ? "Nieuwe foto" : "Foto maken"}</span></button>
          <button type="button" class="ghost-button ghost-button--small" data-receipt-trigger="upload" title="Uploaden" aria-label="Uploaden"><span class="receipt-action-icon" aria-hidden="true">&#128193;</span><span class="receipt-action-label">Uploaden</span></button>
          <input data-field="receipt-file" data-receipt-input="camera" type="file" accept="image/*" capture="environment" hidden />
          <input data-field="receipt-file" data-receipt-input="upload" type="file" accept="image/*" hidden />
        </div>
        ` : ""}
      </div>
      ${record.kind === "expense" ? `
      <div class="inline-edit-receipt">
        ${record.receiptImage ? `<img class="inline-edit-receipt__thumb" src="${escapeHtml(record.receiptImage)}" alt="Huidige bon" />` : ""}
        <input data-field="receipt-data" type="hidden" value="" />
      </div>
      ` : ""}
      <label class="icon-field">
        <span class="icon-field__icon" aria-hidden="true">&#128221;</span>
        <textarea data-field="note" rows="2" aria-label="Notitie" placeholder="Notitie (optioneel)">${escapeHtml(record.note || "")}</textarea>
      </label>
      <div class="edit-card__footer">
        <button class="soft-button" type="button" ${actionAttr}="save" data-kind="${record.kind}" data-id="${record.id}">Opslaan</button>
        <button class="ghost-button ghost-button--small" type="button" ${actionAttr}="cancel" data-kind="${record.kind}" data-id="${record.id}">Annuleer</button>
      </div>
    </div>
  `;
}

export function renderTimelineEditCard(entry) {
  const typeLabel = typeLabels[entry.kind];

  if (entry.kind === "contribution" || entry.kind === "contribution-estimate" || entry.kind === "topup" || entry.kind === "topup-estimate") {
    const isEstimateEntry = entry.kind === "topup-estimate" || entry.kind === "contribution-estimate";
    return `
      <article class="timeline-card timeline-card--editing${isEstimateEntry ? " timeline-card--estimate" : ""}" data-timeline-card="${entry.id}">
        <div class="timeline-card__main">
          <div class="edit-card">
            <div class="field-row">
              <label class="icon-field">
                <span class="icon-field__icon" aria-hidden="true">&#9999;&#65039;</span>
                <input data-field="note" type="text" value="${escapeHtml(entry.note || "")}" aria-label="Omschrijving" placeholder="Omschrijving (optioneel)" />
              </label>
              <div class="icon-field icon-field--amount">
                <span class="icon-field__icon" aria-hidden="true">&euro;</span>
                <input data-field="amount" type="text" inputmode="decimal" value="${entry.amount}" aria-label="Bedrag" />
                <label class="inline-raming" title="Raming">
                  <input data-field="isEstimate" type="checkbox" ${isEstimateEntry ? "checked" : ""} aria-label="Raming" />
                  <span aria-hidden="true">&#128302;</span>
                </label>
              </div>
            </div>
            <label class="icon-field">
              <span class="icon-field__icon" aria-hidden="true">&#128197;</span>
              <input data-field="date" type="date" value="${entry.date}" aria-label="Datum" />
            </label>
            <div class="edit-card__footer">
              <span class="edit-card__footer-label">${typeLabel}</span>
              <button class="soft-button" type="button" data-timeline-action="save" data-kind="${entry.kind}" data-id="${entry.id}">Opslaan</button>
              <button class="ghost-button ghost-button--small" type="button" data-timeline-action="cancel" data-kind="${entry.kind}" data-id="${entry.id}">Annuleer</button>
            </div>
          </div>
        </div>
      </article>
    `;
  }

  return `
    <article class="timeline-card timeline-card--editing ${entry.kind === "estimate" ? "timeline-card--estimate" : ""}" data-timeline-card="${entry.id}">
      <div class="timeline-card__main">
        ${renderRecordEditFields(entry, { actionAttr: "data-timeline-action" })}
      </div>
    </article>
  `;
}

export function renderWeekendLogo(dom) {
  if (!dom.weekendName) {
    return;
  }
  dom.weekendName.innerHTML = `<img class="brand-logo brand-logo--weekend" src="../assets/branding/opznloatst.png" alt="${escapeHtml(state.weekend.name)}" />`;
}

export function avatarMarkup(source, fallback) {
  if (source) {
    return `<img src="${escapeHtml(source)}" alt="">`;
  }
  return escapeHtml(fallback);
}

export function participantLogo(participant, className) {
  const color = participant?.color || "#0A1B36";
  const label = participant?.name ? `Logo van ${participant.name}` : "Deelnemerlogo";
  return `
    <div class="${className} participant-logo" style="background:${color}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">
      <span></span>
    </div>
  `;
}

export function renderEstimateSummaryText(record) {
  const participantCount = Math.max(1, Number(record.participantCountSnapshot) || 1);
  const ppa = sanitizeAmount(record.perPersonAmount || 0);
  return `${currencyFormatter.format(ppa)} p.p. x ${participantCount} deelnemers = ${currencyFormatter.format(getEstimateAmount(record))}`;
}

export function renderAccountUi(dom, getProfileName, getProfileAvatarSource) {
  if (!dom.accountName || !dom.accountStatus || !dom.accountAvatar) {
    return;
  }

  const profileName = getProfileName();
  const avatarSource = getProfileAvatarSource();
  const fallback = profileName.charAt(0).toUpperCase() || "P";
  const cloudReady = isSupabaseConfigured();
  const lastSyncText = state.auth?.lastSyncedAt
    ? ` · laatste sync ${dom.dateFormatter ? dom.dateFormatter.format(new Date(state.auth.lastSyncedAt)) : new Date(state.auth.lastSyncedAt).toLocaleDateString("nl-NL")}`
    : "";
  const gebruikersnaam = state.auth?.email ? emailNaarLogin(state.auth.email) : "";
  const statusText = state.auth?.loggedIn
    ? `Ingelogd${gebruikersnaam ? ` als ${gebruikersnaam}` : ""}${lastSyncText}`
    : cloudReady
      ? "Lokale modus, cloud staat klaar"
      : "Lokale modus, Supabase nog niet ingesteld";

  dom.accountName.textContent = profileName;
  dom.accountStatus.textContent = statusText;
  dom.accountAvatar.innerHTML = avatarMarkup(avatarSource, fallback);

  if (dom.accountLoginButton) {
    dom.accountLoginButton.textContent = state.auth?.loggedIn ? "Uitloggen" : "Inloggen";
  }

  const adminBtn = document.querySelector("#open-admin-gebruikers");
  if (adminBtn) {
    const adminUser = state.auth?.loggedIn && state.auth?.email
      ? { email: state.auth.email }
      : null;
    adminBtn.hidden = !isAdmin(adminUser);
  }

  if (dom.syncCloudButton) {
    const syncNode = dom.syncCloudButton.querySelector("span");
    if (syncNode) {
      syncNode.textContent = state.auth?.loggedIn
        ? "Nu synchroniseren"
        : cloudReady
          ? "Cloud instellen"
          : "Supabase koppelen";
    }
  }

  if (dom.profilePreviewAvatar) {
    dom.profilePreviewAvatar.innerHTML = avatarMarkup(avatarSource, fallback);
  }
  if (dom.profilePreviewName) {
    dom.profilePreviewName.textContent = profileName;
  }

  const authStatus = document.querySelector("#auth-status");
  if (authStatus && authStatus.textContent.trim() === authStatusFallback) {
    authStatus.textContent = cloudReady
      ? "Log in om je deelnemers, inleg, uitgaven en bonnetjes online te bewaren."
      : authStatusFallback;
  }
}
