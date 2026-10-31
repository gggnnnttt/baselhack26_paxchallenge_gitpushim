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
        ...(responseFormat ? {
          text: { format: { type: 'json_schema' as const, name: responseFormat.name, strict: true, schema: responseFormat.schema } },
        } : {}),
      });
      if (response.status !== 'completed') throw new Error('Unvollständige Modellantwort.');
      return response.output_text;
    },
  };
}
