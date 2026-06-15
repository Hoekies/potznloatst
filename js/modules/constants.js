export const storageKey = "potzloats-state-v4";
export const primaryStorageKey = "potzloats-state-v5";
export const migrationStorageKey = "potzloats-supabase-migrations-v1";

export const authStatusFallback = "Je kunt lokaal blijven werken, maar online sync staat klaar zodra Supabase is gekoppeld.";

export const currencyFormatter = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
});

export const dateFormatter = new Intl.DateTimeFormat("nl-NL", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

export const categoryLabels = {
  accommodatie: "Accommodatie",
  eten: "Eten",
  drinken: "Drinken",
  activiteit: "Activiteit",
  vervoer: "Vervoer",
  overig: "Overig",
};

export const typeLabels = {
  contribution: "Inleg",
  "contribution-estimate": "Raming startinleg",
  topup: "Extra inleg",
  "topup-estimate": "Raming inleg",
  expense: "Uitgave",
  estimate: "Raming",
};

export const categoryEmoji = {
  accommodatie: "\u{1F3E0}",
  eten: "\u{1F37D}",
  drinken: "\u{1F37B}",
  activiteit: "\u{1F3AF}",
  vervoer: "\u{1F697}",
  overig: "\u{1F9FE}",
};

export const CROP_SIZE = 160;
