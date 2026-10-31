import OpenAI from 'openai';
import type { ModelAdapter } from '../chat.js';

export function createOpenAIAdapter(client: OpenAI, model: string): ModelAdapter {
  return {
    async generate({ instructions, messages, maxOutputTokens, responseFormat }) {
      const response = await client.responses.create({
        model,
        instructions,
        input: messages,
        max_output_tokens: maxOutputTokens,
        store: false,
        ...(responseFormat === 'scope' ? {
          text: { format: {
            type: 'json_schema' as const,
            name: 'advisory_scope',
            strict: true,
            schema: {
              type: 'object',
              properties: { allowed: { type: 'boolean' } },
              required: ['allowed'],
              additionalProperties: false,
            },
          } },
        } : {}),
      });
      if (response.status !== 'completed') throw new Error('Unvollständige Modellantwort.');
      return response.output_text;
    },
  };
}
