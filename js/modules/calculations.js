import { sanitizeAmount } from './utils.js';

export function getEstimateAmount(record) {
  if (record?.pricingMode === "per_person") {
    const participantCount = Math.max(1, Number(record.participantCountSnapshot) || 1);
    const perPersonAmount = sanitizeAmount(record.perPersonAmount || 0);
    return sanitizeAmount(perPersonAmount * participantCount);
  }
  return sanitizeAmount(record?.amount || 0);
}

export function calculateSummary(state) {
  const totalInitial = state.contributions
    .filter((item) => item.type === "initial")
    .reduce((sum, item) => sum + item.amount, 0);

  const totalTopups = state.contributions
    .filter((item) => item.type === "topup")
    .reduce((sum, item) => sum + item.amount, 0);

  const totalExpenses = state.expenses.reduce((sum, item) => sum + item.amount, 0);
  const totalEstimates = state.estimates.reduce((sum, item) => sum + getEstimateAmount(item), 0);
  const remaining = totalInitial + totalTopups - totalExpenses;
  const remainingAfterEstimates = remaining - totalEstimates;
  const participantCount = state.participants.length;
  const remainingPerPerson = participantCount ? remaining / participantCount : 0;
  const remainingAfterEstimatesPerPerson = participantCount ? remainingAfterEstimates / participantCount : 0;

  return {
    totalInitial,
    totalTopups,
    totalExpenses,
    totalEstimates,
    remaining,
    remainingPerPerson,
    remainingAfterEstimates,
    remainingAfterEstimatesPerPerson,
    participantCount,
  };
}

export function getSortedParticipants(state) {
  return state.participants
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "nl", { sensitivity: "base" }));
}
