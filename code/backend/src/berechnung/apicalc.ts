import { SavingRequest, SavingResponse, type SparRechner } from './sparen.js';
import { z } from 'zod';
import { RetirementRequest, RetirementResponse, type PensionierungsRechner } from './pensionierung.js';
import { RiskResponse, type RiskRequest } from './risiko.js';

export interface RisikoRechner {
  berechneRisiko(request: RiskRequest): Promise<RiskResponse>;
  berechnePensionierung?: PensionierungsRechner['berechnePensionierung'];
  berechneSparen?: SparRechner['berechneSparen'];
}
export interface VorsorgeRechner extends RisikoRechner, PensionierungsRechner, SparRechner {
  berechnePensionierung: PensionierungsRechner['berechnePensionierung'];
  berechneSparen: SparRechner['berechneSparen'];
}

export interface ApiCalcOptionen {
  baseUrl: string;
  token: string;
  tenant?: string | undefined;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

// Server-side only. Neither the token nor request or response bodies are logged or passed on in errors.
export function createApiCalcClient({ baseUrl, token, tenant, timeoutMs = 15000, fetch: fetchImpl = fetch }: ApiCalcOptionen): VorsorgeRechner {
  async function senden<T>(operation: string, request: unknown, schema: z.ZodType<T>): Promise<T> {
    const url = new URL(`${baseUrl.replace(/\/$/, '')}/operation/standard/${operation}`);
    if (tenant) url.searchParams.set('tenant', tenant);
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(request), signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`APICalc antwortete mit HTTP ${response.status}.`);
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) throw new Error('APICalc lieferte eine unerwartete Antwortstruktur.');
    return parsed.data;
  }
  return {
    berechneSparen: request => senden('APICalc_calculateSaving', SavingRequest.parse(request), SavingResponse),
    berechneRisiko: request => senden('APICalc_calculateRisk', request, RiskResponse),
    berechnePensionierung: request => senden('APICalc_calculateRetirement', RetirementRequest.parse(request), RetirementResponse),
  };
}
