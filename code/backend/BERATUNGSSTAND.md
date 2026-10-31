# Beratungsstand: Planer, Gesprächsführer und Berechnungen

Stand: 31.10.2026. Implementiert sind das Haushaltsprofil, ein Beratungsplan pro Sitzung, Risiko- und Pensionierungsberechnungen über APICalc, Familienszenarien und eine lokale Eigenheimrechnung. Die Empfehlungsgrundlage erlaubt die Vorbereitung von Lösungsklassen; geprüfte Produktdaten, Offerten und Vertragsabschluss sind nicht angeschlossen.

## Ablauf pro Nachricht

```text
lokale Eingabeprüfung
  → parallel: Themenprüfung + Planer (vorhandener Profilerfassungs-Aufruf)
  → nur bei erlaubtem Thema: Änderungsvorschläge anhand von Belegen und Wertebereichen prüfen
  → XState bewertet das aktualisierte Profil und prüft den vorgeschlagenen Schritt
  → bei erlaubtem Berechnungsauftrag: genau die gewählte Rechnung ausführen, Stand neu bewerten
  → Gesprächsführer erhält aktuellen Verlauf, kompaktes Profil, geprüften Schritt und ausgewählte Ergebnisse
  → lokale Ausgabeprüfung
  → erst bei Erfolg: Verlauf, Profil, akzeptierten Plan und Ergebnisse gemeinsam übernehmen
```

Ein API-Key und ein konfiguriertes Modell reichen. Es gibt zwei Rollen mit getrennten Anweisungen und zusätzlich die bestehende Themenprüfung: normalerweise drei Modellaufrufe, davon zwei parallel. Auch abgelehnte Themen erreichen bereits Themenprüfung und Planer. Keine zusätzliche AI-Library wurde eingeführt.

## Zuständigkeiten

- **Planer** (`src/profil/extraktion.ts`): schlägt belegte Profiländerungen, den Kundenwunsch und einen Plan vor. Er sieht die letzten sechs Nachrichten, das Profil, Themen, offene Punkte, Rechnungsstatus, die Empfehlungsgrundlage und den letzten akzeptierten Plan. Der alte Plan ist ein Vorschlag, keine Kundenangabe; geänderte Ziele müssen neu bewertet werden.
- **Zod** (`src/beratung/plan.ts`): begrenzt die Planstruktur. Gültiges JSON belegt keine fachliche Richtigkeit. Profilwerte behalten Aussage/Ableitung, Beleg, Begründung und Nachrichtenindex.
- **XState** (`src/beratung/ablauf.ts`): prüft Anliegen- und Rechnungskennungen sowie aktuelle Voraussetzungen. Eine Empfehlung braucht die bestehende Empfehlungsgrundlage; eine Rückfrage braucht eine Frage; eine Berechnung braucht vollständige Eingaben und einen verfügbaren Rechner; das Zeigen braucht ein aktuelles Ergebnis.
- **Gesprächsführer** (`advisor.instructions.md`): beantwortet das aktuelle Anliegen in der Regel in zwei bis vier kurzen Sätzen, mit höchstens einer zentralen Rückfrage. Er sieht keine vollständigen Fehllisten und keine unbeteiligten Berechnungsergebnisse.

`szenario_berechnen` ist ein Planungsauftrag; nach erfolgreicher Berechnung lautet die sichtbare Aktion `szenario_zeigen`. Ein unveränderter Request verwendet das vorhandene Ergebnis. Veränderte oder entfernte Eingaben machen frühere Ergebnisse unbrauchbar, bis erneut gerechnet wurde. Fehlgeschlagene Berechnungen können in einer Folgerunde erneut angefordert werden.

Bei einem ungültigen Plan übernimmt die bisherige deterministische Schrittwahl und protokolliert den Ablehnungsgrund. Der ungültige Plan wird nicht als Gedächtnis gespeichert. Bei `plan: null` bleibt auch die bisherige automatische Berechnung vollständiger, geänderter Requests als Fallback erhalten. Ein Wunsch nach menschlicher Beratung startet keine Berechnungen. `quelle: planer | fallback` ist Diagnoseinformation, kein zusätzlicher Kundendialog.

Themenablehnung oder blockierte Ausgabe übernehmen weder Profil noch Plan. Nach einer Löschung wird vor nachfolgenden Schritten geprüft, ob die Sitzung noch existiert. Bereits laufende externe Aufrufe werden dadurch nicht rückgängig gemacht. Datenschutz und Grenzen: [DATENSCHUTZ.md](../DATENSCHUTZ.md).

## Abbildung Profil → `calculateRisk` (APICalc-Swagger v1.2)

| API-Feld | Aus dem Profil | Regel |
|---|---|---|
| `Relationship` | `haushalt.beziehung` | ledig/geschieden/verwitwet → 1, verheiratet → 2, Konkubinat → 3, eingetragene Partnerschaft → 4 |
| `RelationshipSinceYear` | `haushalt.beziehungSeitJahr` | Pflicht bei Paaren. Für Alleinstehende verlangt, aber undokumentiert → aktuelles Jahr, mit Hinweis |
| `Person1` / `Person2` | `personen.A` (schreibende Person) / `personen.B` | `Person2` nur bei Paarbeziehung |
| `Sex`, `BirthYear` | `geschlecht`, `geburtsjahr` | Pflicht; Geschlecht wird nie aus Namen geraten |
| `GrossIncome` | `einkommen` | nur brutto; Monatsbetrag × 12/13 nur bei bekannter Anzahl Monatslöhne; nicht erwerbstätig → 0 |
| `WithBVG` | `bvgVersichert` | nicht erwerbstätig → `false` (vom Backend abgeleitet, mit Hinweis); sonst Angabe nötig |
| `NeedInPc*`, `Need*` | `bedarfInvaliditaet`, `bedarfTodesfall` | Prozent des heutigen Einkommens oder CHF/Jahr; bei Erwerbstätigen Pflicht, bei Einkommen 0 optional mit Hinweis |
| `NumberOfChildren` (Request) | Kinder mit Elternteil „beide“ | „gemeinsame Kinder“ |
| `PersonX.NumberOfChildren` | Kinder nur einer Person mit alleinigem Sorgerecht | sonst nicht zählbar → Hinweis |
| `WithChildren` | abgeleitet: mindestens ein gezähltes Kind | undokumentiert → Hinweis |
| `Pillar2Pensions` | – | nicht gesetzt; Vorsorgeausweis-Werte werden noch nicht erfasst |

Die Liste „noch fehlend“ ist eine interne Rechenhilfe für den Advisor, keine vorgeschriebene Fragenreihenfolge. Jede Lücke enthält ein „warum“, damit das Modell den Zweck einer Frage erklären kann.

## Heute und Zukunft

Personenfelder beschreiben die heutige Situation. Pläne haben getrennte Felder für Zeitpunkt, Pensum, Einkommen und Sicherheit. Familienszenarien verändern eine Profilkopie und nennen ihre Annahmen; sie sind keine Prognose und keine vollständige Simulation aller zukünftigen Zeitphasen.

## Offene Punkte

- APICalc-Annahmen ohne `Pillar2Pensions`, `WithChildren` und das Beziehungsjahr bei Alleinstehenden fachlich mit Pax abgleichen.
- Private Deckungen werden in der Empfehlungsgrundlage berücksichtigt; Laufzeiten, Wartezeiten und Deckungsbedingungen sind noch nicht geprüft. Guthaben in 3a sind keine gesonderte Risikoversicherung.
- Neue Planer-Prompts wurden lokal mit simulierten Modellantworten geprüft. Natürlichkeit, korrekte Extraktion und fachliche Qualität müssen mit synthetischen Live-Gesprächen bewertet werden.
- Nächste Produktarbeit: geprüfte Produktkarten und ein Zeitstrahl mit validierten Planänderungen. Ein strukturierter Beratungsstand allein beweist keine rechtliche Konformität.
