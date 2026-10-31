# Datenschutz im Pax-Advisor-Prototyp

Stand: 31.10.2026. Diese Datei beschreibt, was der Code tatsächlich tut. Sie ist keine rechtliche Prüfung und kein Nachweis von DSG-Konformität. Der Prototyp ist nur für erfundene Demo-Angaben gedacht.

## Datenfluss

```text
Browser (Angular, Verlauf nur im Arbeitsspeicher)
  → Angular-Dev-Proxy → Backend auf 127.0.0.1:3000
      → lokale Eingabeprüfung: Muster blockieren oder maskieren (siehe unten)
      → OpenAI-Aufruf 1: Themenprüfung mit den letzten höchstens 7 akzeptierten Nachrichten
      → OpenAI-Aufruf 2: Antwort mit dem akzeptierten Verlauf der Sitzung (höchstens 40 Nachrichten)
      → lokale Ausgabeprüfung
  ← Antwort an den Browser
```

- An OpenAI gehen: der Systemprompt (ohne Kundendaten) und die Chatnachrichten nach der lokalen Prüfung. Sitzungskennung, IP-Adresse oder Benutzerkennungen werden nicht mitgeschickt.
- Eine Nachricht, die erst die Themenprüfung oder die Ausgabeprüfung ablehnt, **wurde bereits an OpenAI übertragen**. Nur lokal blockierte Eingaben erreichen den Anbieter nie.
- OpenAI wird mit `store: false` aufgerufen. Das schliesst eine Aufbewahrung beim Anbieter nach dessen Bedingungen (z. B. zur Missbrauchsüberwachung) nicht aus. Wir können sie nicht steuern.
- Backend → OpenAI läuft über HTTPS, Browser → Backend in der Demo über unverschlüsseltes HTTP auf localhost. Transportverschlüsselung schützt die Übertragung, sie anonymisiert nichts.

## Speicherorte

| Ort | Was | Dauer |
|---|---|---|
| Browser | Chatverlauf und Bestätigung des Hinweises im Arbeitsspeicher der Komponente; kein `localStorage`, keine Cookies | bis „Chat löschen“ oder Neuladen/Schliessen des Tabs |
| Backend | Sitzungen in einer `Map` im Arbeitsspeicher; keine Datenbank, keine Dateien | bis Löschung, 60 Minuten Inaktivität oder Neustart |
| Backend-Logs | nur die Startmeldung; keine Chattexte, keine Fehlerdetails des Anbieters | – |
| OpenAI-SDK-Logs | ausgeschaltet (`logLevel: 'off'`), auch wenn `OPENAI_LOG=debug` gesetzt ist; sonst würden Request-Inhalte ausgegeben | – |
| OpenAI | übermittelte Nachrichten und Antworten | nach Bedingungen des Anbieters, von uns nicht steuerbar |
| `backend/.env` | API-Schlüssel; per Root-`.gitignore` ausgeschlossen, nie an den Browser gesendet, nie geloggt | lokal |

## Löschung

- „Chat löschen“ sendet `DELETE /api/chat` mit `{ sessionId }`. Das Backend entfernt die Sitzung, danach leert das Frontend den Verlauf. Schlägt der Backend-Aufruf fehl, bleibt der Verlauf sichtbar und es erscheint eine Fehlermeldung.
- Unbekannte oder abgelaufene Kennungen gelten als bereits gelöscht (`204`). Eine gelöschte Sitzung lässt sich nicht fortsetzen (`410`).
- Wird während eines laufenden Modellaufrufs gelöscht, verwirft das Backend die Antwort und speichert nichts.
- Solange eine Antwort aussteht, ist der Button gesperrt. Bei der ersten Nachricht kennt der Browser die Sitzungskennung noch nicht.
- Wird der Tab ohne Löschen geschlossen, bleibt die Sitzung im Backend, bis sie nach 60 Minuten Inaktivität entfernt wird (Prüfung jede Minute) oder das Backend neu startet.
- **Nicht** abgedeckt: Kopien beim Modellanbieter.

## Getrennte Datenwege für Formulare

- `POST /api/chat` akzeptiert nur `message` und `sessionId`. Zusätzliche Felder wie `profile` oder `formData` werden vor jedem Modellaufruf mit `400` abgelehnt.
- Themenprüfung und Antwort erhalten ausschliesslich akzeptierte Chatnachrichten derselben Sitzung (`ModelRequest` in `backend/src/chat.ts`).
- Profil- oder Antragsformulare gibt es noch nicht. Regel für später: eigener Endpunkt und eigener Speicher, keine Nutzung von `ChatService` oder `ModelAdapter`. Formularwerte werden nie automatisch in Chatnachrichten, Zusammenfassungen oder die Themenprüfung übernommen. Wer Formularwerte an ein Modell geben will, muss das als eigene Entscheidung prüfen.
- Gesundheitsformulare sind bewusst nicht gebaut: Die APICalc-Schnittstelle (`APICalc-swagger.yaml`) enthält keine Felder für Diagnosen, Medikamente oder Rauchverhalten. Der Systemprompt weist das Modell an, solche Angaben im Chat nicht zu erfragen und ungefragt genannte nicht zu verwerten.

## Lokale Filter und ihre Grenzen

- **Blockiert vor dem Anbieter:** Muster für AHV-Nummern (756…), IBAN-ähnliche Werte, 16-stellige Kartennummern, `sk-…`-Schlüssel, `Bearer …`, `Passwort: …` und ähnliche Schlüssel-Wert-Angaben (`backend/guardrails.config.json`).
- **Maskiert:** E-Mail-Adressen und Telefonnummern mit `+`-Vorwahl. Nummern wie `061 …` ohne `+` werden nicht erkannt.
- **Nicht erkannt:** Namen, Adressen, Geburtsdaten, Einkommen, Gesundheitsangaben im Freitext, andere Schreibweisen und Sprachen. Was jemand so eintippt, geht an OpenAI.
- Die Filter sind eine Schadensbegrenzung, keine Anonymisierung und keine vollständige Erkennung sensibler Freitexte. Der Hinweis vor dem Chat und der Systemprompt sind Verhaltensvorgaben, keine technischen Garantien.

## Offene Prüfpunkte vor echtem Einsatz

Nichts davon ist umgesetzt oder geprüft.

- **Rollen und Verträge:** Pax als Verantwortliche. Auftragsbearbeitung mit dem Modellanbieter (Art. 9 DSG): Unterauftragsbearbeiter, Aufbewahrungsfristen, Ausschluss von Training, Löschung beim Anbieter.
- **Auslandübermittlung (Art. 16 f. DSG):** Empfängerstaaten, Garantien, Information der Betroffenen über die Staaten (Art. 19 Abs. 4 DSG).
- **Information der Betroffenen:** Der Demo-Hinweis ersetzt keine von Pax geprüfte Datenschutzerklärung.
- **Besonders schützenswerte Daten:** Ob und über welchen getrennten Weg Gesundheitsdaten überhaupt nötig sind, einschliesslich Einwilligung.
- **Datenschutz-Folgenabschätzung (Art. 22 DSG):** Erforderlichkeit prüfen. Dazu Verzeichnis der Bearbeitungstätigkeiten und Prozess für Datensicherheitsverletzungen.
- **Zugriffsschutz und Sicherheit:** Anmeldung; Bindung der Sitzung an einen Benutzer (heute genügt die Kenntnis der `sessionId`); TLS bis zum Browser; Ratenlimits; Secrets-Management statt `.env`; Hosting.
- **Nachvollziehbarkeit vs. Datenminimierung:** Konzept für Audit-Protokolle (Inhalt, Aufbewahrung, Zugriff) fehlt.
- **Menschliche Prüfung** bei automatisierten Empfehlungen sowie aufsichtsrechtliche Anforderungen an Auslagerungen.
- **Späteres alternatives Hosting:** Möglich wären ein in der Schweiz gehostetes Modell oder EU-Datenresidenz beim Anbieter, angeschlossen über einen eigenen `ModelAdapter`. Nichts davon ist gebucht. Antwortqualität und strukturierte Themenprüfung müssten neu getestet werden.

## Verifiziert

- `npm test` im Backend: 19 Tests ohne echte Kundendaten und ohne externe Modellaufrufe, darunter Löschung, Löschung während eines laufenden Aufrufs, Ablauf ohne Folgeanfrage und Abweisung von Profil-/Formularfeldern vor Themenprüfung und Antwort.
- Gegen das laufende Backend: `DELETE /api/chat` liefert `204` bzw. `400`; ein Chat-Request mit `profile`-Feld liefert `400`.
- Angular-Produktionsbuild erfolgreich. Die Oberfläche wurde nicht automatisiert im Browser durchgeklickt, und es gab keinen Live-Modellaufruf und keine juristische Prüfung.
