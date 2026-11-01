# Pax Advisor – BaselHack 2026, Pax Challenge (Team A2)

Prototyp eines KI-gestützten Vorsorgeberaters für Pax: Im Chat erfasst Pax die Situation eines Haushalts
(drei Säulen, Pläne, Anliegen), rechnet Risiko- und Pensionierungslücken über die Pax-APICalc-Schnittstelle,
erklärt die Ergebnisse und leitet zu persönlichen Empfehlungen und einem Beratungsprotokoll weiter.
In komplexen Fällen übergibt Pax nach vordefinierten Kriterien an eine Pax-Fachperson.

> Hackathon-Prototyp, nur für erfundene Demo-Angaben. Keine Offerte, keine Beratung, kein Produkt von Pax.

## Team

Edon Kurtaj, Elton Zijadin Malici, Gentian Sadriu

## Struktur

- `code/backend` – Node.js/TypeScript-Backend (Chat-Pipeline, Guardrails, Berechnungen, OpenAI-Anbindung)
- `code/frontend` – Angular-Frontend
- Weitere Dokumente: `code/DATENSCHUTZ.md`, `code/backend/GUARDRAILS.md`, `code/backend/BERATUNGSSTAND.md`

## Lokal starten

Voraussetzungen: Node.js 20.12 oder neuer, ein OpenAI-API-Key und optional ein APICalc-Zugang.

```bash
# Backend (http://127.0.0.1:3000)
cd code/backend
cp .env.example .env   # OPENAI_API_KEY und optional APICALC_* eintragen
npm install
npm run dev

# Frontend (http://localhost:4200, leitet /api an das Backend weiter)
cd code/frontend
npm install
npm start
```

Tests: `cd code/backend && npm test`

## Lizenz und Rechte

Der von unserem Team geschriebene **Quellcode** steht unter der MIT-Lizenz, siehe [`license.txt`](license.txt).

**Ausgenommen** sind alle Inhalte von Pax (Pax, Schweizerische Lebensversicherungs-Gesellschaft AG):
der Name Pax, Logos und Marken, die Pax-Figur, die Schrift PaxCivil, das Corporate Design mit Farben,
Design-Tokens und Stil sowie Produktnamen, Produkt- und Tarifinformationen. Diese wurden ausschliesslich
für die BaselHack 2026 Pax Challenge verwendet. **Alle Rechte daran liegen bei Pax.** Sie dürfen ohne
Zustimmung von Pax nicht verwendet, kopiert, verändert oder weitergegeben werden.
Details stehen in [`license.txt`](license.txt).

## Haftungsausschluss

- **Kein Pax-Produkt:** Dies ist ein unabhängiger Hackathon-Prototyp. Er ist kein Angebot von Pax und wird von
  Pax weder betrieben noch geprüft, freigegeben oder unterstützt.
- **Keine Beratung:** Die Anwendung erbringt keine Versicherungs-, Vorsorge-, Finanz-, Steuer- oder
  Rechtsberatung. Alle Ausgaben, Berechnungen und Empfehlungen sind unverbindliche Demo-Inhalte, keine
  Offerten und keine Zusagen. Für Entscheidungen ist eine Fachperson beizuziehen.
- **KI-Ausgaben:** Texte werden von einem Sprachmodell erzeugt und können falsch, unvollständig oder veraltet sein.
  Die Guardrails im Code mindern Risiken, garantieren aber nichts (siehe `code/backend/GUARDRAILS.md`).
- **Nur Demo-Daten:** Der Prototyp ist nur für erfundene Angaben gedacht. Gesprächsinhalte gehen an externe
  Dienste (OpenAI, APICalc), siehe `code/DATENSCHUTZ.md`. Geben Sie keine echten Personendaten ein.
- **Verantwortung bei Weiterverwendung:** Wer den Code verwendet, verändert oder betreibt, tut dies auf eigenes
  Risiko und ist selbst verantwortlich für Betrieb, Sicherheit, Datenschutz (z. B. DSG/DSGVO), die Einhaltung
  aufsichts- und versicherungsrechtlicher Vorgaben, die Nutzungsbedingungen der verwendeten Dienste sowie
  anfallende Kosten (z. B. API-Kosten).
- **Keine Haftung:** Die Software wird ohne jede Gewährleistung bereitgestellt. Die Autorinnen und Autoren
  haften, soweit gesetzlich zulässig, nicht für Schäden aus der Nutzung oder Weiterverwendung des Codes
  (siehe MIT-Lizenz in [`license.txt`](license.txt)).
