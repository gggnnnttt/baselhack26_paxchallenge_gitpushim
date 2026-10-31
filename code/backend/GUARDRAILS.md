# Aktive, modellunabhängige Guardrails

Stand: 31.10.2026. Beim nächsten Backend-Start aktiv. Keine Abhängigkeit von `@openai/guardrails` und kein fest verdrahtetes separates GPT-Prüfmodell. Eine vorgeschaltete Themenprüfung verwendet denselben konfigurierten Modelladapter wie der Chat.

## Aufbau

```text
POST /api/chat { message, sessionId? }
  → lokale Eingabeprüfung und Kontaktmaskierung
  → akzeptierter Verlauf aus dem Backend
  → Themenprüfung über denselben ModelAdapter (strikte Ja/Nein-Entscheidung)
  → nur bei erlaubtem Thema: Profilerfassung und Beratungsablauf (siehe BERATUNGSSTAND.md)
  → ModelAdapter.generate({ instructions + Beratungsstand, messages, maxOutputTokens })
  → lokale Ausgabeprüfung
  → nur bei Erfolg: Verlauf ergänzen und Antwort ausliefern
```

- `src/guardrails.ts`: rein lokale Prüfungen, ohne Modell-SDK.
- `guardrails.config.json`: Grenzwerte und lokale Erkennungsmuster; kein OpenAI-Wizard-Format mehr.
- `src/scope.ts`: semantische Prüfung auf fachlichen Bezug; ungültige Entscheidungen oder Ausfälle blockieren die Antwortgenerierung.
- `src/chat.ts`: anbieterunabhängiger Chatablauf, akzeptierter Gesprächsverlauf und Sitzungsgrenzen.
- `src/providers/openai.ts`: einziger OpenAI-spezifischer Adapter. Hier ist aktuell der vorhandene Modellzugang angeschlossen.
- `advisor.instructions.md`: wird beim Start serverseitig geladen und bei jedem Modellaufruf als Instruktionen übergeben.
- `src/server.ts`: lädt Dateien relativ zum Modul, initialisiert die Pipeline und liefert ausschliesslich feste Fehlermeldungen zurück.

Für einen anderen Anbieter implementiert das spätere Team das Interface `ModelAdapter` und übergibt dessen Implementierung an `ChatService`. Alle lokalen Kontrollen bleiben davor und danach erhalten. Ob ein neues Modell passende Antworten liefert, muss separat getestet werden. Die Themenprüfung erfolgt über denselben austauschbaren Adapter. Aktuell sind deshalb Themenprüfung, Profilerfassung und Antwort OpenAI-Aufrufe. Bei einem späteren anderen Adapter darf dessen Implementierung keine versteckten OpenAI-Aufrufe enthalten. Das optionale `responseFormat` (`{ name, schema }`) verlangt eine strikte JSON-Antwort, für die Themenprüfung mit genau einem booleschen Feld `allowed`, für die Profilerfassung nach dem aus Zod erzeugten Schema. Der OpenAI-Adapter verwendet dafür Structured Outputs; andere Adapter müssen das gleiche Ergebnis liefern.

## Fachliche Grenze

Der Advisor ist kein allgemeiner Chatbot. Allgemeine Programmieraufgaben, Hausaufgaben und isolierte Rechenaufgaben sollen abgelehnt werden. Kontextbezogene Budgetrechnungen, kurze Antworten auf Beratungsfragen, Begrüssungen und Fragen zur Anwendung bleiben erlaubt. Das wird im Systemprompt und in einer vorgeschalteten separaten Themenentscheidung beschrieben.

Vor der eigentlichen Antwort lässt das Backend die letzten höchstens sieben bereinigten Nachrichten klassifizieren. Bei `allowed: false` gibt es eine feste Ablehnung, keinen Antwortaufruf und keine Übernahme der abgelehnten Nachricht in die Historie. Bei ungültigem JSON, zusätzlichem Feld, falschem Datentyp oder Providerfehler wird ebenfalls keine Antwort generiert. Das Modell entscheidet nicht, diese Backend-Grenze zu überspringen.

Das ist eine semantische Modellprüfung und keine unfehlbare Erkennung. Die Grenze wird technisch durchgesetzt, die Einordnung selbst kann sich irren. Kein fester Fragenkatalog und keine reine Schlagwortliste für erlaubte Themen.

**Kosten:** Jede Nachricht nach lokaler Eingabeprüfung verursacht einen Themenprüfungsaufruf mit bis zu 512 Ausgabetokens. Erlaubte Nachrichten verursachen anschliessend einen Profilerfassungsaufruf (bis zu 4000 Ausgabetokens) und den Antwortaufruf, also drei Modellaufrufe pro Nachricht. Fachfremde Anfragen sind somit nicht kostenlos; sie erhalten aber keine allgemeine Aufgabenlösung. Die Konfiguration ist keine accountweite Kosten- oder Missbrauchssperre.

## Was tatsächlich durchgesetzt wird

- Nur `message` und optional `sessionId` als Request-Felder. Browser dürfen keine Rollen, fremden Instruktionen oder behaupteten Assistant-Verläufe einschleusen.
- Eingabegrössen, Antwortgrössen, Gesprächslänge und Zahl der Sitzungen sind begrenzt.
- Bekannte Muster etwa für AHV-Nummern, IBANs, Kartenwerte und technische Geheimnisse werden vor dem Provider blockiert. Kontaktmuster werden lokal ersetzt. Normalisierung erfasst einige Unicode-Abwandlungen.
- Auch späterer Modellkontext verwendet nur bereits bereinigte und akzeptierte Nachrichten.
- Bekannte sensible Begriffe werden in Modellantworten konservativ blockiert, unabhängig davon, ob das Modell sie als Frage, Liste oder Upload-Bitte formuliert. Dadurch können auch harmlose Erklärungen zu solchen Begriffen zurückgehalten werden. Feste Backend-Fehlermeldungen erklären den zulässigen Erfassungsweg.
- Bekannte Behauptungsmuster über bereits ausgeführte Berechnungen oder Vertragsaktionen werden zurückgehalten. Reale Aktionswerkzeuge sind dem Modell überhaupt nicht bereitgestellt.
- Blockierte Antworten und zugehörige neue Nutzernachrichten werden nicht in den akzeptierten Verlauf aufgenommen.
- Bei ungültiger oder leerer Modellantwort, Providerfehler oder lokaler Prüfverletzung wird nichts ungeprüft ausgeliefert. Keine Umgehung über einen zweiten Client.
- Die Antwort wird vollständig geprüft, bevor das Frontend sie erhält; kein Streaming.
- Pro Sitzung läuft höchstens ein Modellaufruf gleichzeitig. Neue Sitzungen reservieren vor dem Aufruf Kapazität. Abgelaufene inaktive Sitzungen werden bei der nächsten Anfrage und zusätzlich einmal pro Minute entfernt. `DELETE /api/chat` löscht eine Sitzung sofort. Neustart leert alle Sitzungen. Keine Speicherung auf Datenträger. Details zu Datenflüssen und Löschung: `../DATENSCHUTZ.md`.

## Grenzen – wichtig für die Übergabe

Diese Kontrollen sind modellunabhängiger Anwendungscode, kein Beweis vollständiger KI-Sicherheit oder Datenschutzkonformität. Muster erkennen nicht jede Schreibweise, Kodierung, Sprache oder persönliche Information. Es gibt keinen vollständigen semantischen Jailbreak-Detektor, keine allgemeine Inhaltsmoderation und keine verlässliche Prüfung fachlicher Wahrheit. Die Themenprüfung ist kein vollständiger Angriffsschutz. Insbesondere können unbelegte Zahlen anders formuliert werden als die erkannten Behauptungsmuster. Der Systemprompt beschreibt gewünschtes Verhalten, garantiert es aber nicht.

AHV-/Ausweis-/Zahlungsdaten gehören nicht in den Chat. Trotzdem dürfen mit dieser Erkennung keine beliebigen echten Kundendaten verarbeitet werden: Namen, Einkommen und Familienangaben sind ebenfalls personenbezogen. Weiterhin ausschliesslich synthetische Demo-Daten einsetzen.

Die zufällige Sitzungskennung ist für die lokale Demo bestimmt, keine produktionsfähige Benutzeranmeldung oder Mandantenberechtigung. Der Server lauscht weiterhin ausschliesslich auf `127.0.0.1`. Vor öffentlicher Nutzung braucht es unter anderem echte Zugriffskontrolle, geeignete Raten-/Kostenlimits und geklärte Datenverarbeitung. Es gibt derzeit ein Ausgabetokenlimit und keine automatischen Provider-Retries, aber keine accountweite Dollar-Budgetüberwachung.

OpenAI wird mit `store: false`, 30 Sekunden Timeout und ohne automatische Wiederholungen aufgerufen. `store: false` ist keine Zusage, dass beim Anbieter keinerlei Datenaufbewahrung stattfindet.

## Start und Prüfung

Im Backend-Verzeichnis:

```bash
npm run typecheck
npm test
npm run dev
```

Frontend in einem zweiten Terminal wie bisher mit `npm start` starten. Nach dem Backend-Neustart einen neuen Chat beginnen: Der Browser sendet jetzt nur die neue Nachricht mit der zurückgegebenen Sitzungskennung. Vor dem ersten Chat muss der Datenschutzhinweis bestätigt werden. Der Button „Chat löschen“ entfernt den Verlauf im Backend und im Browser und beginnt eine getrennte Unterhaltung.

`OPENAI_API_KEY` und optional `OPENAI_MODEL` werden aus der bestehenden Backend-`.env` oder Prozessumgebung gelesen. Der Schlüssel wird nicht ausgegeben. Eine fehlende Konfiguration verhindert den Serverstart.

## Verifiziert

`npm test` führt 37 lokale Tests aus (`test/chat.test.ts`, `test/beratung.test.ts`, `test/pensionierung.test.ts`): normale Familienanliegen, sensible Eingaben vor dem Provider, bereinigter Kontext, abgewiesene eingeschleuste Rollen, blockierte Ausgaben ohne Historienübernahme, sichere Providerfehler, gleiche Pipeline mit anderem Adapter, Sitzungs-/Eingabegrenzen, Konfigurationsprüfung sowie der echte OpenAI-SDK-Adapter mit simuliertem HTTP-Transport. Weitere Regressionstests prüfen die durchgesetzte Themenablehnung ohne Antwortaufruf, ungültige Themenentscheidungen, bereinigten Klassifikationskontext und das JSON-Schema im OpenAI-Adapter. Datenschutztests prüfen Sitzungslöschung (auch während eines laufenden Modellaufrufs), Ablauf ohne Folgeanfrage und dass zusätzliche Profil-/Formularfelder weder Themenprüfung noch Antwortaufruf erreichen. Dabei erfolgen keine externen Modellaufrufe. Die semantische Trefferrate der Themenentscheidung ist damit nicht gemessen; die Entscheidungen werden in den Tests simuliert.

Backend-Typecheck und Angular-Produktionsbuild wurden zusätzlich ausgeführt. Zwei kurze Live-Gespräche mit erfundenen Angaben wurden gegen das echte Modell geführt, um Strict-Schema und Profilerfassung zu prüfen; das ist keine systematische Qualitätsmessung. Andere Modellanbieter sind noch nicht implementiert, das Adapterinterface ist vorhanden.

Pensionierungs-Erweiterung: eigener Berechnungsstand, Bestätigung der drei Basisannahmen und validierte neue Profilfelder. Die zusätzlichen Werte gehen ebenfalls als Beratungsstand an den Modellanbieter. Neue und veraltete Pensionierungsergebnisse werden unabhängig von den Risikoergebnissen geführt. Details und synthetischer Verbindungstest: `BERATUNGSSTAND.md`.
