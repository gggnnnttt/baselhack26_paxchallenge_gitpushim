import type { AblaufStand } from "./ablauf.js";
import { gleicheBudgetAb } from "../berechnung/budget.js";
import { vergleichePrivateEu } from "../berechnung/private-eu.js";
import { personLabel, type PersonId } from "../profil/profil.js";

export interface Handlungskarte {
  id: string;
  reihenfolge: number;
  prioritaet: 1 | 2 | 3;
  kategorie: "grundlagen" | "klaerung" | "planung" | "naechster_schritt";
  titel: string;
  begruendung: string;
  datengrundlage: { quelle: string; details: string }[];
  offeneFragen: string[];
  naechsterSchritt: string;
  aktion: { label: string; nachricht: string };
}
export interface Handlungsplan {
  hinweis: string;
  karten: Handlungskarte[];
}
const chf = (n: number) =>
  `CHF ${n.toLocaleString("de-CH", { maximumFractionDigits: 2 })}`;
const pkAngabe = (label: string) => /PK-Altersrente|PK-Guthaben/.test(label);

// Pure, deterministic workflow rules. Cards are regenerated from current data;
// neither the model nor the browser assigns priority or invents completion.
export function erstelleHandlungsplan(stand: AblaufStand): Handlungsplan {
  const { profil, jahr, berechnung, pruefung } = stand.kontext;
  const karten: Omit<Handlungskarte, "reihenfolge">[] = [];
  const add = (karte: Omit<Handlungskarte, "reihenfolge">) =>
    karten.push(karte);
  const pension = stand.pensionierung;
  const budget = gleicheBudgetAb(profil, stand.sparen);
  const pensionAktiv =
    profil.haushalt.bedarfPensionierung !== undefined ||
    profil.haushalt.vermoegenPensionierung !== undefined ||
    profil.haushalt.budgetPensionierungMonat !== undefined ||
    Object.values(profil.personen).some(
      (p) => p?.pensionierungsalter !== undefined,
    );
  const risikoAktiv = Object.values(profil.personen).some(
    (p) =>
      p?.bedarfInvaliditaet !== undefined ||
      p?.bedarfTodesfall !== undefined ||
      p?.privateEu?.vorhanden?.wert === true,
  );
  const risikoAktuell =
    stand.phase === "berechnet" &&
    berechnung !== null &&
    berechnung.requestJson === pruefung.requestJson;
  const privat = vergleichePrivateEu(
    profil,
    risikoAktuell && berechnung ? berechnung.antwort : null,
    jahr,
  );

  if (pensionAktiv && pension.pruefung.fehlend.length) {
    const pk = pension.pruefung.fehlend.filter((f) => pkAngabe(f.label));
    const andere = pension.pruefung.fehlend.filter((f) => !pkAngabe(f.label));
    if (pk.length)
      add({
        id: "pension-pk",
        prioritaet: 1,
        kategorie: "grundlagen",
        titel: "PK-Alterswerte ergänzen",
        begruendung:
          "Für die Pensionierungsrechnung fehlen individuelle PK-Werte. Sie werden nicht still aus dem Einkommen geschätzt.",
        datengrundlage: [
          {
            quelle: "Eingabeprüfung Pensionierung",
            details: pk.map((f) => f.label).join("; "),
          },
        ],
        offeneFragen: pk.map((f) => f.label),
        naechsterSchritt:
          "Die fehlenden synthetischen Renten- und Guthabenwerte der richtigen Person zuordnen.",
        aktion: {
          label: "Fehlende PK-Werte klären",
          nachricht:
            "Welche PK-Alterswerte fehlen für meine Pensionierungsrechnung? Frage mich gezielt nach den noch fehlenden Angaben; ich verwende nur erfundene Beträge.",
        },
      });
    if (andere.length)
      add({
        id: "pension-grundlagen",
        prioritaet: 1,
        kategorie: "grundlagen",
        titel: "Pensionierungsgrundlagen vervollständigen",
        begruendung:
          "Ohne die noch offenen Eingaben kann kein aktuelles Pensionierungsergebnis verwendet werden.",
        datengrundlage: [
          {
            quelle: "Eingabeprüfung Pensionierung",
            details: andere.map((f) => f.label).join("; "),
          },
        ],
        offeneFragen: andere.map((f) => f.label),
        naechsterSchritt:
          "Die offenen Angaben schrittweise bestätigen, statt unbekannte Werte als null zu setzen.",
        aktion: {
          label: "Angaben ergänzen",
          nachricht:
            "Hilf mir, die noch fehlenden Grundlagen meiner Pensionierungsrechnung zu ergänzen. Stelle mir höchstens zwei passende Fragen auf einmal.",
        },
      });
  }
  if (risikoAktiv && !risikoAktuell && pruefung.fehlend.length)
    add({
      id: "risiko-grundlagen",
      prioritaet: 1,
      kategorie: "grundlagen",
      titel: "Risikogrundlagen vervollständigen",
      begruendung:
        "Ein aktuelles Risikoergebnis fehlt. Frühere oder unvollständige Ergebnisse reichen nicht für eine Restlückenbewertung.",
      datengrundlage: [
        {
          quelle: "Eingabeprüfung Risiko",
          details: pruefung.fehlend.map((f) => f.label).join("; "),
        },
      ],
      offeneFragen: pruefung.fehlend.map((f) => f.label),
      naechsterSchritt:
        "Die fehlenden Haushaltsangaben klären und anschließend neu berechnen.",
      aktion: {
        label: "Risikodaten ergänzen",
        nachricht:
          "Welche Angaben fehlen noch für meine Risikoberechnung? Frage mich gezielt nach den nächsten ein bis zwei Angaben.",
      },
    });
  if (
    (pensionAktiv &&
      (pension.phase === "fehlgeschlagen" || pension.phase === "bereit")) ||
    (risikoAktiv &&
      (stand.phase === "fehlgeschlagen" || stand.phase === "bereit"))
  )
    add({
      id: "berechnung-verfuegbarkeit",
      prioritaet: 1,
      kategorie: "klaerung",
      titel: "Aktuelle Berechnung abwarten oder erneut prüfen",
      begruendung:
        "Mindestens eine benötigte Berechnung ist nicht verfügbar. Es wird daraus keine neue persönliche Lücke abgeleitet.",
      datengrundlage: [
        {
          quelle: "Berechnungsstatus",
          details: `Risiko: ${stand.phase}; Pensionierung: ${pension.phase}`,
        },
      ],
      offeneFragen: ["Ist die Berechnung wieder verfügbar?"],
      naechsterSchritt:
        "Den aktuellen Berechnungsstand erneut prüfen; bei fortbestehendem Ausfall Unterstützung hinzuziehen.",
      aktion: {
        label: "Berechnung erneut prüfen",
        nachricht:
          "Bitte prüfe meine Berechnungsgrundlagen erneut. Erkläre bei einem Ausfall die Grenze und verwende keine veralteten Ergebnisse.",
      },
    });

  for (const id of ["A", "B"] as PersonId[]) {
    const person = profil.personen[id];
    if (!person) continue;
    const eu = person.privateEu;
    const vergleiche = privat.vergleiche.filter((v) => v.person === id);
    const ungeklaert = vergleiche.some(
      (v) => v.status === "offen" || v.status === "nicht_verwendbar",
    );
    // A declared contract can need clarification even before an API call exists.
    const vertragUnklar =
      eu?.vorhanden?.wert === true &&
      (eu.zusaetzlichBestaetigt?.wert !== true ||
        eu.mehrereVertraege?.wert !== false);
    if (vertragUnklar || (ungeklaert && eu?.vorhanden?.wert === true)) {
      const fragen = [...new Set(vergleiche.flatMap((v) => v.offeneAngaben))];
      if (eu?.zusaetzlichBestaetigt?.wert !== true)
        fragen.unshift(
          "Wird die private Rente zusätzlich ohne Verrechnung oder Kürzung ausgezahlt?",
        );
      if (eu?.mehrereVertraege?.wert !== false)
        fragen.push(
          "Wird genau ein Vertrag betrachtet oder sind mehrere Verträge zu prüfen?",
        );
      if (!fragen.length)
        fragen.push(
          "Sind Leistungsende und Wartefrist für den betrachteten Zeitraum verwendbar?",
        );
      add({
        id: `private-eu-klaeren-${id}`,
        prioritaet: 1,
        kategorie: "klaerung",
        titel: `Bestehende private EU-Rente prüfen – ${personLabel(id)}`,
        begruendung:
          "Die bestehende Rente kann noch nicht zuverlässig angerechnet werden. Zuerst sind offene Vertragsbedingungen zu klären.",
        datengrundlage: [
          {
            quelle: "Deklarierte private EU-Rente",
            details: `${personLabel(id)}; Zusatzleistung ${eu?.zusaetzlichBestaetigt?.wert === true ? "laut Angabe bestätigt" : "ungeklärt"}; keine Vertragsprüfung erfolgt.`,
          },
          {
            quelle: "Backend-Modellvergleich",
            details:
              "Keine bestätigte reduzierte Restlücke aus offenen Bedingungen.",
          },
        ],
        offeneFragen: [...new Set(fragen)],
        naechsterSchritt:
          "Offene Bedingungen beim Versicherer oder einer Fachperson klären. Keine Unterlagen im Chat hochladen.",
        aktion: {
          label: "Fragen für die Abklärung vorbereiten",
          nachricht: `Formuliere für ${personLabel(id)} kurze Fragen zur Abklärung meiner bestehenden privaten Erwerbsunfähigkeitsrente. Sende nichts an Dritte und behaupte keine bereits erfolgte Vertragsprüfung.`,
        },
      });
    } else if (
      vergleiche.some((v) => v.status === "offen" && (v.apiLuecke ?? 0) > 0)
    )
      add({
        id: `private-eu-erfassen-${id}`,
        prioritaet: 1,
        kategorie: "grundlagen",
        titel: `Bestehende EU-Absicherung erfassen – ${personLabel(id)}`,
        begruendung:
          "Es gibt eine ursprüngliche API-Lücke, aber die bestehende private Absicherung ist noch unbekannt. Diese Lücke ist noch kein zusätzlicher Versicherungsbedarf.",
        datengrundlage: [
          {
            quelle: "Aktueller Risiko-Modellvergleich",
            details:
              "Positive ursprüngliche EU-Lücke; private Vertragsangaben fehlen.",
          },
        ],
        offeneFragen: [
          "Besteht bereits eine private Erwerbsunfähigkeitsrente für diese Person?",
        ],
        naechsterSchritt:
          "Zuerst vorhandene Absicherung erfragen, bevor über Ergänzungen gesprochen wird.",
        aktion: {
          label: "Bestehende Absicherung klären",
          nachricht: `Hilf mir, die bestehende private Erwerbsunfähigkeitsabsicherung für ${personLabel(id)} zu erfassen. Frage zuerst, ob eine solche Rente vorhanden ist.`,
        },
      });
    const rest = vergleiche.filter(
      (v) =>
        (v.status === "modelliert" && (v.lueckeNachLeistungsbeginn ?? 0) > 0) ||
        ((v.status === "keine" || v.status === "nicht_gedeckt") &&
          (v.apiLuecke ?? 0) > 0),
    );
    if (rest.length && !vertragUnklar && !ungeklaert)
      add({
        id: `risikoluecke-${id}`,
        prioritaet: 2,
        kategorie: "planung",
        titel: `Verbleibende EU-Lücke untersuchen – ${personLabel(id)}`,
        begruendung:
          "Auch nach dem abgegrenzten Vergleich bleibt in mindestens einem EU-Szenario eine jährliche Lücke.",
        datengrundlage: rest.map((v) => ({
          quelle:
            v.status === "modelliert"
              ? "Backend-Modellvergleich"
              : "APICalc ohne passende private Leistung",
          details: `${v.szenario}: ${chf(v.lueckeNachLeistungsbeginn ?? v.apiLuecke!)}/Jahr${v.status === "modelliert" ? ` erst nach ${v.wartefristMonate} Monaten bis Alter ${v.leistungsendeAlter}` : ""}.`,
        })),
        offeneFragen: [
          "Sind die konkreten PK-Leistungen und Vertragsbedingungen fachlich bestätigt?",
          "Welcher zusätzliche Schutz wäre finanziell tragbar?",
        ],
        naechsterSchritt:
          "Bedarf und individuelle Leistungsgrundlagen fachlich prüfen; noch keine konkrete Police oder Prämie empfehlen.",
        aktion: {
          label: "Restlücke verstehen",
          nachricht: `Erkläre die aktuelle verbleibende Erwerbsunfähigkeitslücke für ${personLabel(id)} einschließlich Wartefrist und Leistungsende. Welche fachlichen Fragen müssen vor einer Lösung noch geklärt werden?`,
        },
      });
  }
  if (risikoAktuell && berechnung) {
    const tod = berechnung.antwort.response.RiskScenarioSummaries.filter(
      (s) =>
        [3, 4, 7, 8].includes(s.Scenario) &&
        (s.ErrorCode === 0 || s.ErrorCode === 1) &&
        (s.IncomeGap ?? 0) > 0,
    );
    if (tod.length)
      add({
        id: "hinterbliebene-pruefen",
        prioritaet: 2,
        kategorie: "planung",
        titel: "Hinterbliebenenbedarf fachlich klären",
        begruendung:
          "Die ursprüngliche Berechnung weist eine Todesfalllücke aus. Bestehende private Todesfallabsicherung ist noch nicht erfasst.",
        datengrundlage: tod.map((s) => ({
          quelle: "APICalc – ursprüngliche Todesfallberechnung",
          details: `Szenario ${s.Scenario}: ${chf(s.IncomeGap!)}/Jahr; private Todesfallleistungen nicht berücksichtigt.`,
        })),
        offeneFragen: [
          "Welche bestehende Todesfallabsicherung und Verpflichtungen müssen in einer fachlichen Prüfung berücksichtigt werden?",
        ],
        naechsterSchritt:
          "Die Gesamtabsicherung mit einer Fachperson prüfen. Eine EU-Rente wird nicht für den Todesfall angerechnet.",
        aktion: {
          label: "Abklärung vorbereiten",
          nachricht:
            "Fasse die offenen Fragen zur Hinterbliebenenabsicherung für ein Beratungsgespräch zusammen. Behaupte keine geprüfte verbleibende Todesfalllücke und keine bereits erfolgte Übergabe.",
        },
      });
  }
  if (budget.status === "offen")
    add({
      id: "budget-erfassen",
      prioritaet: 1,
      kategorie: "grundlagen",
      titel: "Zusätzliches Monatsbudget klären",
      begruendung:
        "Der Sparbedarf ist berechnet, seine Passung zum verfügbaren Budget aber noch unbekannt.",
      datengrundlage: [
        {
          quelle: "APICalc-Sparszenario",
          details: `${chf(budget.sparbedarfMonat!)}/Monat; noch keine Budget-Selbstauskunft.`,
        },
      ],
      offeneFragen: [
        "Wie viel ist nach Ausgaben, bestehenden Sparverpflichtungen und Reserve zusätzlich für die Pensionierung verfügbar?",
      ],
      naechsterSchritt:
        "Einen geschätzten zusätzlichen Monatsbetrag nennen; unbekannt darf offenbleiben.",
      aktion: {
        label: "Budget klären",
        nachricht:
          "Hilf mir, mein zusätzlich verfügbares monatliches Pensionierungsbudget nach Ausgaben, bestehenden Sparverpflichtungen und Reserve einzuschätzen. Leite keinen Betrag aus meinem Bruttolohn ab.",
      },
    });
  if (budget.status === "unterdeckung")
    add({
      id: "pension-budget-abstimmen",
      prioritaet: 2,
      kategorie: "planung",
      titel: "Pensionierungsziel und Budget abstimmen",
      begruendung: `Dein angegebenes Monatsbudget liegt ${chf(budget.fehlbetragMonat!)} unter dem berechneten Sparbedarf.`,
      datengrundlage: [
        {
          quelle: "Aktuelles APICalc-Sparszenario",
          details: `${chf(budget.sparbedarfMonat!)}/Monat bei 0 % Zins.`,
        },
        {
          quelle: "Budget-Selbstauskunft",
          details: `${chf(budget.verfuegbarMonat!)}/Monat zusätzlich verfügbar; keine umfassende Tragfähigkeitsprüfung.`,
        },
      ],
      offeneFragen: [
        "Möchtest du ein späteres Pensionierungsalter oder einen niedrigeren Bedarf im Ruhestand vergleichen?",
      ],
      naechsterSchritt:
        "Eine Variante auswählen und erst nach bestätigter Änderung neu berechnen.",
      aktion: {
        label: "Szenarien vergleichen",
        nachricht:
          "Ich möchte mein Pensionierungsziel und Budget aufeinander abstimmen. Hilf mir, eine Variante mit späterer Pensionierung oder niedrigerem Ruhestandsbudget auszuwählen. Ändere keine Angaben ohne meine Bestätigung und erfinde keine Vergleichsergebnisse.",
      },
    });
  if (budget.status === "ausreichend")
    add({
      id: "sparweg-pruefen",
      prioritaet: 3,
      kategorie: "naechster_schritt",
      titel: "Sparweg weiter prüfen",
      begruendung:
        "Der Sparbedarf liegt innerhalb deines angegebenen Budgets. Produkteignung und dauerhafte Tragbarkeit sind damit noch nicht bestätigt.",
      datengrundlage: [
        {
          quelle: "Budgetabgleich anhand Selbstauskunft",
          details: `Sparbedarf ${chf(budget.sparbedarfMonat!)}, Budget ${chf(budget.verfuegbarMonat!)}, verbleibend ${chf(budget.restbudgetMonat!)}, jeweils monatlich.`,
        },
      ],
      offeneFragen: [
        "Welche Anforderungen an Laufzeit, Liquidität und Risiko muss ein späterer Sparweg erfüllen?",
      ],
      naechsterSchritt:
        "Anforderungen klären, bevor eine konkrete Lösung geprüft wird.",
      aktion: {
        label: "Nächsten Schritt vorbereiten",
        nachricht:
          "Welche Anforderungen an Laufzeit, Liquidität und Risiko sollten wir vor der Auswahl eines Sparwegs klären? Gib noch keine konkrete Produktempfehlung oder Prämie an.",
      },
    });
  if (budget.status === "kein_bedarf")
    add({
      id: "pension-annahmen-pruefen",
      prioritaet: 3,
      kategorie: "naechster_schritt",
      titel: "Pensionierungsannahmen überprüfen",
      begruendung:
        "Für das aktuelle Modellziel besteht keine Kapitallücke. Die vereinfachten Annahmen und individuellen Leistungswerte bleiben prüfbedürftig.",
      datengrundlage: [
        {
          quelle: "Aktuelle Pensionierungs-Basisrechnung",
          details:
            "Keine positive Kapitallücke bei den bestätigten Basisannahmen.",
        },
      ],
      offeneFragen: [
        "Sind PK-Werte, gewünschter Lebensstandard und Planungshorizont passend?",
      ],
      naechsterSchritt:
        "Die Grenzen des Modells durchgehen; keine vollständige Absicherung oder Garantie daraus ableiten.",
      aktion: {
        label: "Annahmen ansehen",
        nachricht:
          "Erkläre die Annahmen und Grenzen meiner aktuellen Pensionierungs-Basisrechnung. Welche Angaben sollte ich fachlich bestätigen lassen?",
      },
    });
  if (!pensionAktiv && !risikoAktiv)
    add({
      id: "lebensziel",
      prioritaet: 1,
      kategorie: "grundlagen",
      titel: "Dein wichtigstes Lebensziel festlegen",
      begruendung:
        "Für einen persönlichen Handlungsplan braucht es zunächst dein Anliegen statt einer Produktauswahl.",
      datengrundlage: [
        {
          quelle: "Aktueller Beratungsstand",
          details:
            "Noch keine ausreichende Risiko- oder Pensionierungsgrundlage.",
        },
      ],
      offeneFragen: [
        "Geht es zuerst um Familie, Wohneigentum, Einkommensabsicherung oder Pensionierung?",
      ],
      naechsterSchritt:
        "Ein Anliegen wählen und die dazu passenden Angaben erfassen.",
      aktion: {
        label: "Beratung beginnen",
        nachricht:
          "Hilf mir, mein wichtigstes Vorsorgeanliegen zu bestimmen. Frage mich zuerst nach meiner Lebenssituation und meinen Zielen.",
      },
    });
  return {
    hinweis:
      "Zuerst Grundlagen klären, dann Ziele und Optionen prüfen. Die Reihenfolge folgt festen Backend-Regeln; sie ist keine Produktempfehlung oder bereits ausgeführte Handlung.",
    karten: karten
      .sort(
        (a, b) => a.prioritaet - b.prioritaet || a.id.localeCompare(b.id, "de"),
      )
      .map((k, i) => ({ ...k, reihenfolge: i + 1 })),
  };
}
