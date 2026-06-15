import { sanitizeAmount } from './utils.js';

/**
 * Berekent de minimale overdrachten om schulden af te wikkelen.
 * Logica: elke deelnemer heeft een eerlijk aandeel in de totale pot.
 * Saldo = persoonlijke inleg (initial) minus eerlijk aandeel (totale pot / aantal deelnemers).
 * Topups worden als gezamenlijk beschouwd en gelijk verdeeld.
 * Algoritme: minimum cash flow via gesorteerde positieve/negatieve saldi.
 * @returns {Array<{from: string, to: string, amount: number}>}
 */
export function calculateSettlements(state) {
  const participantCount = state.participants.length;
  if (participantCount < 2) return [];

  // Totale pot = alle bijdragen (initial + topups)
  const totalPot = state.contributions.reduce((sum, item) => sum + item.amount, 0);
  const fairShare = sanitizeAmount(totalPot / participantCount);

  // Saldo per deelnemer: persoonlijke inleg minus eerlijk aandeel
  const rawBalances = state.participants.map((participant) => {
    const personalContribution = state.contributions
      .filter((item) => item.participantId === participant.id && item.type === "initial")
      .reduce((sum, item) => sum + item.amount, 0);
    return {
      name: participant.name,
      balance: sanitizeAmount(personalContribution - fairShare),
    };
  });

  // Minimum cash flow algoritme
  const creditors = rawBalances.filter((b) => b.balance > 0.005).map((b) => ({ ...b }));
  const debtors = rawBalances.filter((b) => b.balance < -0.005).map((b) => ({ ...b }));

  // Sorteren op absoluut bedrag voor efficiëntere matches
  creditors.sort((a, b) => b.balance - a.balance);
  debtors.sort((a, b) => a.balance - b.balance);

  const settlements = [];
  let ci = 0;
  let di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const credit = creditors[ci];
    const debt = debtors[di];
    const amount = sanitizeAmount(Math.min(credit.balance, Math.abs(debt.balance)));

    if (amount >= 0.01) {
      settlements.push({
        from: debt.name,
        to: credit.name,
        amount,
      });
    }

    credit.balance = sanitizeAmount(credit.balance - amount);
    debt.balance = sanitizeAmount(debt.balance + amount);

    if (credit.balance < 0.005) ci++;
    if (Math.abs(debt.balance) < 0.005) di++;
  }

  return settlements;
}

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
    .filter((item) => item.type === "initial" && !item.isEstimate)
    .reduce((sum, item) => sum + item.amount, 0);

  const totalInitialEstimates = state.contributions
    .filter((item) => item.type === "initial" && item.isEstimate)
    .reduce((sum, item) => sum + item.amount, 0);

  const totalTopups = state.contributions
    .filter((item) => item.type === "topup" && !item.isEstimate)
    .reduce((sum, item) => sum + item.amount, 0);

  const totalTopupEstimates = state.contributions
    .filter((item) => item.type === "topup" && item.isEstimate)
    .reduce((sum, item) => sum + item.amount, 0);

  const totalInlegEstimates = totalInitialEstimates + totalTopupEstimates;

  const totalExpenses = state.expenses.reduce((sum, item) => sum + item.amount, 0);
  const totalEstimates = state.estimates.reduce((sum, item) => sum + getEstimateAmount(item), 0);
  const remaining = totalInitial + totalTopups - totalExpenses;
  const remainingAfterEstimates = remaining + totalInlegEstimates - totalEstimates;
  const participantCount = state.participants.length;
  const remainingPerPerson = participantCount ? remaining / participantCount : 0;
  const remainingAfterEstimatesPerPerson = participantCount ? remainingAfterEstimates / participantCount : 0;

  return {
    totalInitial,
    totalInitialEstimates,
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
  };
}

export function getSortedParticipants(state) {
  return state.participants
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "nl", { sensitivity: "base" }));
}
