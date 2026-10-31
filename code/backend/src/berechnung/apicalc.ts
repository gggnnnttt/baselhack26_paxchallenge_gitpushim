import { RiskResponse, type RiskRequest } from './risiko.js';

export interface RisikoRechner { berechneRisiko(request: RiskRequest): Promise<RiskResponse> }

export interface ApiCalcOptionen {
  baseUrl: string;
  token: string;
  tenant?: string | undefined;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

// Server-side only. Neither the token nor request or response bodies are logged or passed on in errors.
export function createApiCalcClient({ baseUrl, token, tenant, timeoutMs = 15000, fetch: fetchImpl = fetch }: ApiCalcOptionen): RisikoRechner {
  const url = new URL(`${baseUrl.replace(/\/$/, '')}/operation/standard/APICalc_calculateRisk`);
  if (tenant) url.searchParams.set('tenant', tenant);
  return {
    async berechneRisiko(request) {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`APICalc antwortete mit HTTP ${response.status}.`);
      const parsed = RiskResponse.safeParse(await response.json());
      if (!parsed.success) throw new Error('APICalc lieferte eine unerwartete Antwortstruktur.');
      return parsed.data;
    },
  };
}
