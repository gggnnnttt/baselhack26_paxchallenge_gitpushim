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

## Zusätzlicher Sparbedarf aus der Pensionierungs-Kapitallücke

`src/berechnung/sparen.ts` leitet nach einer aktuellen erfolgreichen Pensionierungsrechnung ein zusätzliches Sparszenario ab. Die Basisrechnung selbst wird nicht verändert. `APICalc_calculateSaving` wird mit `SavingGoal=2` (periodische Einzahlung bestimmen), `InvestmentMonthly=true`, `InterestRate=0`, `InitialInvestment=0` und `EndCapital=CapitalGap` aufgerufen. Das bereits in der Kapitallücke angerechnete private Vermögen wird nicht doppelt verwendet.

Die Spardauer ist eine Näherung in ganzen Jahren: `min(BirthYear + DesiredRetirementAge) - Berechnungsjahr`, bei Paaren bis zum ersten Rentenfall. Geburtsmonate/-tage fehlen; es ist kein taggenauer Sparplan. Keine positive Kapitallücke: kein API-Aufruf und keine pauschale Entwarnung für die Gesamtvorsorge. Kein verbleibendes volles Jahr: kein ableitbarer monatlicher Sparplan. Fehlende, fehlerhafte oder veraltete Pensionierungsergebnisse löschen den sichtbaren Sparbetrag. Unveränderte Grundlagen verwenden das bestehende Ergebnis; Änderungen berechnen neu. Der gesamte Stand wird weiterhin erst mit einer akzeptierten Chatantwort übernommen.

Der Sparrechner rundet im geprüften Live-Fall die Monatsrate auf ganze CHF. Die Anwendung prüft bei 0 % Zins die Konsistenz zwischen Rate, Einzahlungen und Endkapital. Bis zu CHF 1 zusätzliche Einzahlung pro Monat wird als Rundung akzeptiert. Unterdeckung von mehr als CHF 1 insgesamt oder inkonsistente Werte werden zurückgewiesen. Sichtbar sind der API-Sparbetrag sowie das tatsächliche Endkapital. Keine eigenen Ersatzwerte bei Fehlern.

Live-Test am 31.10.2026: synthetischer Einpersonenfall wie oben, jedoch CHF 70’000 jährlicher Bedarf. Pensionierungs-Kapitallücke CHF 116’530, Zieljahr 2055, 29 Jahre. APICalc liefert CHF 335 monatlich, Einzahlungen und Endkapital CHF 116’580, Zinsen CHF 0. Die zusätzliche Monatsrate ist keine Versicherungsprämie; Budget-Tragbarkeit, Produkte, Kosten, Steuern und Inflation sind nicht geprüft. `IncomeTotal` enthält in diesen API-Fällen den Vermögensverzehr bereits; die Oberfläche nennt den Wert deshalb „Gesamte verfügbare Einnahmen“.

Direkter Verbindungstest im Backend-Verzeichnis (echte API, ausschließlich synthetische Daten, keine KI):

```bash
npm run test:sparen
```

Lokale Prüfung: 45 Tests und Backend-Typecheck erfolgreich; Angular-Produktionsbuild erfolgreich. Zusätzliche Tests prüfen positive/fehlende Kapitallücke, Rundung, keine doppelte Vermögensanrechnung, ersten Rentenfall bei Paaren, ungültige Antworten, Ablauf ohne Sparzeit, Cache und veraltete Grundlagen.

Im Chat: nach Backend-Neustart denselben synthetischen Pensionierungsfall mit CHF 70’000 Jahresbedarf verwenden. Im Panel erscheint „Zusätzlicher Sparbedarf bis zur Pensionierung“. Bei CHF 60’000 Bedarf ist in diesem Beispiel keine Kapitallücke und damit kein zusätzlicher Sparbedarf für dieses Modellziel vorhanden.

Der vollständige Chatpfad wurde anschließend mit dem synthetischen CHF-70’000-Fall gegen das laufende Backend, die echte KI und beide APICalc-Rechner erfolgreich geprüft: Pensionierung und Sparen jeweils `berechnet`, Monatsrate CHF 335 und korrekte Erklärung im Chat. Die Testsitzung wurde danach gelöscht.

## Bestehende private Erwerbsunfähigkeitsrente: Datenweg und Entwicklungsentscheidungen

Umgesetzt ist ein vorhandener privater EU-Rentenvertrag je versicherter Person. Mehrere Verträge, Taggeld, Todesfallkapital und eine automatische Vertragsprüfung sind nicht Teil dieser Version.

### 1. Datenmodell statt Prompt allein

`src/profil/profil.ts` enthält `PrivateEu` als optionalen Teil jeder Person: vorhanden, Jahresrente, Ursache (Krankheit/Unfall/beides), Wartefrist in Monaten, Alter bei Leistungsende, Bestätigung einer zusätzlichen Auszahlung ohne Verrechnung/Kürzung und mehrere Verträge ja/nein. Alle Werte verwenden die vorhandenen Herkunftsangaben (Zitat, Nachricht, Aussage/Ableitung). Nicht erfasst bedeutet unbekannt und nicht automatisch nein oder CHF 0.

### 2. Erfassung und Prüfung trennen

`src/profil/extraktion.ts` erklärt dem Modell, welche Vertragsangabe in welches Änderungsfeld gehört. Keine Gesundheitsangaben oder Policennummern erfassen. Die versicherte Person ist entscheidend, nicht der Prämienzahler. Mehrere Renten nicht in einem Feld zusammenzählen.

`src/profil/aenderungen.ts` definiert die neuen Änderungsarten und prüft Einheiten, Werte und Beleg. CHF 1’000 pro Monat werden zu CHF 12’000 pro Jahr. Prozentwerte als Rentenbetrag und negative Wartefristen werden abgelehnt. Bei einer Kündigung (`vorhanden=false`) werden die alten Vertragswerte entfernt, damit sie bei einer späteren anderen Police nicht unbemerkt wiederverwendet werden. Korrektur und Widerruf einzelner Felder sind unterstützt.

### 3. Fachliche Regel als reine Funktion

`src/berechnung/private-eu.ts` berechnet den Zusatzvergleich ohne Netzwerkaufruf. Nur aktuelle erfolgreiche EU-Szenarien 1/2/5/6 werden nach Person und Ursache zugeordnet. Todesfall-Szenarien bleiben unverändert. Erst nach vollständigen Angaben, bestätigter zusätzlicher Auszahlung und genau einem Vertrag wird eine Jahreslücke während der Leistungsphase modelliert:

```text
Restlücke ab Leistungsbeginn = max(0, ursprüngliche API-Jahreslücke − deklarierte private Jahresrente)
```

Beispiel mit erfundenen Zahlen: CHF 15’000 API-Lücke, CHF 12’000 private Jahresrente → CHF 3’000 Restlücke ab Leistungsbeginn. Bei sechs Monaten Wartefrist gilt dieser reduzierte Jahresbetrag erst nach diesen sechs Monaten, nicht rückwirkend und nicht als Durchschnitt des ersten Jahres. Nach Leistungsende gilt die ursprüngliche API-Lücke unter sonst gleichen Annahmen wieder. Nahe am Leistungsende blockiert die Anwendung den Vergleich, weil nur Jahrgänge und keine genauen Geburtstage erfasst sind.

Es wird weder eine kapitalisierte Restlücke berechnet noch `CapitalGap` verändert. Eine Kundenaussage zur zusätzlichen Auszahlung ist kein geprüfter vertraglicher Leistungsanspruch. Sind Verrechnung, mehrere Verträge oder andere Bedingungen unklar, ist fachliche Prüfung nötig.

### 4. Integration über einen abgeleiteten Stand

`src/beratung/darstellung.ts` erzeugt `privateEu` für Frontend und Modellkontext aus dem aktuellen Profil und dem aktuellen Risikoergebnis. Der bestehende Chatablauf übernimmt Änderungen weiterhin erst nach akzeptierter Antwort. Änderungen nur an der privaten Rente benötigen keinen neuen APICalc-Aufruf: Der ursprüngliche API-Request bleibt gleich, der Zusatzvergleich wird neu abgeleitet. Bei veralteten Risikoergebnissen werden keine alten privaten Restlücken angezeigt.

`apicalc.ts`, `server.ts` und die Ablaufmaschine benötigen für dieses Feature keine neue API-Methode oder Route. Die privaten Vertragsangaben werden nicht an APICalc gesendet.

### 5. Oberfläche und KI erklären denselben Stand

Im Frontend spiegeln `beratungsstand.model.ts` die neuen Typen und `beratungsstand.ts` die Profilangaben. `beratungsstand.html` zeigt einen getrennten Abschnitt mit Original-Lücke, deklarierter privater Rente, dem zur Lückendeckung verwendeten Teil und der Restlücke ab Leistungsbeginn. Wartefrist, Endalter und offene Fragen bleiben sichtbar. Der ursprüngliche API-Ergebnisblock bleibt unverändert.

`advisor.instructions.md` erklärt, dass der Zusatzvergleich vom Backend stammt, nicht von APICalc, und zeitlich begrenzt ist. Der Datenschutzhinweis beschreibt die Übertragung der Profilangaben an den Modellanbieter.

### 6. Prüfen statt nur den Erfolgsfall zeigen

`test/private-eu.test.ts` prüft Zuordnung nach Person/Ursache, keine Anrechnung im Todesfall, Wartefrist/Endalter, fehlende Angaben, Verrechnung, mehrere Verträge, Nullwerte, überdeckte Lücken, Monatsumrechnung, Korrektur, Kündigung, Widerruf und veraltete Ergebnisse. Ein Chat-Integrationstest belegt, dass kein zusätzlicher Risiko-API-Aufruf nötig ist und blockierte Antworten keine neuen privaten Angaben speichern. Insgesamt 52 Tests und Backend-Typecheck erfolgreich; Frontend-Produktionsbuild erfolgreich.

### Test im Chat

Backend neu starten und eine neue Sitzung mit einem synthetischen Risikohaushalt beginnen. Erst den bisherigen Risiko-Testfall vollständig erfassen. Danach:

> Ich habe genau einen bestehenden privaten Erwerbsunfähigkeitsrentenvertrag. Versichert bin ich selbst. Er zahlt CHF 1’000 pro Monat bei Krankheit und Unfall nach 6 Monaten Wartefrist bis zu meinem Alter 65. Ich bestätige, dass diese Rente zusätzlich zu den gesetzlichen und PK-Leistungen ohne Verrechnung oder Kürzung dieser Leistungen ausgezahlt wird.

Erwartung: Person A erhält eine deklarierte private Jahresrente CHF 12’000. Für Krankheit und Unfall wird bei vollständigen Angaben die Restlücke ab Leistungsbeginn separat angezeigt. Person B und Todesfallwerte bleiben unverändert. Danach „Korrektur: Meine private EU-Rente beträgt CHF 1’500 pro Monat. Die übrigen Bedingungen bleiben gleich.“ → Jahresrente CHF 18’000 und neuer Vergleich ohne neuen APICalc-Aufruf. Danach „Ich bin nicht sicher, ob die private EU-Rente zusätzlich ohne Verrechnung ausgezahlt wird.“ → offene Klärung statt eines weiter angezeigten reduzierten Restlückenbetrags.

API-Verhalten im privaten EU-Vergleich: Die echte Risiko-API liefert im geprüften synthetischen Fall ErrorCode 0 für erfolgreiche Szenarien, während Swagger v1.2 dafür 1 nennt. Der Vergleich akzeptiert 0 und 1 mit einer gültigen nichtnegativen Einkommenslücke; andere oder fehlende Codes werden nicht angerechnet. Ein Regressionstest deckt diese Abweichung ab.

Der vollständige Chat-Service wurde nach dieser Korrektur mit echter KI und APICalc anhand eines synthetischen ledigen Mannes (1990, CHF 100’000 Bruttojahreseinkommen, Risiko-Bedarf 80 %/70 %) erfolgreich geprüft. Die nachträglich erfasste private Rente CHF 1’000/Monat, Krankheit und Unfall, sechs Monate Wartefrist bis Alter 65 wurde ohne abgelehnte Profiländerungen übernommen. Krankheit: API-Lücke CHF 30’724/Jahr, private Jahresrente CHF 12’000, modellierte Restlücke CHF 18’724/Jahr ab Leistungsbeginn. Unfall: API-Lücke bereits null, keine negative Restlücke. Testsitzung anschließend gelöscht.
