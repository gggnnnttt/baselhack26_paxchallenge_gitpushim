import { leeresProfil, Profil, type Person } from './profil.js';

// Synthetic inputs only. Recommendations still use the normal model pipeline.
export function muellerProfil(heute: Date) {
  const jahr = heute.getFullYear();
  const f = <T>(wert: T) => ({ wert, quelle: 'aussage' as const, beleg: 'Erfundene Demoangabe Familie Müller', begruendung: null, nachricht: 0 });
  const p = leeresProfil();
  const person = (geschlecht: 'weiblich' | 'maennlich', alter: number, pensum: number, lohn: number, pk: number): Person => ({
    geschlecht: f(geschlecht), geburtsjahr: f(jahr - alter), erwerb: f('angestellt'), pensumProzent: f(pensum),
    einkommen: f({ betrag: lohn, einheit: 'chf_jahr', basis: 'brutto', monatsloehne: null }), bvgVersichert: f(true),
    bedarfInvaliditaet: f({ hoehe: 80, einheit: 'prozent' }), bedarfTodesfall: f({ hoehe: 70, einheit: 'prozent' }),
    privateEu: { vorhanden: f(false) }, pensionierungsalter: f(65), pkAltersrente: f(pk), pkGuthaben: f(pk * 4),
  });
  p.personen = { A: { geschlecht: f('weiblich'), geburtsjahr: f(1986), erwerb: f('nicht_erwerbstaetig'), pensumProzent: f(0), bvgVersichert: f(false), privateEu: { vorhanden: f(false) }, pensionierungsalter: f(65), pkAltersrente: f(0), pkGuthaben: f(30000) }, B: person('maennlich', jahr - 1984, 100, 100000, 28000) };
  p.haushalt = { beziehung: f('verheiratet'), beziehungSeitJahr: f(jahr - 3), hatKinder: f(true), gemeinsamerHaushalt: f(true),
    bedarfPensionierung: f({ hoehe: 84000, einheit: 'chf_jahr' }), vermoegenPensionierung: f(35000),
    pensionierungBasisBestaetigt: f(true), budgetPensionierungMonat: f(600) };
  const geburt = new Date(heute); geburt.setDate(1); geburt.setMonth(geburt.getMonth() - 5);
  p.kinder = [{ id: 'k1', bezeichnung: 'Kind', herkunft: { quelle: 'aussage', beleg: 'Erfundene Demoangabe', begruendung: null, nachricht: 0 }, geburtsjahr: f(geburt.getFullYear()), elternteil: f('beide') }];
  p.anliegen = [{ id: 'a1', herkunft: { quelle: 'aussage', beleg: 'Erfundene Demoangabe', begruendung: null, nachricht: 0 }, text: 'Familie Müller mit einem fünf Monate alten Kind: Familie bei Erwerbsunfähigkeit und Todesfall absichern. Zusätzliche erfundene Demoannahmen: 600 CHF Sparbudget im Monat, geringe Anlageerfahrung, Planbarkeit wichtiger als hohe Rendite.' }];
  const rueckkehr = new Date(heute); rueckkehr.setDate(1); rueckkehr.setMonth(rueckkehr.getMonth() + 5);
  p.plaene = [{ id: 'p1', art: 'wiedereinstieg', person: 'A', beschreibung: 'Wiedereinstieg mit 40 %', herkunft: { quelle: 'aussage', beleg: 'Erfundene Demoangabe', begruendung: null, nachricht: 0 }, zeitpunkt: f({ jahr: rueckkehr.getFullYear(), monat: rueckkehr.getMonth() + 1, text: 'In fünf Monaten' }), pensumProzent: f(40), einkommen: f({ betrag: 30000, einheit: 'chf_jahr', basis: 'brutto', monatsloehne: null }), sicherheit: f('unsicher') }];
  p.naechsteId = { anliegen: 2, kind: 2, plan: 2 };
  return Profil.parse(p);
}
