import { existsSync } from 'node:fs';
import { createApiCalcClient } from '../src/berechnung/apicalc.js';
import type { RetirementRequest } from '../src/berechnung/pensionierung.js';

// Explicitly synthetic single-person case, independent of the chat and model provider.
const env = new URL('../.env', import.meta.url);
if (existsSync(env)) process.loadEnvFile(env);
const token = process.env['APICALC_TOKEN'];
if (!token) throw new Error('APICALC_TOKEN fehlt in code/backend/.env.');
const request: RetirementRequest = {
  Relationship: 1, RelationshipSinceYear: new Date().getFullYear(),
  Person1: { Sex: 1, BirthYear: 1990, GrossIncome: 100000, WithBVG: true,
    DesiredRetirementAge: 65, RetirementPillar2: { Pension: 30000, CurrentCapital: 120000 } },
  CurrentFortune: 50000, InterestRate: 0, Saving: 0,
  NeedInPcRetirement: false, NeedRetirement: 60000, LiveSpan: 88,
};
console.log('Synthetischer Verbindungstest: Alter 65, Bedarf CHF 60’000/Jahr, PK-Rente CHF 30’000/Jahr, privates Kapital CHF 50’000.');
console.log('Annahmen: keine weiteren Sparbeiträge, 0 % Verzinsung, Planung bis Alter 88.');
try {
  const client = createApiCalcClient({ baseUrl: process.env['APICALC_BASE_URL'] || 'https://baselhackathon2026.azurewebsites.net/viper', token, tenant: process.env['APICALC_TENANT'] || undefined });
  const result = await client.berechnePensionierung(request);
  console.log(JSON.stringify(result.response, null, 2));
  if (result.response.ErrorCode !== 1) process.exitCode = 1;
} catch {
  console.error('Verbindungstest fehlgeschlagen: APICalc-Zugang, Netzwerk oder Antwortstruktur prüfen. Keine Zugangsdaten ausgegeben.');
  process.exitCode = 1;
}
