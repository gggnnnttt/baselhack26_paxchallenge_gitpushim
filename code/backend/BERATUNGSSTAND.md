# Beratungsstand: Profil, Ablauf und Risikoberechnung

Stand: 31.10.2026. Beschreibt den implementierten ersten Schritt: ein Profil aus dem Gespräch, dessen Daten direkt in `APICalc_calculateRisk` verwendet werden. Zusätzlich implementiert ist die unabhängige Pensionierungs-Basisrechnung (siehe unten). Produkte und Empfehlungslogik sind noch nicht gebaut.

## Ablauf pro Nachricht

```text
lokale Eingabeprüfung → Themenprüfung
  → Profilerfassung (eigener Modellaufruf, strikte JSON-Struktur aus Zod)
  → Backend prüft jeden Vorschlag: Beleg wörtlich in der Nachricht? Ableitung begründet? Wert gültig?
  → Beratungsablauf (XState) auf einer Kopie: Eingaben prüfen, ggf. APICalc rechnen
  → Antwortaufruf mit Systemprompt + Beratungsstand (Profil, vorhanden/fehlend, Grenzen, Ergebnis)
  → Ausgabeprüfung → erst jetzt werden Verlauf, Profil und Berechnung der Sitzung übernommen
```

Das LLM schlägt Profiländerungen nur vor; das Backend entscheidet. Gültiges JSON beweist nicht, dass eine Angabe stimmt. Darum trägt jeder Wert `quelle` (Aussage/Ableitung), ein wörtliches `beleg`-Zitat, bei Ableitungen eine `begruendung` und den Index der Nutzernachricht. Im Panel „Was ich bisher verstanden habe“ sind diese Herkunftsangaben per Tooltip sichtbar.

## Stack

| Baustein | Wozu | Warum |
|---|---|---|
| **Zod 4** (`src/profil/profil.ts`, `aenderungen.ts`, `berechnung/risiko.ts`) | Profilschema, Änderungsvorschläge, APICalc-Request und -Antwort | Eine Quelle für TypeScript-Typen, Laufzeitprüfung und das JSON-Schema der Structured Outputs (`z.toJSONSchema`). |
| **XState 5** (`src/beratung/ablauf.ts`) | Beratungsablauf mit Erfassungsschleife | Explizite Zustände und Übergänge, Guards statt verstreuter `if`s, asynchrone Berechnung als `invoke`, Snapshot pro Sitzung. Später erweiterbar um Empfehlung, Angemessenheitsprüfung, Abschluss und Übergabe an eine Beratungsperson. Visualisierbar mit Stately. |
| Kein LangGraph/LangChain | – | Würde die bestehende modellunabhängige Pipeline und Guardrails ersetzen statt ergänzen. Der Ablauf hier ist deterministisch; das LLM steuert ihn nicht. |

Zustände: `erfassung` (Schleife, solange Angaben fehlen) → `berechnung` → `berechnet`. Ohne APICalc-Zugang: `bereit` (Request fertig, nicht gesendet). Bei Fehler: `fehlgeschlagen` (nächste Nachricht versucht erneut). Ändert sich ein Wert, wird neu geprüft: gleicher Request → Ergebnis bleibt; geänderter vollständiger Request → neue Berechnung; unvollständig → zurück in `erfassung`, altes Ergebnis als **veraltet** markiert.

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

Personenfelder beschreiben nur die heutige Situation. Pläne (`plaene`) haben eigene Felder für Zeitpunkt (Jahr, Monat, Formulierung), künftiges Pensum, künftiges Einkommen und Sicherheit und fliessen **nicht** in die heutige Berechnung ein. Der strukturierte Zeitpunkt ist bewusst so gewählt, dass ein späterer interaktiver Zeitstrahl Pläne platzieren und verschieben kann. Das Modell sieht sie dann über denselben Beratungsstand.

## Offene Punkte, idealerweise mit Pax klären

- Bedeutung von `WithChildren`, von `RelationshipSinceYear` bei Alleinstehenden und ob volljährige Kinder zu zählen sind.
- Welche Annahmen APICalc ohne `Pillar2Pensions` trifft.
- Ob `NeedDeath` einer Person den Bedarf der Hinterbliebenen beim Tod dieser Person meint. Davon gehen wir aus; der Pax-Vorsorgecheck zeigt Bedarf pro Person in % des Einkommens.
- Bestehende private Vorsorge (3. Säule) und weitere Versicherungen sind nicht berücksichtigt. Ein aktuelles Ergebnis bedeutet nicht, dass die gesamte bestehende Absicherung geprüft wurde.
- Eine gespeicherte Berechnungsgrundlage unterstützt Nachvollziehbarkeit, erfüllt aber nicht automatisch das ganze Legal Framework.

## Nächste Schritte

1. APICalc-Token setzen (`APICALC_TOKEN` in `.env`) und das Ergebnis für die Müllers mit dem Pax-Vorsorgecheck vergleichen.
2. Szenarien aus Plänen: Profil-Kopie mit angewendeten Plänen (z. B. Wiedereinstieg 40 %) neu berechnen und klar als Szenario kennzeichnen, nicht als Prognose.
3. Zeitstrahl im Frontend mit eigenem, validiertem Endpunkt für Pläne (gleiche Zod-Schemas, Herkunft „Eingabe im Zeitstrahl“).
4. Altersvorsorge (`calculateRetirement`), bestehende Vorsorge, danach Produktkarten und Empfehlungsgrundlage als weitere Ablaufzustände.

## Pensionierung: implementierte Basisrechnung

`src/berechnung/pensionierung.ts` enthält Request-/Response-Schemas, Eingabeprüfung und einen eigenen Berechnungsstand für `APICalc_calculateRetirement`. Risiko und Pensionierung werden unabhängig geprüft und können bei vollständigen Eingaben parallel berechnet werden. Es gibt weiterhin keine Produktempfehlungen.

Neue Profilfelder:

- Je Person: gewünschtes Pensionierungsalter (technischer Demo-Bereich 50–80, keine gesetzlichen Bezugsgrenzen), erwartete PK-Altersrente in CHF/Jahr und heutiges PK-Guthaben.
- Haushalt: Bedarf im Ruhestand (CHF/Jahr oder Prozent), explizit dafür vorgesehenes privates Vermögen ohne PK-Guthaben und Bestätigung der Basisannahmen.
- Monatsbudgets und monatliche PK-Renten werden mit 12 multipliziert. Kapital ist einmalig, kein Monats-/Jahresbetrag. Fehlende Angaben werden nicht als null interpretiert.
- PK-Anschluss muss ausdrücklich bestätigt werden. Bei aktivem Anschluss sind individuelle PK-Rente und Guthaben nötig; bei Guthaben 0 weist die Anwendung auf die laut API erfolgende Approximation hin. PK-/Freizügigkeitswerte ohne aktiven Anschluss müssen zuerst fachlich geklärt werden.

Bewusster Umfang: `Saving=0`, `InterestRate=0`, `LiveSpan=88`. Die drei Annahmen müssen im Gespräch ausdrücklich akzeptiert werden. Die Einheit von `Saving` ist in der Swagger-Datei nicht erläutert; nicht-null Sparbeiträge und andere Zinsen sind deshalb noch nicht integriert. Das ist eine Basisrechnung zum vorhandenen Vermögen, keine vollständige Sparprognose. Bei einem Änderungswunsch muss die Bestätigung widerrufen werden. Hausbudget und Notreserve dürfen nicht als privates Vorsorgevermögen doppelt gezählt werden.

Die API berechnet Säule 1, verwendet die übermittelte PK-Rente und liefert Einkommen, Vermögensverzehr, Einkommenslücke sowie Kapitalwerte beim ersten Rentenfall. Individueller AHV-Beitragsverlauf, Inflation, Steuern und Bezugsregeln konkreter 3a-Verträge sind nicht erfasst. Bezugsalter der eingegebenen PK-Rente und Behandlung verschiedener Pensionierungsalter müssen mit Pax/Logismata bestätigt werden. Ein fachlicher Fehlercode ist kein Ergebnis; eine unvollständige Erfolgsantwort wird zurückgewiesen.

### Lokaler Verbindungstest ohne KI

Im Backend-Verzeichnis:

```bash
npm run test:pensionierung
```

Der Test nutzt den vorhandenen `APICALC_TOKEN` und optional `APICALC_TENANT` aus der lokalen `.env`. Er sendet ausschließlich den in `scripts/test-pensionierung.ts` sichtbaren synthetischen Einpersonenfall. Token und Header werden nicht ausgegeben. **Dieser Befehl ruft die echte API auf.** Dagegen verwenden `npm test` und der Backend-Typecheck keine externen Dienste.

Am 31.10.2026 erfolgreich gegen den Hackathon-Dienst geprüft: Mann, Jahrgang 1990, Bruttoeinkommen CHF 100’000/Jahr, Pensionierungsalter 65, PK-Rente CHF 30’000/Jahr, PK-Guthaben CHF 120’000, privates Vorsorgevermögen CHF 50’000, Bedarf CHF 60’000/Jahr, Basisannahmen wie oben. Antwort: ErrorCode 1, Renteneinkommen CHF 62’760, davon Säule 1 CHF 32’760 und Säule 2 CHF 30’000, Einkommenslücke 0. Das ist ein technischer Smoke-Test, keine fachliche Freigabe.

### Test im Chat

Backend neu starten, Seite neu laden und eine neue Sitzung beginnen. Ausschließlich erfundene Angaben verwenden:

> Ich bin ledig, männlich, Jahrgang 1990 und als Angestellter bei einer Pensionskasse versichert. Mein Bruttojahreseinkommen beträgt CHF 100’000. Ich möchte mit 65 in Pension gehen. Meine erwartete PK-Altersrente beträgt CHF 30’000 pro Jahr und mein aktuelles PK-Guthaben CHF 120’000. Zusätzlich sind CHF 50’000 meines heutigen privaten Vermögens ausdrücklich für die Pensionierung vorgesehen, ohne PK-Guthaben, Hausbudget und Notreserve. Im Ruhestand benötige ich CHF 60’000 pro Jahr. Für diese Basisrechnung akzeptiere ich ausdrücklich keine weiteren Sparbeiträge, 0 % Verzinsung und eine Planung bis Alter 88.

Im Panel erscheint ein eigener Abschnitt „Pensionierung · Basisrechnung“. Er zeigt fehlende Angaben, Annahmen, API-Fehler oder ein aktuelles Ergebnis. Risikoangaben müssen dafür nicht vervollständigt werden. Danach z. B. „Ich möchte doch erst mit 66 in Pension gehen“: Der neue Request muss das geänderte Alter enthalten; ob Zahlen sich ändern, entscheidet das API-Modell.

### Verifikation

37 lokale Tests bestehen, einschließlich Pensionierungs-Mapping, Monats-/Jahresumrechnung, ausdrücklicher Nullwerte, fehlender Bestätigung, Paare, veralteter Ergebnisse, fachlicher Fehlercodes und unabhängigem Risiko-/Pensionierungsablauf. Backend-Typecheck und Angular-Produktionsbuild erfolgreich. Der Chatpfad wurde zusätzlich mit dem oben genannten synthetischen Text gegen das laufende Backend, die echte KI und APICalc geprüft: Ergebnis vorhanden, keine fehlenden Angaben, keine abgelehnten Profiländerungen. Die Testsitzung wurde anschließend gelöscht. Ein beobachteter Aussetzer bei der Übernahme der ausdrücklich bestätigten Basisannahmen wird durch einen engen lokalen Erkenner des vollständigen Bestätigungssatzes abgefangen; Nennungen, Fragen, unvollständige Annahmen und spätere Einschränkungen gelten darüber nicht als Zustimmung. Dafür gibt es Regressionstests.
