import type { Profil, PersonId } from "../profil/profil.js";
import type { RiskResponse } from "./risiko.js";

export interface PrivateEuVergleich {
  szenario: string;
  person: PersonId;
  ursache: "krankheit" | "unfall";
  status:
    "offen" | "keine" | "nicht_gedeckt" | "modelliert" | "nicht_verwendbar";
  apiLuecke: number | null;
  privateJahresrente: number | null;
  wartefristMonate: number | null;
  leistungsendeAlter: number | null;
  zurLueckendeckung: number | null;
  lueckeNachLeistungsbeginn: number | null;
  offeneAngaben: string[];
  hinweise: string[];
}
export interface PrivateEuAnsicht {
  status: string;
  hinweise: string[];
  vergleiche: PrivateEuVergleich[];
}
const SZENARIEN = {
  1: {
    person: "A",
    ursache: "krankheit",
    szenario: "Erwerbsunfähigkeit durch Krankheit – Person A",
  },
  2: {
    person: "A",
    ursache: "unfall",
    szenario: "Erwerbsunfähigkeit durch Unfall – Person A",
  },
  5: {
    person: "B",
    ursache: "krankheit",
    szenario: "Erwerbsunfähigkeit durch Krankheit – Person B",
  },
  6: {
    person: "B",
    ursache: "unfall",
    szenario: "Erwerbsunfähigkeit durch Unfall – Person B",
  },
} as const;

// Pure application logic, not a replacement for underwriting or benefit coordination.
// Never changes the APICalc request/response or recomputes a capitalised lifetime gap.
export function vergleichePrivateEu(
  profil: Profil,
  antwort: RiskResponse | null,
  jahr: number,
): PrivateEuAnsicht {
  const hinweise = [
    "Zusätzlicher Modellvergleich anhand von Kundenaussagen, keine Prüfung von Vertrag, Leistungsanspruch oder Erwerbsunfähigkeitsgrad.",
    "Vor Leistungsbeginn während der Wartefrist und nach Leistungsende bleibt die ursprüngliche API-Lücke unter sonst gleichen Annahmen bestehen.",
    "Nur ein bestätigter privater EU-Rentenvertrag pro Person. Bei mehreren Verträgen oder unklarer Verrechnung ist menschliche Prüfung nötig.",
    "Todesfall, Pensionierung und kapitalisierte API-Lücken werden nicht verändert. Es wird keine neue kapitalisierte Restlücke berechnet.",
  ];
  if (!antwort)
    return {
      status: "Ein aktuelles Risikoberechnungsergebnis wird benötigt.",
      hinweise,
      vergleiche: [],
    };
  const vergleiche: PrivateEuVergleich[] = [];
  for (const s of antwort.response.RiskScenarioSummaries) {
    const basis = SZENARIEN[s.Scenario as keyof typeof SZENARIEN];
    if (!basis) continue; // Death benefits can never be offset by a disability pension.
    const person = profil.personen[basis.person],
      eu = person?.privateEu;
    const r: PrivateEuVergleich = {
      ...basis,
      status: "offen",
      apiLuecke: null,
      privateJahresrente: eu?.jahresrente?.wert ?? null,
      wartefristMonate: eu?.wartefristMonate?.wert ?? null,
      leistungsendeAlter: eu?.leistungsendeAlter?.wert ?? null,
      zurLueckendeckung: null,
      lueckeNachLeistungsbeginn: null,
      offeneAngaben: [],
      hinweise: [],
    };
    vergleiche.push(r);
    // The live risk API reports success as 0; Swagger v1.2 documents 1.
    // Accept these observed/documented success codes, not other or absent codes.
    if (
      (s.ErrorCode !== 0 && s.ErrorCode !== 1) ||
      s.IncomeGap === undefined ||
      !Number.isFinite(s.IncomeGap) ||
      s.IncomeGap < 0
    ) {
      r.status = "nicht_verwendbar";
      r.hinweise.push(
        "Kein erfolgreiches vollständiges API-Szenario. Keine private Leistung angerechnet.",
      );
      continue;
    }
    r.apiLuecke = s.IncomeGap;
    if (eu?.vorhanden?.wert === false) {
      r.status = "keine";
      r.hinweise.push(
        "Laut Kundenangabe keine private EU-Rente vorhanden. API-Lücke unverändert.",
      );
      continue;
    }
    if (!eu?.vorhanden)
      r.offeneAngaben.push(
        "Ob für diese Person eine private Erwerbsunfähigkeitsrente besteht.",
      );
    if (!eu?.jahresrente)
      r.offeneAngaben.push(
        "Bestehende private Rentenhöhe in CHF pro Monat oder Jahr.",
      );
    if (!eu?.deckung)
      r.offeneAngaben.push("Deckung bei Krankheit, Unfall oder beidem.");
    if (!eu?.wartefristMonate)
      r.offeneAngaben.push(
        "Wartefrist in Monaten (auch 0 ausdrücklich nennen).",
      );
    if (!eu?.leistungsendeAlter)
      r.offeneAngaben.push("Alter bei Ende der Rentenleistung.");
    if (eu?.mehrereVertraege?.wert !== false)
      r.offeneAngaben.push(
        "Bestätigen, dass genau ein privater EU-Rentenvertrag betrachtet wird. Mehrere Verträge benötigen weitere Prüfung.",
      );
    if (eu?.zusaetzlichBestaetigt?.wert !== true)
      r.offeneAngaben.push(
        "Zusätzliche Auszahlung ohne Verrechnung/Kürzung anderer Leistungen bestätigen; bei Unsicherheit Vertrag fachlich prüfen lassen.",
      );
    if (eu?.mehrereVertraege?.wert === true) {
      r.status = "nicht_verwendbar";
      r.hinweise.push(
        "Mehrere Verträge sind noch nicht unterstützt. Keine Leistungen addieren oder pauschal anrechnen.",
      );
      continue;
    }
    if (
      eu?.deckung &&
      eu.deckung.wert !== "beides" &&
      eu.deckung.wert !== basis.ursache
    ) {
      r.status = "nicht_gedeckt";
      r.hinweise.push(
        "Die angegebene private Rente deckt diese Ursache nicht. Keine Anrechnung; API-Lücke unverändert.",
      );
      continue;
    }
    if (r.offeneAngaben.length) continue;
    const geburtsjahr = person?.geburtsjahr?.wert;
    const endjahr =
      geburtsjahr === undefined
        ? null
        : geburtsjahr + eu!.leistungsendeAlter!.wert;
    // Only birth year is stored: stop when the waiting period could reach the
    // earliest possible end date. Do not invent a month/day or assume renewed cover.
    if (
      endjahr === null ||
      endjahr <= jahr ||
      eu!.wartefristMonate!.wert >= (endjahr - jahr - 1) * 12
    ) {
      r.status = "nicht_verwendbar";
      r.hinweise.push(
        "Leistungsende bereits erreicht oder nach Jahrgang zu nah an der Wartefrist. Zeitpunkte müssen genauer geprüft werden.",
      );
      continue;
    }
    r.status = "modelliert";
    r.zurLueckendeckung = Math.min(s.IncomeGap, eu!.jahresrente!.wert);
    r.lueckeNachLeistungsbeginn = Math.max(
      0,
      s.IncomeGap - eu!.jahresrente!.wert,
    );
    r.hinweise.push(
      `Nur ab Leistungsbeginn nach ${eu!.wartefristMonate!.wert} Monaten und während der Leistung bis Alter ${eu!.leistungsendeAlter!.wert}. Jahresbeträge, kein Durchschnitt über die Wartefrist.`,
    );
    if (eu!.jahresrente!.wert > s.IncomeGap)
      r.hinweise.push(
        "Die Rente übersteigt die API-Lücke; nur der zur Lückendeckung benötigte Teil wird dargestellt. Keine negative Lücke.",
      );
  }
  return {
    status:
      "Vergleich bestehender privater EU-Rente mit der ursprünglichen API-Lücke.",
    hinweise,
    vergleiche,
  };
}
