import { dateFormatter } from './constants.js';

export const summaryCards = document.querySelector("#summary-cards");
export const tabButtons = Array.from(document.querySelectorAll("[data-tab-target]"));
export const tabPanels = Array.from(document.querySelectorAll("[data-tab-panel]"));
export const participantForm = document.querySelector("#participant-form");
export const topupForm = document.querySelector("#topup-form");
export const expenseForm = document.querySelector("#expense-form");
export const participantsList = document.querySelector("#participants-list");
export const topupList = document.querySelector("#topup-list");
export const expenseList = document.querySelector("#expense-list");
export const timeline = document.querySelector("#timeline");
export const filterCategory = document.querySelector("#filter-category");
export const resetDemoButton = document.querySelector("#reset-demo");
export const exportStateButton = document.querySelector("#export-state");
export const importStateButton = document.querySelector("#import-state");
export const importStateFileInput = document.querySelector("#import-state-file");

export const participantNameInput = document.querySelector("#participant-name");
export const participantInitialInput = document.querySelector("#participant-initial");
export const participantColorInput = document.querySelector("#participant-color");
export const participantInitialIsEstimateInput = document.querySelector("#participant-initial-is-estimate");
export const topupAmountInput = document.querySelector("#topup-amount");
export const topupNoteInput = document.querySelector("#topup-note");
export const topupIsEstimateInput = document.querySelector("#topup-is-estimate");
export const expenseKindInput = document.querySelector("#expense-kind");
export const expenseDescriptionInput = document.querySelector("#expense-description");
export const expenseAmountInput = document.querySelector("#expense-amount");
export const expenseCategoryInput = document.querySelector("#expense-category");
export const expenseDateInput = document.querySelector("#expense-date");
export const expenseReceiptInput = document.querySelector("#expense-receipt");
export const expenseNoteInput = document.querySelector("#expense-note");
export const estimatePricingModeInput = document.querySelector("#estimate-pricing-mode");
export const estimatePerPersonWrap = document.querySelector("#estimate-per-person-wrap");
export const estimatePerPersonAmountInput = document.querySelector("#estimate-per-person-amount");
export const estimateAmountWrap = document.querySelector("#expense-amount-wrap");
export const estimateAmountLabel = document.querySelector("#expense-amount-label");
export const estimateCalculation = document.querySelector("#estimate-calculation");
export const receiptReview = document.querySelector("#receipt-review");
export const receiptPreview = document.querySelector("#receipt-preview");
export const receiptPreviewImage = document.querySelector("#receipt-preview-image");
export const ocrStatus = document.querySelector("#ocr-status");
export const ocrMessage = document.querySelector("#ocr-message");
export const receiptModal = document.querySelector("#receipt-modal");
export const receiptModalImage = document.querySelector("#receipt-modal-image");
export const closeReceiptModalButton = document.querySelector("#close-receipt-modal");
export const weekendName = document.querySelector("#weekend-name");
export const accountName = document.querySelector("#account-name");
export const accountStatus = document.querySelector("#account-status");
export const accountAvatar = document.querySelector("#account-avatar");
export const menuPanel = document.querySelector(".menu-panel");
export const menuPanelTrigger = document.querySelector(".menu-panel__trigger");
export const menuPanelContent = document.querySelector(".menu-panel__content");
export const accountToggleButton = document.querySelector("#account-toggle");
export const accountDropdown = document.querySelector("#account-dropdown");
export const accountLoginButton = document.querySelector("#account-login");
export const accountToggleHint = document.querySelector("#account-toggle-hint");
export const openProfileButton = document.querySelector("#open-profile");
export const syncCloudButton = document.querySelector("#sync-cloud");
export const profileModal = document.querySelector("#profile-modal");
export const closeProfileButton = document.querySelector("#close-profile");
export const profileForm = document.querySelector("#profile-form");
export const profileNameInput = document.querySelector("#profile-name");
export const profileAvatarUrlInput = document.querySelector("#profile-avatar-url");
export const profileAvatarFileInput = document.querySelector("#profile-avatar-file");
export const profileResetAvatarButton = document.querySelector("#profile-reset-avatar");
export const profilePreviewAvatar = document.querySelector("#profile-preview-avatar");
export const profilePreviewName = document.querySelector("#profile-preview-name");
export const profilePreviewState = document.querySelector("#profile-preview-state");
export const cropStage = document.querySelector("#avatar-crop-stage");
export const cropZoom = document.querySelector("#avatar-crop-zoom");

export const menuBackdrop = document.createElement("div");
menuBackdrop.className = "menu-panel-backdrop";
menuBackdrop.hidden = true;
document.body.appendChild(menuBackdrop);

if (menuPanelContent) {
  menuPanelContent.hidden = true;
  menuBackdrop.appendChild(menuPanelContent);
  menuPanelContent.addEventListener("click", (event) => {
    event.stopPropagation();
  });
}

export { dateFormatter };
