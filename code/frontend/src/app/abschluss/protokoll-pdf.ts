import type { Content, ContentTable, ContentText, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { Beratungsstand, GrafikZeile } from '../beratungsstand/beratungsstand.model';
import { chf } from '../format';
import { istTermin, monatJahr, type Antrag } from './abschluss.model';

/** The model's texts for the record, from POST /api/protokoll (numbers checked against the data on the server). */
export interface ProtokollTexte {
  revision: number;
  ausgangslage: string | null;
  pakete: { id: string; grundlage: string | null }[];
  fazit: string | null;
}

export interface ProtokollDaten {
  antrag: Antrag;
  stand: Beratungsstand | null;
  freigegeben: boolean;
  demo: boolean;
  texte: ProtokollTexte | null;
  // The model's explanation of the pillar chart (POST /api/grafik).
  grafikText: string | null;
  erstellt: Date;
}

// Pax tokens (pax-tokens.css) and the chart colours of SaeulenGrafik.
const FARBE = {
  lila: '#3c0078', gruen: '#8ccd0f', kontrastGruen: '#5ca700', text: '#121212', grau: '#5c5c5c', hellgrau: '#8a8a8a',
  linie: '#e4e1ea', flaeche: '#f8f6fb', gruenFlaeche: '#f5fbe9', warnung: '#814c00', warnungFlaeche: '#fff4e5',
  t1: '#6a3fa6', t2: '#5ca700', t3: '#22a2ff', luecke: '#b54963', spur: '#efecf3',
};
const TEILE = [
  { key: 'ersteSaeule', name: 'AHV/IV', farbe: FARBE.t1 },
  { key: 'zweiteSaeule', name: 'Pensionskasse', farbe: FARBE.t2 },
  { key: 'weiteres', name: 'Partnereinkommen und Vermögen', farbe: FARBE.t3 },
  { key: 'luecke', name: 'Lücke', farbe: FARBE.luecke },
] as const;
const WER: Record<GrafikZeile['wer'], string> = { Sie: 'betrifft Sie', 'Partner/in': 'betrifft Ihren Partner oder Ihre Partnerin', Haushalt: 'Haushalt' };
const PARTNER = 'Partner/in: ';
const ADRESSE = 'Pax, Schweizerische Lebensversicherungs-Gesellschaft AG · Aeschenplatz 13 · 4002 Basel';

// A4 in points; the content width follows from the margins.
const RAND = { links: 56, oben: 76, rechts: 56, unten: 64 };
const BREITE = 595.28 - RAND.links - RAND.rechts;

const datumZeit = (d: Date) => d.toLocaleString('de-CH', { dateStyle: 'medium', timeStyle: 'short' });
const ki = (text: string): ContentText => ({ text: `  ${text}`, style: 'quelle' });

function abschnitt(nummer: number | null, titel: string): Content {
  return {
    stack: [
      { text: nummer === null ? titel : `${nummer}   ${titel}`, style: 'h2' },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: BREITE, y2: 0, lineWidth: 0.75, lineColor: FARBE.linie }], margin: [0, 4, 0, 10] },
    ],
  };
}

// A heading never ends a page alone: it moves to the next page together with its first block.
const zusammen = (...teile: Content[]): Content => ({ stack: teile, unbreakable: true });

const unterTitel = (text: string, quelle?: string): Content =>
  ({ text: [{ text }, ...(quelle ? [ki(quelle)] : [])], style: 'h4' } as Content);

function kopf(d: ProtokollDaten, logo: string): Content {
  return [
    {
      columns: [
        { svg: logo, width: 92 },
        {
          stack: [
            { text: 'Beratungsprotokoll', style: 'h1' },
            { text: d.demo ? 'Haushalt Familie Müller' : 'Digitale Vorsorgeberatung', color: FARBE.grau, margin: [0, 3, 0, 0] },
          ],
          alignment: 'right',
        },
      ],
    },
    { canvas: [{ type: 'rect', x: 0, y: 0, w: BREITE, h: 2.5, color: FARBE.gruen }], margin: [0, 14, 0, 14] },
    {
      table: {
        widths: ['*', '*', '*', '*'],
        body: [[
          ['Erstellt am', datumZeit(d.erstellt)],
          ['Antrag', d.antrag.nummer],
          ['Stand der Beratung', `Version ${d.antrag.revision}`],
          ['Freigabe', d.freigegeben ? 'Durch Pax-Fachperson erteilt' : 'Ausstehend, Prüfung durch Pax-Fachperson'],
        ].map(([label, wert]) => ({ stack: [{ text: label, style: 'label' }, { text: wert, style: 'metaWert' }] }))],
      },
      layout: {
        fillColor: () => FARBE.flaeche, hLineWidth: () => 0, vLineWidth: () => 0,
        paddingLeft: (i) => (i === 0 ? 12 : 6), paddingRight: (i, node) => (i === (node.table.widths?.length ?? 1) - 1 ? 12 : 6),
        paddingTop: () => 10, paddingBottom: () => 10,
      },
    },
  ];
}

function saeulen(stand: Beratungsstand): Content | null {
  const liste = stand.lagebild.saeulen;
  if (!liste.length) return null;
  const zelle = (s: (typeof liste)[number]): Content => {
    const sie = s.bekannt.filter((b) => !b.startsWith(PARTNER));
    const partner = s.bekannt.filter((b) => b.startsWith(PARTNER)).map((b) => b.slice(PARTNER.length));
    return {
      stack: [
        { text: `${s.nummer}. Säule`, style: 'label' },
        { text: s.untertitel || s.titel, style: 'saeuleTitel' },
        ...(sie.length ? [{ text: sie.join(', '), margin: [0, 0, 0, 3] as [number, number, number, number] }] : []),
        ...(partner.length ? [{ text: [{ text: 'Partner/in: ', color: FARBE.grau }, partner.join(', ')], margin: [0, 0, 0, 3] as [number, number, number, number] }] : []),
        ...(s.offen.length ? [{ text: `Noch offen: ${s.offen.join(', ')}`, color: FARBE.grau }] : []),
      ],
      fontSize: 8.5,
    };
  };
  return {
    table: { widths: liste.map(() => '*'), body: [liste.map(zelle)] },
    layout: {
      fillColor: () => FARBE.flaeche, hLineWidth: () => 0, vLineWidth: (i, node) => (i > 0 && i < (node.table.widths?.length ?? 0) ? 6 : 0),
      vLineColor: () => '#ffffff', paddingLeft: () => 10, paddingRight: () => 10, paddingTop: () => 9, paddingBottom: () => 9,
    },
    unbreakable: true,
    margin: [0, 2, 0, 12],
  };
}

function erkenntnisse(d: ProtokollDaten): Content | null {
  const berechnet = d.stand?.lagebild.erkenntnisse.filter((e) => e.quelle !== 'ki').map((e) => e.text) ?? [];
  const modell = [...new Set([...d.antrag.erkenntnisse, ...(d.stand?.lagebild.erkenntnisse.filter((e) => e.quelle === 'ki').map((e) => e.text) ?? [])])];
  if (!berechnet.length && !modell.length) return null;
  return zusammen(
    unterTitel('Was Pax erkannt hat'),
    {
      ul: [
        ...berechnet.map((t) => ({ text: [t, ki('Berechnung')] })),
        ...modell.map((t) => ({ text: [t, ki('KI')] })),
      ] as Content[],
      markerColor: FARBE.kontrastGruen,
      margin: [0, 0, 0, 4],
    },
  );
}

// "Was fehlt im Ernstfall?" drawn as vectors: one bar per scenario on a shared scale, the line marks the need.
function grafik(titel: Content, zeilen: GrafikZeile[], text: string | null): Content {
  const max = Math.max(1, ...zeilen.map((z) => Math.max(z.bedarf, z.ersteSaeule + z.zweiteSaeule + z.weiteres + z.luecke)));
  const schritt = max > 100_000 ? 50_000 : 20_000;
  const skala = Math.ceil(max / schritt) * schritt;
  const x = (wert: number) => (wert / skala) * BREITE;
  const k = (wert: number) => (wert >= 1000 ? `${wert / 1000}k` : String(wert));

  const balken = zeilen.map((z): Content => {
    let pos = 0;
    const teile = TEILE.filter((t) => z[t.key] > 0).map((t) => {
      const w = x(z[t.key]);
      const rect = { type: 'rect' as const, x: pos, y: 3, w, h: 12, color: t.farbe };
      pos += w;
      return rect;
    });
    return {
      stack: [
        {
          columns: [
            { text: [{ text: z.titel, bold: true }, { text: `  ${WER[z.wer]}`, color: FARBE.grau, fontSize: 8 }] },
            { text: z.luecke > 0 ? `Lücke ${chf(z.luecke)} pro Jahr` : 'gedeckt', alignment: 'right', width: 'auto', bold: true, color: z.luecke > 0 ? FARBE.luecke : FARBE.kontrastGruen },
          ],
          fontSize: 9,
        },
        {
          canvas: [
            { type: 'rect', x: 0, y: 3, w: BREITE, h: 12, color: FARBE.spur },
            ...teile,
            { type: 'line', x1: x(z.bedarf), y1: 0, x2: x(z.bedarf), y2: 18, lineWidth: 1.6, lineColor: FARBE.text },
          ],
          margin: [0, 3, 0, 0],
        },
        { text: `Bedarf ${chf(z.bedarf)} pro Jahr`, fontSize: 7.5, color: FARBE.grau, margin: [0, 2, 0, 0] },
      ],
      margin: [0, 0, 0, 9],
    };
  });

  // One row of swatches and names; a table measures the "auto" widths reliably.
  const muster = (farbe: string): Content => ({ canvas: [{ type: 'rect', x: 0, y: 1.5, w: 8, h: 8, r: 1.5, color: farbe }] });
  const legende: Content = {
    table: {
      widths: [...TEILE.flatMap(() => [8, 'auto']), 2, 'auto'],
      body: [[
        ...TEILE.flatMap((t) => [muster(t.farbe), { text: t.name, noWrap: true }]),
        { canvas: [{ type: 'line', x1: 1, y1: 0, x2: 1, y2: 10, lineWidth: 1.6, lineColor: FARBE.text }] },
        { text: 'Bedarf', noWrap: true },
      ]],
    },
    layout: {
      hLineWidth: () => 0, vLineWidth: () => 0, paddingTop: () => 0, paddingBottom: () => 0,
      paddingLeft: (i) => (i % 2 === 0 ? (i === 0 ? 0 : 12) : 4), paddingRight: () => 0,
    },
    fontSize: 8,
    color: FARBE.grau,
    margin: [0, 0, 0, 12],
  };

  const achse: Content = {
    columns: [0, skala / 2, skala].map((wert, i) => ({ text: k(wert), alignment: (['left', 'center', 'right'] as const)[i] })),
    fontSize: 7.5,
    color: FARBE.hellgrau,
    margin: [0, -4, 0, 6],
  };

  return [
    {
      // The chart stays on one page, together with its heading.
      stack: [
        titel,
        { text: 'Ihr Bedarf pro Jahr und was die drei Säulen leisten. Berechnet mit der Pax-Rechenschnittstelle (APICalc), Beträge in CHF pro Jahr.', color: FARBE.grau, fontSize: 8.5, margin: [0, 0, 0, 8] },
        legende,
        ...balken,
        achse,
      ],
      unbreakable: true,
    },
    ...(text ? [unterTitel('Was die Grafik zeigt', 'KI'), { text, margin: [0, 0, 0, 4] as [number, number, number, number] }] : []),
  ];
}

function paket(d: ProtokollDaten, p: Antrag['pakete'][number], i: number): Content {
  const grundlage = d.texte?.pakete.find((t) => t.id === p.id)?.grundlage ?? null;
  const inhalt: Content[] = [
    {
      columns: [
        { text: `${i + 1}   ${p.produkt.name}`, style: 'h3' },
        ...(p.produkt.saeule ? [{
          width: 'auto' as const,
          table: { body: [[{ text: `Säule ${p.produkt.saeule}`, fontSize: 8, bold: true, color: FARBE.lila }]] },
          layout: { fillColor: () => FARBE.gruen, hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 1.5, paddingBottom: () => 1 },
        } as ContentTable] : []),
      ],
    },
    ...(p.titel !== p.produkt.name ? [{ text: p.titel, bold: true, margin: [0, 2, 0, 0] as [number, number, number, number] }] : []),
    unterTitel('Warum wir Ihnen das empfehlen', 'KI'),
    { text: p.begruendung },
    ...(p.einordnung ? [unterTitel('Ihre Lage', 'KI'), { text: p.einordnung }] : []),
    ...(grundlage ? [unterTitel('Worauf die Empfehlung beruht', 'KI'), { text: grundlage }] : []),
    ...(p.hinweis ? [{
      table: { widths: ['*'], body: [[{ text: p.hinweis, color: FARBE.warnung, fontSize: 8.5 }]] },
      layout: { fillColor: () => FARBE.warnungFlaeche, hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 5, paddingBottom: () => 5 },
      margin: [0, 8, 0, 0] as [number, number, number, number],
    } as ContentTable] : []),
    ...(!istTermin(p) ? [{ text: `Gewünschter Vertragsbeginn: 1. ${monatJahr(d.antrag.beginn)}. Die Prämie folgt mit der verbindlichen Offerte.`, fontSize: 8.5, color: FARBE.grau, margin: [0, 8, 0, 0] as [number, number, number, number] }] : []),
  ];
  return {
    table: { widths: ['*'], body: [[{ stack: inhalt }]] },
    layout: {
      hLineWidth: () => 0, vLineWidth: (j) => (j === 0 ? 3 : 0), vLineColor: () => FARBE.gruen,
      paddingLeft: () => 14, paddingRight: () => 0, paddingTop: () => 2, paddingBottom: () => 2,
    },
    // A recommendation is read as a whole: it moves to the next page rather than splitting.
    unbreakable: true,
    margin: [0, 0, 0, 16],
  };
}

/** The advice record as a pdfmake document: A4, Pax font and logo, page numbers, no browser header or footer. */
export function protokollDokument(d: ProtokollDaten, logo: string): TDocumentDefinitions {
  const stand = d.stand;
  const zeilen = stand?.grafik ?? [];
  let nr = 0;
  const content: Content[] = [kopf(d, logo)];

  content.push(zusammen(abschnitt(++nr, 'Ihre Ausgangslage'), ...(d.texte?.ausgangslage ? [{ text: d.texte.ausgangslage, margin: [0, 0, 0, 12] as [number, number, number, number] }] : [])));
  const s = stand && saeulen(stand);
  if (s) content.push(s);
  const e = erkenntnisse(d);
  if (e) content.push(e);

  if (zeilen.length) {
    content.push(grafik(abschnitt(++nr, 'Was fehlt im Ernstfall?'), zeilen, d.grafikText));
  }

  const [erstes, ...weitere] = d.antrag.pakete.map((p, i) => paket(d, p, i));
  content.push(
    zusammen(abschnitt(++nr, 'Unsere Empfehlungen'), { text: d.antrag.regelHinweis, color: FARBE.grau, fontSize: 8.5, margin: [0, 0, 0, 12] }, ...(erstes ? [erstes] : [])),
    ...weitere,
  );

  if (d.texte?.fazit) {
    content.push({
      table: { widths: ['*'], body: [[{ stack: [{ text: [{ text: 'Zusammenfassung', bold: true, color: FARBE.lila }, ki('KI')], margin: [0, 0, 0, 3] }, d.texte.fazit] }]] },
      layout: { fillColor: () => FARBE.gruenFlaeche, hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 12, paddingRight: () => 12, paddingTop: () => 10, paddingBottom: () => 10 },
      margin: [0, 0, 0, 8],
      unbreakable: true,
    });
  }

  const u = stand?.uebergabe;
  if (u?.noetig) {
    content.push(zusammen(
      abschnitt(++nr, 'Übergabe an eine Pax-Fachperson'),
      ...(u.text ? [{ text: [u.text, ki('KI')], margin: [0, 0, 0, 6] as [number, number, number, number] } as Content] : []),
      ...(u.kriterien.length ? [{ ul: u.kriterien.map((k) => k.titel), markerColor: FARBE.kontrastGruen }] : []),
    ));
  }

  content.push(
    zusammen(abschnitt(++nr, 'So geht es weiter'), {
      ol: [
        'Eine Pax-Fachperson prüft dieses Protokoll und Ihre Auswahl, bevor ein Vertrag entsteht.',
        'Bei fondsgebundenen Produkten folgt eine Angemessenheitsprüfung.',
        'Sie erhalten eine verbindliche Offerte mit Prämie. Gesundheitsfragen und Identifikation erledigen Sie direkt mit Pax.',
        'Nach der Unterschrift haben Sie 14 Tage Widerrufsrecht.',
      ],
      markerColor: FARBE.lila,
      margin: [0, 0, 0, 16],
    }),
    {
      stack: [
        { text: 'Rechtliche Hinweise', bold: true, margin: [0, 0, 0, 2] },
        'Texte mit dem Vermerk „KI“ hat ein KI-Modell auf Basis Ihrer Angaben und der Berechnungen formuliert; Zahlen in diesen Texten werden automatisch gegen die Berechnungen geprüft. Berechnungen: Pax-Rechenschnittstelle (APICalc). Dieses Protokoll ist keine Offerte und keine verbindliche Eignungsprüfung.',
        'Demo-Dokument aus einem Hackathon-Prototyp mit erfundenen Angaben.',
      ],
      fontSize: 7.5,
      color: FARBE.grau,
      unbreakable: true,
    },
  );

  const titel = `Pax Beratungsprotokoll ${d.antrag.nummer}`;
  return {
    pageSize: 'A4',
    pageMargins: [RAND.links, RAND.oben, RAND.rechts, RAND.unten],
    info: { title: titel, author: 'Pax', subject: 'Beratungsprotokoll der digitalen Vorsorgeberatung', creator: 'Pax Vorsorgeberatung (Demo)', producer: 'Pax' },
    language: 'de-CH',
    header: (seite) => seite === 1 ? null : {
      columns: [
        { svg: logo, width: 44 },
        { text: `Beratungsprotokoll · Antrag ${d.antrag.nummer}`, alignment: 'right', fontSize: 8, color: FARBE.grau, margin: [0, 4, 0, 0] },
      ],
      margin: [RAND.links, 30, RAND.rechts, 0],
    },
    footer: (seite, seiten) => ({
      stack: [
        { canvas: [{ type: 'line', x1: 0, y1: 0, x2: BREITE, y2: 0, lineWidth: 0.5, lineColor: FARBE.linie }] },
        {
          columns: [
            { text: ADRESSE },
            { text: `Seite ${seite} von ${seiten}`, alignment: 'right', width: 'auto' },
          ],
          margin: [0, 6, 0, 0],
        },
      ],
      fontSize: 7.5,
      color: FARBE.hellgrau,
      margin: [RAND.links, 22, RAND.rechts, 0],
    }),
    content,
    defaultStyle: { font: 'Pax', fontSize: 9.5, lineHeight: 1.3, color: FARBE.text },
    styles: {
      h1: { fontSize: 22, bold: true, color: FARBE.lila, lineHeight: 1 },
      h2: { fontSize: 13, bold: true, color: FARBE.lila, margin: [0, 14, 0, 0] },
      h3: { fontSize: 11.5, bold: true, color: FARBE.lila },
      h4: { fontSize: 8.5, bold: true, color: FARBE.grau, margin: [0, 8, 0, 2], characterSpacing: 0.2 },
      label: { fontSize: 7.5, color: FARBE.grau, lineHeight: 1.1, margin: [0, 0, 0, 2] },
      metaWert: { fontSize: 9, bold: true, lineHeight: 1.2 },
      saeuleTitel: { fontSize: 9.5, bold: true, color: FARBE.lila, margin: [0, 0, 0, 4], lineHeight: 1.15 },
      quelle: { fontSize: 6.5, color: FARBE.hellgrau, bold: true, characterSpacing: 0.4 },
    },
  };
}

/** Builds the PDF and starts the download: a real A4 file, no print dialog. pdfmake loads only when needed. */
export async function protokollHerunterladen(d: ProtokollDaten): Promise<void> {
  const basis = document.baseURI;
  const [{ default: pdfMake }, logo] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    fetch(new URL('pax-logo.svg', basis)).then((r) => { if (!r.ok) throw new Error('Logo'); return r.text(); }),
  ]);
  const schrift = (datei: string) => new URL(`fonts/${datei}`, basis).href;
  // Only the Pax fonts of this app may be fetched while building the document.
  pdfMake.setUrlAccessPolicy((url: string) => url.startsWith(new URL('fonts/', basis).href));
  pdfMake.addFonts({
    Pax: { normal: schrift('PaxCivil-Regular.ttf'), bold: schrift('PaxCivil-Medium.ttf'), italics: schrift('PaxCivil-Regular.ttf'), bolditalics: schrift('PaxCivil-Bold.ttf') },
  });
  await pdfMake.createPdf(protokollDokument(d, logo)).download(`Pax-Beratungsprotokoll-${d.antrag.nummer}.pdf`);
}
