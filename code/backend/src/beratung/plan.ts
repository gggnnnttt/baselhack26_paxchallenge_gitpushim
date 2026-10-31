import { z } from 'zod';

// A proposal, never an authoritative fact or permission to call a tool.
export const Beratungsplan = z.object({
  fokusAnliegen: z.string().trim().min(1).max(20).nullable(),
  ungeklaert: z.array(z.string().trim().min(1).max(200)).max(3),
  aktion: z.enum(['nachfragen', 'erklaeren', 'szenario_berechnen', 'szenario_zeigen', 'empfehlung_vorbereiten', 'beratungsperson']),
  rechnung: z.string().trim().min(1).max(80).nullable(),
  frage: z.string().trim().min(1).max(300).nullable(),
  begruendung: z.string().trim().min(1).max(300),
}).strict();
export type Beratungsplan = z.infer<typeof Beratungsplan>;
