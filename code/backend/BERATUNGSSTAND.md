# Beratungsstand: Profil, Ablauf und Risikoberechnung

Stand: 31.10.2026. Beschreibt den implementierten ersten Schritt: ein Profil aus dem Gespräch, dessen Daten direkt in `APICalc_calculateRisk` verwendet werden. Produkte und Empfehlungslogik sind noch nicht gebaut.

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
