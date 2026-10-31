// Curated public product facts only. No sample quote, premium or personal offer.
export const paxErwerbsunfaehigkeit = {
  id: "pax-erwerbsunfaehigkeit",
  name: "Pax Erwerbsunfähigkeitsversicherung",
  bedarfsart: "einkommensschutz",
  beschreibung:
    "Private Rentenleistung bei versicherter Erwerbsunfähigkeit als mögliche Ergänzung zu staatlichen und beruflichen Leistungen. Die konkrete Deckung wird vertraglich festgelegt.",
  quelle:
    "https://www.pax.ch/de/private-vorsorge/produkte/pax-erwerbsunfaehigkeitsversicherung",
  quellenstand: "2026-10-31",
  fachlicheFreigabe:
    "Noch keine individuelle Eignungsprüfung oder Freigabe durch Pax.",
} as const;
export type Produkt = typeof paxErwerbsunfaehigkeit;
