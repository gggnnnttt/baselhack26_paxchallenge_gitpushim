export interface EmpfehlungenAntwort {
  revision: number;
  status: 'vorschlaege' | 'kein_bedarf' | 'offen';
  statusText: string; regelHinweis: string; textquelle: 'ki';
  empfehlungen: {
    id: string; titel: string; begruendung: string; grundlage: string; hinweis: string | null;
    produkt: { id: string; name: string; saeule: '3a' | '3b' | null; beschreibung: string; merkmale: string[]; quelle: string };
  }[];
}
