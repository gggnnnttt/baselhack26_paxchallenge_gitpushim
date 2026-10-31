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

## Kleiner Budgetabgleich nach dem Sparbedarf

`src/berechnung/budget.ts` vergleicht den aktuellen zusätzlichen monatlichen Sparbedarf mit einer Selbstauskunft zum zusätzlich verfügbaren Haushaltsbudget für die Pensionierung. Keine neue API-Anfrage. Der Vergleich wird in `darstellung.ts` für Frontend und Modellkontext jedes Mal frisch abgeleitet.

Neues Haushaltsfeld `budgetPensionierungMonat` mit den üblichen Herkunftsdaten. `profil.ts` definiert den Wert, `aenderungen.ts` validiert Beleg und Monat/Jahr-Einheit (Jahresbudget geteilt durch 12, Rundung auf Rappen); negative Werte, Prozentangaben und eine Zuordnung nur zu Person A/B werden abgelehnt. Ausdrückliches CHF 0 ist gültig. `extraktion.ts` beschreibt die Zweckbindung: zusätzlich nach laufenden Ausgaben, vorhandenen Sparverpflichtungen und einer Reserve. Einkommen, Kapital und bereits gebundene Sparbeiträge dürfen nicht als freies Budget übernommen werden. Unsicherheit/Widerruf entfernt den Wert.

Zustände:

- `wartet`: kein aktueller Sparbetrag, kein gültiger Budgetvergleich und keine Budgetfrage erzwingen.
- `offen`: Sparbetrag bekannt, Budget fehlt; gezielte Rückfrage im Chat.
- `ausreichend`: Sparbedarf liegt innerhalb des angegebenen Budgets. Keine umfassende Tragfähigkeitsprüfung.
- `unterdeckung`: Differenz als monatlichen Fehlbetrag anzeigen, Szenariovergleich anbieten, keine Annahmen automatisch ändern.
- `kein_bedarf`: keine Kapitallücke für dieses Modellziel, daraus keine allgemeine Entwarnung ableiten.

Beispiel: Sparbedarf CHF 335, Budget CHF 250 → Fehlbetrag CHF 85/Monat. Budget CHF 400 → verbleibendes angegebenes Monatsbudget CHF 65. Budget CHF 335 → exakte Deckung. Fehlendes Budget ist nicht null. Der Vergleich arbeitet in Rappen und verändert weder die ursprüngliche Pensionierungsrechnung noch Vermögen, angenommene Sparbeiträge oder den API-Sparbetrag.

Die UI zeigt einen eigenen Abschnitt „Budgetabgleich · Selbstauskunft“ und das Budget im Haushaltsprofil. Der Berater fragt bei unbekanntem Budget nach einem aktuellen Sparergebnis nach dem zusätzlichen Monatsbetrag. Bei bekanntem Budget fragt er nicht erneut. Das ist kein vollständiges Haushaltsbuch und keine Produkt-Eignungsprüfung.

Test: Nach dem synthetischen Pensionierungsfall mit CHF 70’000 Jahresbedarf erscheint die Budgetfrage. Antworten:

> Nach meinen laufenden Ausgaben, bestehenden Sparverpflichtungen und einer Reserve kann ich zusätzlich CHF 250 pro Monat für die Pensionierung zurücklegen.

Erwartung: CHF 335 Sparbedarf, CHF 250 Budget, CHF 85 Fehlbetrag. Danach „Korrektur: Zusätzlich verfügbar sind CHF 400 im Monat für die Pensionierung“ → innerhalb des angegebenen Budgets, CHF 65 verbleiben. Danach „Ich bin mir nicht mehr sicher, wie viel zusätzlich verfügbar ist“ → kein gültiger Vergleich mehr. Für reine Budgetkorrekturen wird weder Pensionierungs- noch Spar-API erneut aufgerufen.

`test/budget.test.ts` prüft Betrag/equal/Unterdeckung, CHF 0, unbekannte Angaben, veralteten Sparstand, Rappen, Jahresumrechnung, ungültige Eingaben und den Chat-Datenweg samt Korrektur, Widerruf und dem Fall ohne Kapitallücke. 57 lokale Tests und Backend-Typecheck erfolgreich.

Der vollständige Chat-Service wurde mit echter KI und APICalc anhand des synthetischen CHF-70’000-Pensionierungsfalls erfolgreich geprüft. Nach dem Sparergebnis CHF 335/Monat fragte die KI nach dem zusätzlichen Monatsbudget. Die Antwort CHF 250/Monat wurde ohne abgelehnte Änderungen übernommen, das Backend wies CHF 85/Monat Unterdeckung aus, und die KI bot einen Szenariovergleich an. Testsitzung anschließend gelöscht. Frontend-Produktionsbuild erfolgreich.

## Regelbasierter Handlungsplan

`src/beratung/handlungsplan.ts` erzeugt aus dem aktuellen Beratungsstand strukturierte Karten mit stabiler Regel-ID, Reihenfolge, Priorität, Kategorie, Begründung, Datengrundlage, offenen Fragen, nächstem Schritt und einem Nachrichtenvorschlag. Die Funktion ist deterministisch und verändert weder Profil noch Ergebnisse. Keine weitere KI-/API-Anfrage nötig. Die Karten werden bei jeder akzeptierten Antwort neu abgeleitet und nicht als erledigte externe Vorgänge gespeichert.

Prioritäten sind Abhängigkeiten im Beratungsablauf: 1 = Grundlagen und Unklarheiten klären, 2 = Lücken/Ziele planen, 3 = nächste Schritte prüfen. Innerhalb einer Gruppe gilt eine feste stabile Sortierung nach Regel-ID. Es ist keine allgemeine finanzielle Dringlichkeitsbewertung. Unabhängige Risiko- und Pensionierungszweige bleiben bearbeitbar.

Regeln unter anderem: fehlende PK-Alterswerte, fehlende Risiko-/Pensionierungsgrundlagen, nicht verfügbare Berechnung, ungeklärte private EU-Rente, noch unbekannte bestehende EU-Absicherung bei positiver API-Lücke, abgegrenzt verbleibende EU-Lücke, ungeprüfte Hinterbliebenensituation, fehlende Budget-Selbstauskunft, Unterdeckung des Sparbedarfs, nächster Sparweg bei ausreichendem Budget und Prüfung der Basisannahmen ohne Kapitallücke. Keine Produktauswahl, Prämie oder Vertragsaktion wird vorgetäuscht.

`darstellung.ts` liefert denselben Plan an Frontend und Modellkontext. Die KI soll die gelieferten Karten erklären, nicht Prioritäten erfinden. Der bestehende Chat-Commit bleibt die Grenze: blockierte Antworten übernehmen keine neuen Angaben oder Karten.

Im Frontend steht „Dein nächster Schritt“ oben im Beratungspanel; Profil und Berechnungen sind darunter aufklappbar. Jede Karte bietet „Warum dieser Schritt?“ mit Datenbasis und offenen Fragen. Ein Kartenbutton übergibt über ein Angular-Output einen Nachrichtenvorschlag an die App. Die App füllt nur das Eingabefeld; erst der Nutzer sendet. Während einer laufenden Antwort sind Buttons deaktiviert. Es werden keine Versicherer angeschrieben, Szenarien automatisch geändert oder Übergaben ausgeführt.

`test/handlungsplan.test.ts` prüft leeres Profil, PK-Lücken, unveränderte Quellen, deterministische Reihenfolge, Budgetkorrekturen/Widerruf, Vertragsklärung vor Planung, begrenzte EU-Restlücken, veraltete Werte, API-Ausfall und identische Karten im Modell- und Frontend-Stand. 64 lokale Tests und Backend-Typecheck erfolgreich.

### Demo für einen dreiminütigen Pitch

Vorher den synthetischen Einpersonen-Pensionierungsfall (1990, CHF 100’000 Einkommen, Alter 65, PK-Rente CHF 30’000/Jahr, PK-Guthaben CHF 120’000, privates Kapital CHF 50’000, Ruhestandsbedarf CHF 70’000, bestätigte Basisannahmen) mit zusätzlich verfügbarem Budget CHF 250/Monat in einer eigenen Testsitzung vorbereiten. Keine langen Eingaben oder vollständigen Rechenlisten live vorlesen. Der vorbereitete Chat ist eine reale berechnete Demo mit erfundenen Daten.

- 0:00–0:25: Problem und Kunde: „Ich weiß nicht, ob meine Pensionierungspläne und mein Budget zusammenpassen.“
- 0:25–1:00: Ergebnis kurz zeigen: Kapitallücke CHF 116’530, Sparbedarf CHF 335/Monat, Budget CHF 250. Keine Produktwerbung.
- 1:00–1:40: Karte „Pensionierungsziel und Budget abstimmen“ zeigen. „Warum dieser Schritt?“ öffnen: Differenz CHF 85, Datenquellen, offene Entscheidung. Satz: „Aus einer Zahl wird ein begründeter nächster Schritt.“
- 1:40–2:10: „Szenarien vergleichen“ klicken. Zeigen, dass nur eine prüfbare Nachricht vorbereitet wird. Für eine kurze vorab geprobte Live-Änderung den Vorschlag ersetzen durch: „Korrektur: Für die Pensionierung sind zusätzlich CHF 400 pro Monat verfügbar. Alle anderen Angaben bleiben gleich.“ Anschließend selbst senden. Während der Antwort erklären, dass die Regeln im Backend und die Berechnungen bei Logismata liegen.
- 2:10–2:40: Die alte Unterdeckungskarte ist verschwunden, „Sparweg weiter prüfen“ erscheint. Datenbasis: CHF 335 Sparbedarf, CHF 400 Budget, CHF 65 verbleiben. Das ist eine Budgetkorrektur, kein Beleg eines neuen Einkommens oder einer vollständig geprüften Tragbarkeit.
- 2:40–3:00: Nutzen und Grenzen: „Die KI erklärt. Berechnungen und nachvollziehbare Regeln führen den Plan. Bei Unsicherheit klären wir zuerst die Grundlagen.“ Produktempfehlung, Antrag und Police sind noch weitere Entwicklungsschritte, kein bereits fertiger End-to-End-Abschluss.

Für die Live-Demo ist die Antwortzeit vorab zu proben. Zusätzlich Screenshots oder einen kurzen Mitschnitt des tatsächlichen synthetischen Ablaufs bereithalten; einen Fallback sichtbar als Aufzeichnung kennzeichnen.

Der Browser-Test mit echter KI/APICalc ist erfolgreich: Bei CHF 250 Budget erscheint „Pensionierungsziel und Budget abstimmen“ mit CHF 85 Differenz. Der Button „Szenarien vergleichen“ füllt nur die Eingabe; es wird nicht automatisch gesendet. Nach ausdrücklich gesendeter Korrektur auf CHF 400 verschwindet die Unterdeckungskarte und „Sparweg weiter prüfen“ erscheint mit CHF 65 verbleibendem angegebenem Monatsbudget. Die Quellen und offenen Fragen sind über „Warum dieser Schritt?“ sichtbar. Frontend-Produktionsbuild erfolgreich.

## Begründete Pax-EU-Produktzuordnung (erste Produktfamilie)

`src/produkte/katalog.ts` enthält einen kuratierten Datensatz der Pax Erwerbsunfähigkeitsversicherung: Name, Zweck, kurze öffentliche Beschreibung, offizieller Quellenlink und Quellenstand 31.10.2026. Es werden keine Beispielofferten als Tarif verwendet. Es gibt keine persönlichen Preise, neue Versicherungssummen oder Annahmezusagen. Die öffentliche Beschreibung wurde mit der offiziellen Pax-Produktseite abgeglichen; eine individuelle Eignungsprüfung oder Freigabe durch Pax ist damit nicht erfolgt.

`src/produkte/zuordnung.ts` ordnet einen aktuellen abgegrenzten EU-Bedarf diesem Produkt als Möglichkeit zur Prüfung zu. Jeder Fall ist über stabile ID, Person, Ursache und Regelversion `eu-pruefkandidat-v1` nachvollziehbar. Status: `pruefkandidat`, `abklaerung`, `kein_zusaetzlicher_bedarf` oder `nicht_bereit`. Nur `pruefkandidat` enthält ein Produktobjekt. Fehlende oder veraltete Risikoergebnisse liefern keine Fälle mit Produkt; unbekannte/fehlerhafte Szenarien, nicht erfasster Bedarf oder ungeklärte private Absicherung werden nicht als geklärter Bedarf behandelt.

Eine private EU-Rente wird anhand des vorhandenen getrennten Modellvergleichs berücksichtigt. Nach vollständiger Klärung und positiver jährlicher Restlücke entsteht ein Prüfkandidat. Bei ausdrücklich keiner privaten EU-Rente wird die ursprüngliche positive API-Lücke als noch zu prüfender Bedarfsbereich verwendet. Bei ausgeschlossener Ursache werden nur vollständige abgegrenzte Vertragsangaben verwendet. Mehrere Verträge, unsichere Verrechnung und unvollständige Daten führen zur Abklärung. Positive Lücken von Person A lösen keine Zuordnung für Person B oder Todesfall aus.

Eine Restlücke während bestehender Rentenleistung gilt ausschließlich nach der Wartefrist und während der bestehenden Leistungsdauer. Die Karte zeigt diese Grenzen und fordert die Prüfung der Zeit davor/danach. Ist die Lücke nur während der Rentenleistung null, bleibt eine zeitliche Abklärung statt pauschaler Entwarnung. Die Restlücke wird nicht automatisch in eine empfohlene neue Versicherungssumme umgewandelt. Das Pensionierungsbudget ist kein Budget für eine EU-Prämie. Individuelle PK-Risikoleistungen, Koordination, Wartefrist, Dauer, Annahmebedingungen und konkrete Prämie bleiben offen; Gesundheitsprüfung außerhalb des Chats.

`darstellung.ts` stellt die gleiche Zuordnung dem Frontend und der KI bereit. Das Frontend zeigt „Vom Bedarf zur möglichen Lösung“, verlinkt positive Kandidaten mit ihrem Handlungsschritt und zeigt die Herkunft sowie offene Prüfungen. Die öffentliche Pax-Quelle ist direkt verlinkt. „Pax-Beratung vorbereiten“ füllt nur eine Chatnachricht aus; keine Kontaktaufnahme, Terminbuchung, Antragstellung oder Vertragsannahme. Bei Widerruf verschwindet das Produktobjekt aus dem aktuellen Fall. Keine neue API-Route, kein neuer Modellaufruf und keine zusätzliche Speicherung.

`test/produktzuordnung.test.ts` prüft positive Bedarfskandidaten, person-/ursachengenaue Zuordnung, Quellen und Zeitgrenzen, fehlende Bedingungen, Null-Lücken, reine Zeitabschnittsdeckung, explizit fehlende private Versicherung, Fehlercodes, Widerruf, veraltete Ergebnisse und identische Modell-/Frontend-Daten. 72 lokale Tests und Backend-Typecheck erfolgreich.

### Test mit synthetischen Angaben

Neue Sitzung, Nachricht 1:

> Ich bin ledig, männlich, Jahrgang 1990, angestellt und bei einer Pensionskasse versichert. Ich verdiene CHF 100’000 brutto pro Jahr und habe keine Kinder. Bei meiner Erwerbsunfähigkeit brauche ich 80 % meines heutigen Einkommens, im Todesfall 70 %. Ich möchte meine Absicherung prüfen.

Noch keine Produktzuordnung aus ungeklärter privater Absicherung. Nachricht 2:

> Ich habe genau einen bestehenden privaten Erwerbsunfähigkeitsrentenvertrag. Versichert bin ich selbst. Er zahlt CHF 1’000 pro Monat bei Krankheit und Unfall nach 6 Monaten Wartefrist bis Alter 65. Ich bestätige, dass diese Rente zusätzlich zu den gesetzlichen und PK-Leistungen ohne Verrechnung oder Kürzung dieser Leistungen ausgezahlt wird.

Im bereits bestätigten Risiko-Referenzfall ist die Krankheitslücke CHF 30’724/Jahr und die private Rente CHF 12’000/Jahr; der abgegrenzte Restbedarf beträgt CHF 18’724/Jahr ab Leistungsbeginn. Dafür ist die Pax-EU-Versicherung ein Prüfkandidat, keine verbindliche Offerte. Unfall hat bereits keine ursprüngliche Jahreslücke. Bei nachfolgendem Widerruf der Zusatzbestätigung darf kein Produktprüfkandidat weiter angezeigt werden.

Der vollständige Browser-Test mit echter KI und APICalc ist erfolgreich: Zunächst erscheint bei ungeklärter privater Absicherung kein konkretes Produkt. Nach Nachricht 2 erscheint der Krankheits-Prüfkandidat mit CHF 18’724/Jahr, Quellenlink, Zeitgrenzen und offenen Prüfungen. Der Button füllt lediglich das Chatfeld aus. Nach „Ich bin nicht mehr sicher, ob meine private Erwerbsunfähigkeitsrente ohne Verrechnung mit anderen Leistungen ausgezahlt wird“ verschwindet die konkrete Produktkarte; Vertragsklärung steht im Handlungsplan zuerst. Die KI nimmt die reduzierte Restlücke zurück und nennt die ursprüngliche Modelllücke von CHF 30’724/Jahr. Frontend-Produktionsbuild erfolgreich.

## Pensionierungsziele vergleichen

Neue Funktion `src/beratung/szenario.ts`: Aus einem aktuellen Pensionierungs- und Sparergebnis werden Vergleichswerte abgeleitet. Ein alternatives jährliches Haushaltsbudget wird über eine Kopie des Profils mit `Beratungsablauf.aktualisiere` durch dieselben Pensionierungs- und Sparrechner geführt. Alle anderen Angaben bleiben gleich. Der Budgetabgleich verwendet dieselbe Selbstauskunft. Keine weitere KI-Anfrage, keine freie Ersatzschätzung bei einem Rechnerfehler. Renteneinkommen (1. + 2. Säule) und Vermögensverzehr werden getrennt dargestellt.

`POST /api/szenario` erwartet ausschließlich `sessionId`, `revision` und `jahresbedarf` (CHF 0 bis 1’000’000 pro Jahr). Antwort: Vergleichs-ID, Revision, Ausgangslage, Alternative und gemeinsame Berechnungsgrenzen. Jede Sitzung hält nur den letzten erfolgreich berechneten Vergleich im Arbeitsspeicher. Berechnen verändert weder Profil noch Gespräch. Eine neue Berechnung ersetzt den vorherigen Kandidaten. Unbekanntes Budget bleibt unbekannt; eine modellierte Kapitallücke null führt zu Sparbedarf null.

`POST /api/szenario/uebernehmen` erwartet `sessionId`, `revision` und `szenarioId`. Nur die passende unveränderte Ausgangslage erlaubt die Übernahme. Jede akzeptierte Chatnachricht und jede Übernahme erhöhen die Revision und entwerten ältere Vergleiche. Während einer Berechnung blockiert derselbe Sitzungsschutz konkurrierende Änderungen. Gelöschte/abgelaufene Sitzungen lassen sich nicht wiederherstellen. Beim Übernehmen werden das berechnete alternative Ziel sowie die daraus abgeleiteten Ergebnisse und Handlungskarten zum aktuellen Stand. Die ausdrückliche Formularbestätigung wird als sichtbare Nutzeraktion mit deterministischer Bestätigung im Gespräch festgehalten; spätere Modellaufrufe erhalten diese Änderung im regulären Verlauf. Keine Kontaktaufnahme, Produktentscheidung oder Vertragsaktion.

Frontend: eigene Angular-Komponente `src/app/szenario/`. Nach einer erfolgreichen Pensionierungs- und Sparberechnung erscheint „Alternative durchrechnen“. Nach Eingabe eines anderen Jahresbedarfs zeigt die Komponente zwei Balken auf derselben Skala; die gestrichelte Linie markiert das verfügbare Monatsbudget. Text nennt Fehlbetrag oder verbleibendes Budget. Tabelle: Jahresbedarf, Renteneinkommen, Vermögensverzehr, Einkommenslücke, Kapitallücke und monatlicher Sparbedarf. Annahmen sind aufklappbar. „Dieses Ziel übernehmen“ aktualisiert den Beratungsstand ausdrücklich; „Alternative verwerfen“ entfernt den sichtbaren Vergleich. Chatänderungen entfernen den Vergleich ebenfalls. Auf schmalen Bildschirmen stehen die Balken untereinander und die Tabelle ist bei Bedarf horizontal scrollbar.

Test: synthetischen Pensionierungsfall mit Bedarf CHF 70’000/Jahr und zusätzlichem Monatsbudget CHF 250 vorbereiten. „Alternative durchrechnen“ öffnen, CHF 65’000 eingeben, berechnen. Ausgangslage bleibt CHF 70’000, alternative Ergebnisse kommen aus APICalc. Danach alternativ CHF 60’000 prüfen (keine Kapitallücke im bisherigen Referenzfall), verwerfen oder übernehmen. Nach Übernahme müssen Profil, Budget und Handlungskarten zum neuen Ziel passen. Das ist ein Vergleich des Ruhestandsbudgets; Pensionierungsalter, Familie und Eigenheim sind noch keine auswählbaren Szenarioparameter.

`test/szenario.test.ts` prüft isolierte Kopie, Wiederverwendung der Rechner ohne Modellaufruf, Budgetvergleich, Null-Lücke, unbekanntes Budget, Übernahme mit Herkunft und anschließendem Chatkontext, ungültige Eingaben, fehlende/fehlgeschlagene Berechnung, alte Revision, ersetzte Vergleichs-ID, Sitzungstrennung und Löschung während einer laufenden Berechnung. Insgesamt 77 Tests und Backend-Typecheck erfolgreich. Frontend-Produktionsbuild erfolgreich.

Browser-Verifikation mit echter KI und APICalc: Ausgangslage CHF 70’000 Jahresbedarf, Kapitallücke CHF 116’530, Sparbedarf CHF 335, Budget CHF 250. Alternative CHF 65’000: Kapitallücke CHF 1’530, Sparbedarf CHF 5 und CHF 245 verbleibendes Monatsbudget. Nach Verwerfen bleibt die ursprüngliche Unterdeckungskarte bestehen. Neue Alternative CHF 60’000: Kapitallücke und Sparbedarf null. Nach ausdrücklicher Übernahme erscheint die Bestätigung im Verlauf und statt der Unterdeckungskarte die Karte „Pensionierungsannahmen überprüfen“. Beide Balken und Tabellenwerte wurden visuell im Browser geprüft.
