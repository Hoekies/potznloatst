import { currencyFormatter, categoryLabels, typeLabels, categoryEmoji, authStatusFallback } from './constants.js';
import { escapeHtml, formatDate, categoryColor, sanitizeAmount } from './utils.js';
import { state } from './state.js';
import { calculateSummary, getSortedParticipants, getEstimateAmount, calculateSettlements } from './calculations.js';
import { isSupabaseConfigured } from './cloud.js';
import { emailNaarLogin, isAdmin } from './auth.js';
import {
  getActiveTab, setActiveTab,
  getEditingParticipantId, setEditingParticipantId,
  getEditingTopupId, setEditingTopupId,
  getEditingRecord, setEditingRecord,
} from './ui-state.js';

export { getActiveTab, setActiveTab, getEditingParticipantId, setEditingParticipantId, getEditingTopupId, setEditingTopupId, getEditingRecord, setEditingRecord };

export function render(dom) {
  renderLoginGate(dom);
  renderTabs(dom);
  renderSummary(dom);
  renderParticipants(dom);
  renderTopups(dom);
  renderExpenses(dom);
  renderTimeline(dom);
  renderWeekendLogo(dom);
  renderSharedViewBadge(dom);
  if (dom.positionMenuPanel) dom.positionMenuPanel();
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

  const currentCards = [
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
  ];

  const remainingCards = [
    {
      label: "Resterend budget",
      value: remaining,
      hint: participantCount ? `${participantCount} deelnemers` : "Nog geen deelnemers",
      tone: remaining < 0 ? "negative" : "positive",
    },
    {
      label: "Na ramingen over",
      value: remainingAfterEstimates,
      hint: totalEstimates ? "Definitief saldo minus alle open ramingen" : "Gelijk aan resterend budget",
      tone: remainingAfterEstimates < 0 ? "negative" : "forecast",
    },
    {
      label: "Per persoon over",
      value: remainingPerPerson,
      hint: "Gezamenlijke pot gedeeld door alle deelnemers",
      tone: remainingPerPerson < 0 ? "negative" : "positive",
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
      ${currentCards.map(renderCard).join("")}
    </div>
    <div class="summary-row summary-row--remaining">
      ${remainingCards.map(renderCard).join("")}
    </div>
    ${renderSettlements(state)}
  `;
}

export function renderSettlements(stateRef) {
  const settlements = calculateSettlements(stateRef);

  if (!stateRef.participants.length) return "";

  if (!settlements.length) {
    return `
      <div class="settlements-section">
        <p class="settlements-title" hidden>Afrekenen</p>
        <p class="settlements-empty">Alles is verrekend — niemand hoeft iets te betalen.</p>
      </div>
    `;
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

  dom.participantsList.innerHTML = getSortedParticipants(state)
    .map((participant) => {
      const contributions = state.contributions.filter((item) => item.participantId === participant.id);
      const initialContribution = contributions.find((item) => item.type === "initial");
      const total = contributions.reduce((sum, item) => sum + item.amount, 0);
      const isEditing = getEditingParticipantId() === participant.id;

      return `
        <article class="person-card ${isEditing ? "person-card--editing" : ""}${initialContribution?.isEstimate ? " person-card--estimate" : ""}" data-participant-card="${participant.id}">
          ${participantLogo(participant, "person-card__avatar")}
          <div class="person-card__meta">
            ${
              isEditing
                ? `
                  <div class="inline-edit-grid">
                    <label>
                      Naam
                      <input data-field="name" type="text" value="${escapeHtml(participant.name)}" />
                    </label>
                    <label>
                      Startinleg
                      <input data-field="initial" type="number" min="0" step="0.01" inputmode="decimal" value="${initialContribution?.amount ?? 0}" />
                    </label>
                  </div>
                  <label>
                    Kleur
                    <input data-field="color" type="color" value="${participant.color}" />
                  </label>
                  <label class="checkbox-label">
                    <input data-field="initialIsEstimate" type="checkbox" ${initialContribution?.isEstimate ? "checked" : ""} />
                    Startinleg is raming (nog niet ontvangen)
                  </label>
                  `
                  : `
                  <strong>${escapeHtml(participant.name)}${initialContribution?.isEstimate ? " <small>(raming)</small>" : ""}</strong>
                  <span>${currencyFormatter.format(initialContribution?.amount ?? 0)} ${initialContribution?.isEstimate ? "verwacht" : "ingelegd"}</span>
                `
            }
          </div>
          <div class="person-card__actions">
            ${state.sharedView ? "" : isEditing
                ? `
                  <button class="soft-button" type="button" data-action="save-participant" data-id="${participant.id}">Opslaan</button>
                  <button class="ghost-button ghost-button--small" type="button" data-action="cancel-participant" data-id="${participant.id}">Annuleer</button>
                `
                : `
                  <button class="soft-button" type="button" data-action="edit-participant" data-id="${participant.id}">Wijzig</button>
                  <button class="icon-button" type="button" data-action="remove-participant" data-id="${participant.id}">Verwijder</button>
                `
            }
          </div>
        </article>
      `;
    })
    .join("");
}

export function renderTopups(dom) {
  const topups = state.contributions
    .filter((item) => item.type === "topup")
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (!topups.length) {
    dom.topupList.innerHTML = `<p class="muted management-empty">Nog geen extra inleg toegevoegd.</p>`;
    return;
  }

  dom.topupList.innerHTML = topups
    .map((topup) => {
      const isEditing = getEditingTopupId() === topup.id;

      return `
          <article class="management-card${topup.isEstimate ? " management-card--estimate" : ""}" data-topup-card="${topup.id}">
            <div class="management-card__logo money-logo" aria-hidden="true">&euro;</div>
            <div class="management-card__meta">
              ${
                isEditing
                  ? `
                    <div class="inline-edit-grid">
                      <label>
                        Bedrag
                        <input data-field="amount" type="number" min="0" step="0.01" value="${topup.amount}" />
                      </label>
                  </div>
                  <label>
                    Notitie
                    <input data-field="note" type="text" value="${escapeHtml(topup.note || "")}" />
                  </label>
                  <label class="checkbox-label">
                    <input data-field="isEstimate" type="checkbox" ${topup.isEstimate ? "checked" : ""} />
                    Raming (nog niet ontvangen)
                  </label>
                  `
                  : `
                  <strong>${topup.isEstimate ? "Raming inleg" : "Extra inleg"} ${currencyFormatter.format(topup.amount)}</strong>
                  <span>${formatDate(topup.date)}${topup.note ? ` - ${escapeHtml(topup.note)}` : ""}${topup.isEstimate ? " · Raming" : ""}</span>
                `
              }
          </div>
          <div class="management-card__actions">
            ${state.sharedView ? "" : isEditing
                ? `
                  <button class="soft-button" type="button" data-topup-action="save" data-id="${topup.id}">Opslaan</button>
                  <button class="ghost-button ghost-button--small" type="button" data-topup-action="cancel" data-id="${topup.id}">Annuleer</button>
                `
                : `
                  <button class="soft-button" type="button" data-topup-action="edit" data-id="${topup.id}">Wijzig</button>
                  <button class="icon-button" type="button" data-topup-action="remove" data-id="${topup.id}">Verwijder</button>
                `
            }
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
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  if (!records.length) {
    dom.expenseList.innerHTML = `<p class="muted management-empty">Nog geen uitgaven of ramingen toegevoegd.</p>`;
    return;
  }

  dom.expenseList.innerHTML = records
    .map((record) => {
      const isEditing = getEditingRecord()?.scope === "management" && getEditingRecord().id === record.id && getEditingRecord().kind === record.kind;
      const categoryIcon = categoryEmoji[record.category] || categoryEmoji.overig;
      const itemLabel = record.kind === "estimate" ? "Raming" : "Uitgave";
      const detailBits = [categoryLabels[record.category], formatDate(record.date)];
      if (record.kind === "estimate" && record.pricingMode === "per_person") {
        detailBits.push(renderEstimateSummaryText(record));
      }
      if (record.note) detailBits.push(escapeHtml(record.note));

      return `
        <article class="management-card management-card--expense ${record.kind === "estimate" ? "management-card--estimate" : ""}" data-expense-card="${record.id}">
          <div class="management-card__logo" aria-hidden="true">${categoryIcon}</div>
          <div class="management-card__meta">
            ${
              isEditing
                ? renderRecordEditFields(record)
                : `
                  <div class="management-card__top">
                    <strong class="management-card__title">${escapeHtml(record.description)}</strong>
                    <span class="management-card__amount-tag">${currencyFormatter.format(record.amount)}</span>
                  </div>
                  <span class="management-card__detail">${detailBits.join(" · ")}</span>
                `
            }
          </div>
          <div class="management-card__actions">
            ${state.sharedView
              ? `${record.kind === "expense" && record.receiptImage ? `<button class="ghost-button ghost-button--small" type="button" data-expense-action="view-receipt" data-kind="expense" data-id="${record.id}">Bon</button>` : ""}`
              : isEditing
                ? `
                  <button class="soft-button" type="button" data-expense-action="save" data-kind="${record.kind}" data-id="${record.id}">Opslaan</button>
                  <button class="ghost-button ghost-button--small" type="button" data-expense-action="cancel" data-kind="${record.kind}" data-id="${record.id}">Annuleer</button>
                `
                : `
                  ${record.kind === "estimate" ? `<button class="ghost-button ghost-button--small" type="button" data-expense-action="convert" data-kind="estimate" data-id="${record.id}">Maak definitief</button>` : ""}
                  ${record.kind === "expense" && record.receiptImage ? `<button class="ghost-button ghost-button--small" type="button" data-expense-action="view-receipt" data-kind="expense" data-id="${record.id}">Bon</button>` : ""}
                  <button class="soft-button" type="button" data-expense-action="edit" data-kind="${record.kind}" data-id="${record.id}">Wijzig</button>
                  <button class="icon-button" type="button" data-expense-action="remove" data-kind="${record.kind}" data-id="${record.id}">Verwijder</button>
                `
            }
          </div>
        </article>
      `;
    })
    .join("");
}

export function renderTimeline(dom) {
  const categoryFilter = dom.filterCategory.value;
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
      amount: record.amount,
      personId: "",
      date: record.date,
      note: record.note,
    })),
    ...state.estimates.map((record) => ({
      id: record.id,
      kind: "estimate",
      category: record.category,
      title: record.description,
      amount: getEstimateAmount(record),
      personId: "",
      pricingMode: record.pricingMode,
      perPersonAmount: record.perPersonAmount,
      participantCountSnapshot: record.participantCountSnapshot,
      date: record.date,
      note: record.note,
    })),
  ]
    .filter((entry) => categoryFilter === "all" || entry.category === categoryFilter)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  if (!entries.length) {
    dom.timeline.innerHTML = `<p class="muted">Nog geen bewegingen die bij deze filter passen.</p>`;
    return;
  }

  dom.timeline.innerHTML = entries
    .map((entry) => {
      const participant = state.participants.find((person) => person.id === entry.personId);
      const isEditing = getEditingRecord()?.scope === "timeline" && getEditingRecord().id === entry.id && getEditingRecord().kind === entry.kind;
      if (isEditing) {
        return renderTimelineEditCard(entry, participant);
      }
      const typeLabel = typeLabels[entry.kind];
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

      return `
        <article class="timeline-card ${isEstimateKind ? "timeline-card--estimate" : ""}" data-timeline-card="${entry.id}">
          <div class="timeline-card__badge ${isExpenseKind ? "" : "participant-logo"}" style="background:${isExpenseKind ? categoryColor(entry.category) : participant?.color || "#0A1B36"}">${isExpenseKind ? badgeText : "<span></span>"}</div>
          <div class="timeline-card__main">
            <strong>${escapeHtml(entry.title)}</strong>
            <div class="timeline-card__details">${detailBits.map((bit) => `<span>${bit}</span>`).join("")}</div>
          </div>
          <span class="timeline-card__amount ${amountClass}">${amountPrefix}${currencyFormatter.format(entry.amount)}</span>
          <div class="timeline-card__actions">
            ${state.sharedView ? "" : `
              ${entry.kind === "estimate" ? `<button class="ghost-button ghost-button--small" type="button" data-timeline-action="convert" data-kind="estimate" data-id="${entry.id}">Definitief</button>` : ""}
              <button class="soft-button" type="button" data-timeline-action="edit" data-kind="${entry.kind}" data-id="${entry.id}">Wijzig</button>
              <button class="icon-button" type="button" data-timeline-action="remove" data-kind="${entry.kind}" data-id="${entry.id}">Verwijder</button>
            `}
          </div>
        </article>
      `;
    })
    .join("");
}

export function renderRecordEditFields(record) {
  const pricingMode = record.pricingMode === "per_person" ? "per_person" : "total";
  const participantCountSnapshot = pricingMode === "per_person" ? Math.max(1, Number(record.participantCountSnapshot) || state.participants.length || 1) : 0;
  const perPersonAmount = pricingMode === "per_person"
    ? sanitizeAmount(record.perPersonAmount || (participantCountSnapshot ? record.amount / participantCountSnapshot : 0))
    : 0;
  return `
    <div class="inline-edit-grid">
      <label>
        Omschrijving
        <input data-field="description" type="text" value="${escapeHtml(record.description)}" />
      </label>
      <label>
        Bedrag
        <input data-field="amount" type="number" min="0" step="0.01" inputmode="decimal" value="${record.amount}" />
      </label>
    </div>
    <div class="inline-edit-grid">
      <label>
        Categorie
        <select data-field="category">
          ${Object.entries(categoryLabels)
            .map(([value, label]) => `<option value="${value}" ${record.category === value ? "selected" : ""}>${label}</option>`)
            .join("")}
        </select>
      </label>
      ${
        record.kind === "estimate"
          ? `
            <label>
              Ramingmodus
              <select data-field="pricingMode">
                <option value="total" ${pricingMode === "total" ? "selected" : ""}>Totaalbedrag</option>
                <option value="per_person" ${pricingMode === "per_person" ? "selected" : ""}>Bedrag per persoon</option>
              </select>
            </label>
          `
          : ""
      }
    </div>
    ${
      record.kind === "estimate"
        ? `
          <div class="inline-edit-grid">
            <label data-per-person-group ${pricingMode === "per_person" ? "" : 'hidden'}>
              Bedrag per persoon
              <input data-field="perPersonAmount" type="number" min="0" step="0.01" inputmode="decimal" value="${perPersonAmount || ""}" />
            </label>
            <label data-per-person-group ${pricingMode === "per_person" ? "" : 'hidden'}>
              Aantal deelnemers
              <input data-field="participantCountSnapshot" type="number" min="1" step="1" value="${participantCountSnapshot || ""}" />
            </label>
          </div>
          <p class="field-help" data-per-person-summary ${pricingMode === "per_person" ? "" : 'hidden'}>${renderEstimateSummaryText({ pricingMode, perPersonAmount, participantCountSnapshot, amount: record.amount })}</p>
        `
        : ""
    }
    <div class="inline-edit-grid">
      <label>
        Datum
        <input data-field="date" type="date" value="${record.date}" />
      </label>
      <label>
        Notitie
        <input data-field="note" type="text" value="${escapeHtml(record.note || "")}" />
      </label>
    </div>
    ${record.kind === "expense" ? `
    <div class="inline-edit-receipt">
      ${record.receiptImage ? `<img class="inline-edit-receipt__thumb" src="${escapeHtml(record.receiptImage)}" alt="Huidige bon" />` : ""}
      <label class="inline-edit-receipt__label">
        ${record.receiptImage ? "Bon vervangen" : "Bon toevoegen"}
        <input data-field="receipt-file" type="file" accept="image/*" capture="environment" />
      </label>
      <input data-field="receipt-data" type="hidden" value="" />
    </div>
    ` : ""}
  `;
}

export function renderTimelineEditCard(entry, participant) {
  const typeLabel = typeLabels[entry.kind];
  const amountPrefix = entry.kind === "expense" || entry.kind === "estimate" ? "-" : "+";
  const amountClass = entry.kind === "expense" || entry.kind === "estimate" ? "negative" : "positive";

  if (entry.kind === "contribution" || entry.kind === "contribution-estimate" || entry.kind === "topup" || entry.kind === "topup-estimate") {
    const isTopupKind = entry.kind === "topup" || entry.kind === "topup-estimate";
    const isEstimateEntry = entry.kind === "topup-estimate" || entry.kind === "contribution-estimate";
    return `
      <article class="timeline-card timeline-card--editing${isEstimateEntry ? " timeline-card--estimate" : ""}" data-timeline-card="${entry.id}">
        <div class="timeline-card__badge ${isTopupKind ? "" : "participant-logo"}" style="background:${isTopupKind ? "#2563EB" : participant?.color || "#0A1B36"}">${isTopupKind ? "&euro;" : "<span></span>"}</div>
        <div class="timeline-card__main">
          <div class="inline-edit-grid">
            <label>
              Bedrag
              <input data-field="amount" type="number" min="0" step="0.01" inputmode="decimal" value="${entry.amount}" />
            </label>
            <label>
              Datum
              <input data-field="date" type="date" value="${entry.date}" />
            </label>
          </div>
          <label>
            Notitie
            <input data-field="note" type="text" value="${escapeHtml(entry.note || "")}" />
          </label>
        </div>
        <span class="timeline-card__tag">${typeLabel}</span>
        <div class="timeline-card__actions">
          <button class="soft-button" type="button" data-timeline-action="save" data-kind="${entry.kind}" data-id="${entry.id}">Opslaan</button>
          <button class="ghost-button ghost-button--small" type="button" data-timeline-action="cancel" data-kind="${entry.kind}" data-id="${entry.id}">Annuleer</button>
          <span class="timeline-card__amount ${amountClass}">${amountPrefix}${currencyFormatter.format(entry.amount)}</span>
        </div>
      </article>
    `;
  }

  return `
    <article class="timeline-card timeline-card--editing ${entry.kind === "estimate" ? "timeline-card--estimate" : ""}" data-timeline-card="${entry.id}">
      <div class="timeline-card__badge" style="background:${categoryColor(entry.category)}">${categoryEmoji[entry.category] || categoryEmoji.overig}</div>
      <div class="timeline-card__main">
        ${renderRecordEditFields(entry)}
      </div>
      <span class="timeline-card__tag">${typeLabel}</span>
      <div class="timeline-card__actions">
        <button class="soft-button" type="button" data-timeline-action="save" data-kind="${entry.kind}" data-id="${entry.id}">Opslaan</button>
        <button class="ghost-button ghost-button--small" type="button" data-timeline-action="cancel" data-kind="${entry.kind}" data-id="${entry.id}">Annuleer</button>
        <span class="timeline-card__amount ${amountClass}">${amountPrefix}${currencyFormatter.format(entry.amount)}</span>
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
  if (dom.profilePreviewState) {
    dom.profilePreviewState.textContent = state.auth?.loggedIn
      ? "Ingelogd profiel, wijzigingen worden ook met je account gesynchroniseerd"
      : cloudReady
        ? "Nog niet ingelogd, maar online sync staat klaar"
        : "Nog niet ingelogd, lokale modus blijft beschikbaar";
  }

  const authStatus = document.querySelector("#auth-status");
  if (authStatus && authStatus.textContent.trim() === authStatusFallback) {
    authStatus.textContent = cloudReady
      ? "Log in om je deelnemers, inleg, uitgaven en bonnetjes online te bewaren."
      : authStatusFallback;
  }
}
