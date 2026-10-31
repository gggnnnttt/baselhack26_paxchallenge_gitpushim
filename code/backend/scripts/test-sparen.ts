import { existsSync } from 'node:fs';
import { createApiCalcClient } from '../src/berechnung/apicalc.js';
import { aktualisierePensionierung, startePensionierung } from '../src/berechnung/pensionierung.js';
import { aktualisiereSparen, starteSparen } from '../src/berechnung/sparen.js';
import { leeresProfil } from '../src/profil/profil.js';

// Synthetic regression case. No OpenAI call, no real customer data.
const env = new URL('../.env', import.meta.url);
if (existsSync(env)) process.loadEnvFile(env);
const token = process.env['APICALC_TOKEN'];
if (!token) throw new Error('APICALC_TOKEN fehlt.');
const f = <T>(wert: T) => ({ wert, quelle: 'aussage' as const, beleg: 'synthetischer Test', begruendung: null, nachricht: 0 });
const profil = leeresProfil();
profil.haushalt = { beziehung: f('ledig'), bedarfPensionierung: f({ hoehe: 70000, einheit: 'chf_jahr' }), vermoegenPensionierung: f(50000), pensionierungBasisBestaetigt: f(true) };
profil.personen.A = { geschlecht: f('maennlich'), geburtsjahr: f(1990), bvgVersichert: f(true), einkommen: f({ betrag: 100000, einheit: 'chf_jahr', basis: 'brutto', monatsloehne: null }), pensionierungsalter: f(65), pkAltersrente: f(30000), pkGuthaben: f(120000) };
const jahr = new Date().getFullYear();
const client = createApiCalcClient({ baseUrl: process.env['APICALC_BASE_URL'] || 'https://baselhackathon2026.azurewebsites.net/viper', token, tenant: process.env['APICALC_TENANT'] || undefined,
  fetch: async (url, init) => {
    const response = await fetch(url, init);
    if (String(url).includes('APICalc_calculateSaving')) {
      // Diagnostic output contains only known numerical fields from this synthetic case.
      const body = await response.clone().json().catch(() => null);
      const fields = ['PeriodicInvestment', 'Deposits', 'Interest', 'GrossCapital', 'InterestRate', 'DurationYears', 'DurationMonths'];
      console.log('Spar-API-Prüfung', JSON.stringify({ status: response.status, werte: Object.fromEntries(fields.map(key => [key, typeof body?.response?.[key] === 'number' ? body.response[key] : null])) }));
    }
    return response;
  },
});
console.log('Synthetischer API-Test: erst Pensionierung bei CHF 70’000 Jahresbedarf, dann Sparrate zur verbleibenden Kapitallücke.');
const pension = await aktualisierePensionierung(startePensionierung(profil, jahr), profil, jahr, client);
const sparen = await aktualisiereSparen(starteSparen(), pension, jahr, client);
const { grundlageJson: _, ...sichtbarerSparstand } = sparen;
console.log(JSON.stringify({ pensionierung: pension.phase, fehler: pension.fehler, sparen: sichtbarerSparstand }, null, 2));
if (pension.phase !== 'berechnet' || sparen.phase !== 'berechnet') process.exitCode = 1;
