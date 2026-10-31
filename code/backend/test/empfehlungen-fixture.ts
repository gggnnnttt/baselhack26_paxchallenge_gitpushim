import { Beratungsablauf } from '../src/beratung/ablauf.js';
import { leeresProfil } from '../src/profil/profil.js';
const f = <T>(wert: T) => ({ wert, quelle: 'aussage' as const, beleg: 'synthetisch', begruendung: null, nachricht: 0 });
async function fixture({ paar = false, jahrgang = 1995, gap = 12000, pension = 8000, vermoegen = 0, rendite = false } = {}) {
 const p = leeresProfil();
 p.haushalt = { beziehung: f(paar ? 'verheiratet' : 'ledig'), beziehungSeitJahr: f(2020), hatKinder: f(false), bedarfPensionierung: f({ hoehe: 60000, einheit: 'chf_jahr' }), vermoegenPensionierung: f(vermoegen), pensionierungBasisBestaetigt: f(true) };
 p.personen.A = { geschlecht: f('maennlich'), geburtsjahr: f(jahrgang), erwerb: f('angestellt'), einkommen: f({ betrag: 90000, einheit: 'chf_jahr', basis: 'brutto', monatsloehne: null }), bvgVersichert: f(true), bedarfInvaliditaet: f({ hoehe: 80, einheit: 'prozent' }), bedarfTodesfall: f({ hoehe: 70, einheit: 'prozent' }), privateEu: { vorhanden: f(false) }, pensionierungsalter: f(65), pkAltersrente: f(20000), pkGuthaben: f(100000) };
 if (paar) { p.haushalt.hatKinder = f(true); p.kinder.push({ id: 'k1', bezeichnung: 'Kind', herkunft: f('synthetisch'), geburtsjahr: f(2026), elternteil: f('beide') }); }
 if (paar) p.personen.B = { ...p.personen.A, erwerb: f('nicht_erwerbstaetig'), einkommen: undefined, bvgVersichert: f(false), pkAltersrente: f(0), pkGuthaben: f(0) };
 if (rendite) p.anliegen.push({ id: 'a1', text: 'Ich möchte renditeorientiert sparen.', herkunft: f('test') });
 const ablauf = new Beratungsablauf({ berechneRisiko: async () => ({ response: { RiskScenarioSummaries: [1,2,3,4,...(paar ? [5,6,7,8] : [])].map(Scenario => ({ Scenario, ErrorCode: 0, IncomeGap: Scenario > 4 ? 0 : gap })) } }), berechnePensionierung: async () => ({ response: { ErrorCode: 1, IncomeGap: pension, IncomeNeed: 60000, IncomeTotal: 52000, IncomePillar1: 30000, IncomePillar2: 22000, IncomeWithdrawal: 0, AvailableFortune: vermoegen, CapitalNeed: 100000, CapitalGap: 100000 } }) });
 return ablauf.aktualisiere(ablauf.start(2026), p);
}
export { fixture, f };
