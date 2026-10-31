import type { AblaufStand } from "../beratung/ablauf.js";
import { vergleichePrivateEu } from "../berechnung/private-eu.js";
import type { PersonId } from "../profil/profil.js";
import { paxErwerbsunfaehigkeit, type Produkt } from "./katalog.js";

export interface ProduktFall {
  id: string;
  regelId: "eu-pruefkandidat-v1";
  status:
    | "pruefkandidat"
    | "abklaerung"
    | "kein_zusaetzlicher_bedarf"
    | "nicht_bereit";
  person: PersonId;
  ursache: "krankheit" | "unfall";
  szenario: string;
  produkt: Produkt | null;
  handlungId: string;
  begruendung: string;
  datengrundlage: { quelle: string; details: string }[];
  urspruenglicheLueckeProJahr: number | null;
  restlueckeProJahr: number | null;
  bestehendeWartefristMonate: number | null;
  bestehendeLeistungBisAlter: number | null;
  geltungsbereich: string;
  offenePruefungen: string[];
  naechsterSchritt: string;
  aktion: { label: string; nachricht: string };
}
export interface Produktzuordnung {
  statusText: string;
  hinweise: string[];
  faelle: ProduktFall[];
}
const chf = (n: number) =>
  `CHF ${n.toLocaleString("de-CH", { maximumFractionDigits: 2 })}`;

// Determines a product CATEGORY match, not underwriting, tariff or suitability.
// No network call, no new model authority, no mutation of calculation data.
export function ermittleProduktvorschlaege(
  stand: AblaufStand,
): Produktzuordnung {
  const { profil, pruefung, berechnung, jahr } = stand.kontext;
  const result: Produktzuordnung = {
    statusText:
      "Noch kein aktuelles Risikoergebnis für eine begründete EU-Produktzuordnung.",
    hinweise: [
      "Ein Prüfkandidat ist eine mögliche Lösung zur fachlichen Prüfung, keine Kaufempfehlung, Offerte, Versicherungsannahme oder bestehende Deckung.",
      "Es liegt keine Tarifquelle vor: Prämie, passende neue Rentenhöhe, Wartefrist und Leistungsdauer sind offen. Die Restlücke wird nicht automatisch zur Versicherungssumme.",
      "Das angegebene Pensionierungsbudget ist kein Budget für eine zusätzliche EU-Versicherungsprämie. Diese Tragbarkeit muss gesondert geprüft werden.",
      "Gesundheits- und Annahmeprüfung gehören in einen geeigneten getrennten Prozess außerhalb dieses Chats. Keine Diagnosen oder Dokumente im Chat erfassen.",
    ],
    faelle: [],
  };
  if (
    stand.phase !== "berechnet" ||
    !berechnung ||
    !pruefung.request ||
    berechnung.requestJson !== pruefung.requestJson
  )
    return result;
  const vergleich = vergleichePrivateEu(profil, berechnung.antwort, jahr);
  for (const v of vergleich.vergleiche) {
    const person = profil.personen[v.person];
    if (!person || (v.person === "B" && !pruefung.request.Person2)) continue;
    const fall: ProduktFall = {
      id: `eu-${v.person}-${v.ursache}`,
      regelId: "eu-pruefkandidat-v1",
      status: "nicht_bereit",
      person: v.person,
      ursache: v.ursache,
      szenario: v.szenario,
      produkt: null,
      handlungId: `risikoluecke-${v.person}`,
      begruendung:
        "Für dieses Szenario fehlt eine ausreichend belastbare Bedarfsgrundlage.",
      datengrundlage: [
        {
          quelle: "Aktuelle APICalc-Risikoberechnung",
          details: `${v.szenario}; Ergebnis vom ${berechnung.zeitpunkt}. Individuelle PK-Risikoleistungen werden noch nicht aus einem Vorsorgeausweis übernommen.`,
        },
      ],
      urspruenglicheLueckeProJahr: v.apiLuecke,
      restlueckeProJahr: null,
      bestehendeWartefristMonate: null,
      bestehendeLeistungBisAlter: null,
      geltungsbereich:
        "Noch kein bestätigter zusätzlicher jährlicher EU-Bedarf.",
      offenePruefungen: [],
      naechsterSchritt:
        "Zuerst die offenen Bedarfs- und Leistungsgrundlagen klären.",
      aktion: {
        label: "Grundlagen klären",
        nachricht: `Welche Angaben fehlen noch, um den Erwerbsunfähigkeitsbedarf von Person ${v.person} bei ${v.ursache === "krankheit" ? "Krankheit" : "Unfall"} zu prüfen? Zeige noch kein konkretes Produkt an.`,
      },
    };
    result.faelle.push(fall);
    if (!person.bedarfInvaliditaet) {
      fall.offenePruefungen = [
        "Einen eigenen Bedarf bei Erwerbsunfähigkeit erfassen; fehlender Bedarf bedeutet nicht CHF 0.",
      ];
      continue;
    }
    if (
      v.apiLuecke === null ||
      !Number.isFinite(v.apiLuecke) ||
      v.apiLuecke < 0
    ) {
      fall.offenePruefungen = [
        "Erfolgreiches vollständiges EU-Szenario berechnen.",
      ];
      continue;
    }
    if (
      v.status === "offen" ||
      v.status === "nicht_verwendbar" ||
      (v.status === "nicht_gedeckt" && v.offeneAngaben.length > 0)
    ) {
      fall.status = "abklaerung";
      fall.begruendung =
        "Die bestehende private Absicherung oder deren Anrechnung ist nicht ausreichend geklärt. Deshalb wird noch kein Produktprüfkandidat angezeigt.";
      fall.offenePruefungen = v.offeneAngaben.length
        ? v.offeneAngaben
        : ["Vertragsdauer, Wartefrist und Leistungsanspruch fachlich prüfen."];
      fall.datengrundlage.push({
        quelle: "Separater Backend-Modellvergleich",
        details: `Status ${v.status}; keine bestätigte reduzierte Restlücke.`,
      });
      continue;
    }
    const rest =
      v.status === "modelliert" ? v.lueckeNachLeistungsbeginn : v.apiLuecke;
    if (rest === null || !Number.isFinite(rest) || rest < 0) continue;
    fall.restlueckeProJahr = rest;
    fall.bestehendeWartefristMonate =
      v.status === "modelliert" ? v.wartefristMonate : null;
    fall.bestehendeLeistungBisAlter =
      v.status === "modelliert" ? v.leistungsendeAlter : null;
    fall.geltungsbereich =
      v.status === "modelliert"
        ? `Nur nach ${v.wartefristMonate} Monaten Wartefrist und während der bestehenden Rentenleistung bis Alter ${v.leistungsendeAlter}. Während der Wartefrist und nach Leistungsende ist der Bedarf gesondert zu prüfen.`
        : "Ursprüngliche jährliche Modelllücke ohne passende bestehende private Rentenleistung; die benötigten Vertragszeiträume sind noch festzulegen.";
    fall.datengrundlage.push({
      quelle:
        v.status === "modelliert"
          ? "Backend-Vergleich bestehender privater EU-Rente"
          : "Deklarierte bestehende Absicherung",
      details:
        v.status === "modelliert"
          ? `API-Lücke ${chf(v.apiLuecke)}/Jahr, deklarierte private Rente ${chf(v.privateJahresrente!)}/Jahr, Restlücke ${chf(rest)}/Jahr während der Leistungsphase.`
          : v.status === "keine"
            ? "Laut Kundenangabe keine private EU-Rente vorhanden."
            : "Die deklarierte private Rente deckt diese Ursache nicht; bekannte Vertragsangaben sind abgegrenzt.",
    });
    if (rest === 0) {
      const zeitlicheLuecke = v.status === "modelliert" && v.apiLuecke > 0;
      fall.status = zeitlicheLuecke
        ? "abklaerung"
        : "kein_zusaetzlicher_bedarf";
      fall.begruendung = zeitlicheLuecke
        ? "Während der bestehenden Rentenleistung bleibt keine Jahreslücke; die Wartefrist und die Zeit nach Leistungsende sind damit noch nicht abgesichert."
        : "Aus der aktuellen erfassten jährlichen Modelllücke ergibt sich kein zusätzlicher EU-Produktprüfkandidat. Das bestätigt keine vollständige Absicherung.";
      fall.offenePruefungen = zeitlicheLuecke
        ? [
            "Bedarf während der Wartefrist und nach Ende der bestehenden Rentenleistung prüfen.",
          ]
        : [
            "Modellannahmen und individuelle Leistungsgrundlagen bei Bedarf fachlich bestätigen.",
          ];
      fall.naechsterSchritt = zeitlicheLuecke
        ? "Die bisher nicht abgedeckten Zeitabschnitte klären."
        : "Kein zusätzliches EU-Produkt aus diesem Ergebnis vorschlagen.";
      continue;
    }
    fall.status = "pruefkandidat";
    fall.produkt = paxErwerbsunfaehigkeit;
    fall.begruendung = `Im Szenario ${v.szenario} verbleiben im abgegrenzten Modell ${chf(rest)} Einkommenslücke pro Jahr. Eine private Erwerbsunfähigkeitsrente könnte diesen Bedarfsbereich adressieren.`;
    fall.offenePruefungen = [
      "Individuelle PK-Risikoleistungen und bestehende Vertragskoordination fachlich bestätigen.",
      "Bedarf vor Leistungsbeginn sowie nach Ende bestehender Leistungen prüfen.",
      "Passende neue Rentenhöhe, Deckung, Wartefrist und Versicherungsdauer mit Pax bestimmen.",
      "Annahmebedingungen und gegebenenfalls Gesundheitsprüfung im getrennten Prozess klären.",
      "Individuelle Prämie aus bestätigter Tarifquelle ermitteln und ein gesondertes Budget dafür abgleichen.",
    ];
    fall.naechsterSchritt =
      "Die Bedarfsgrundlage und offenen Fragen für eine Pax-Beratung zusammenfassen. Es wird noch kein Antrag gestellt oder Termin gebucht.";
    fall.aktion = {
      label: "Pax-Beratung vorbereiten",
      nachricht: `Bereite für Person ${v.person} eine Zusammenfassung des aktuellen EU-Produktprüfkandidaten bei ${v.ursache === "krankheit" ? "Krankheit" : "Unfall"} vor: Bedarf, Herkunft, zeitliche Grenzen und offene Prüfungen. Keine verbindliche Versicherungssumme, Prämie, Annahme oder bereits erfolgte Übergabe behaupten. Sende nichts an Dritte.`,
    };
  }
  result.statusText =
    "Bedarfsbezogene Zuordnung zur Pax-EU-Versicherung; keine abschließende Produkteignungsprüfung.";
  return result;
}
