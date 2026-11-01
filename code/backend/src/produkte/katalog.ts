// Curated general product facts, paraphrased. Never import offers or personal contact data.
export interface Produkt {
  id: string; name: string; bedarfsart: string; saeule: '3a' | '3b' | null;
  beschreibung: string; merkmale: string[]; qualifiziert: boolean;
  quelle: string; quellenstand: string; fachlicheFreigabe: string;
}
const produkt = (id: string, name: string, bedarfsart: string, saeule: Produkt['saeule'], beschreibung: string, merkmale: string[], qualifiziert = false): Produkt => ({
  id, name, bedarfsart, saeule, beschreibung, merkmale, qualifiziert,
  quelle: 'https://www.pax.ch/', quellenstand: '2026-10-31',
  fachlicheFreigabe: 'Noch keine individuelle Eignungsprüfung oder Freigabe durch Pax.',
});
export const paxErwerbsunfaehigkeit = produkt('pax-erwerbsunfaehigkeit', 'Pax Erwerbsunfähigkeitsversicherung', 'einkommensschutz', '3b',
  'Private Rentenleistung bei versicherter Erwerbsunfähigkeit als Ergänzung zur staatlichen und beruflichen Vorsorge. Die konkrete Deckung wird vertraglich festgelegt.',
  ['Jährliche Rente nach vereinbarter Wartefrist', 'Prämienbefreiung gemäss Vertrag', 'Unterstützung durch Krisencoach']);
export const paxTodesfall = produkt('pax-todesfall', 'Pax Todesfallversicherung', 'hinterbliebene', '3b',
  'Finanzielle Absicherung von Hinterbliebenen durch ein vertraglich vereinbartes Todesfallkapital.', ['Garantiertes Todesfallkapital gemäss Vertrag', 'Schutz für Hinterbliebene']);
export const paxLifeStar = produkt('pax-terza-lifestar', 'Pax TerzaLifeStar', 'ruhestand', '3a',
  'Vorsorgesparen mit einem garantierten Anlageteil und einem Fondsanteil.', ['Garantierter Anteil gemäss Vertrag', 'Fondsanteil mit Wertschwankungen', 'Schutz bei Tod und Erwerbsunfähigkeit zubuchbar'], true);
export const paxFondsStar = produkt('pax-terza-fondsstar', 'Pax TerzaFondsStar', 'ruhestand', '3a',
  'Vorsorgesparen mit vollständig fondsgebundener Anlage und entsprechenden Wertschwankungen.', ['Sparanteil vollständig in Fonds', 'Anlagerisiko liegt bei Ihnen', 'Prämienbefreiung bei Familienzuwachs zubuchbar'], true);
export const paxAuszahlungsplan = produkt('pax-auszahlungsplan', 'Pax Auszahlungsplan', 'ruhestand', '3b',
  'Eine einmalige Investition ermöglicht geplante Auszahlungen in Etappen.', ['Einmalinvestition für gestaffelte Auszahlungen', 'Garantierter Anlageteil gemäss Vertrag', 'Fondsanteil mit Wertschwankungen'], true);
export const paxBeratung = produkt('pax-beratung', 'Persönliche Pax-Beratung', 'beratung', null,
  'Eine Fachperson prüft die offenen Grundlagen und Ihre individuelle Situation.', ['Persönliche Prüfung vor weiteren Entscheidungen']);
export const produktkatalog = [paxErwerbsunfaehigkeit, paxTodesfall, paxLifeStar, paxFondsStar, paxAuszahlungsplan, paxBeratung];
