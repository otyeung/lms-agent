import {
  OpenAICompatibleLlm,
  buildOpenAIChatRequest,
} from '../openai-compatible-llm.js'
import { Type } from '@google/genai'
import type { LlmRequest } from '@google/adk'

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message)
  }
}

const request: LlmRequest = {
  contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
  config: {
    systemInstruction: 'You are a concise assistant.',
    tools: [
      {
        functionDeclarations: [
          {
            name: 'lookup_campaign_count',
            description: 'Looks up the campaign count.',
            parameters: {
              type: Type.OBJECT,
              properties: {
                query: { type: Type.STRING },
              },
              required: ['query'],
            },
          },
        ],
      },
    ],
  },
  liveConnectConfig: {},
  toolsDict: {},
}

const openAIRequest = buildOpenAIChatRequest(request, 'gpt-5-mini')
const convertedParameters = openAIRequest.tools?.[0].function.parameters as {
  type?: string
}

assert(openAIRequest.model === 'gpt-5-mini', 'model should be passed through')
assert(openAIRequest.messages[0].role === 'system', 'system instruction should map to system message')
assert(openAIRequest.messages[1].role === 'user', 'user content should map to user message')
assert(openAIRequest.tools?.[0].function.name === 'lookup_campaign_count', 'tool name should be mapped')
assert(
  convertedParameters.type === 'object',
  'Gemini OBJECT schema should map to OpenAI object schema',
)

const fetchCalls: Array<{ url: string; body: string }> = []
const fakeFetch: typeof fetch = async (url, init) => {
  fetchCalls.push({ url: String(url), body: String(init?.body) })
  return new Response(
    JSON.stringify({
      model: 'gpt-5-mini',
      choices: [
        {
          message: {
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: {
                  name: 'lookup_campaign_count',
                  arguments: '{"query":"count"}',
                },
              },
            ],
          },
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

const llm = new OpenAICompatibleLlm({
  apiUrl: 'https://example.test/v1',
  apiToken: 'test-token',
  model: 'gpt-5-mini',
  fetchFn: fakeFetch,
})

const responses = []
for await (const response of llm.generateContentAsync(request)) {
  responses.push(response)
}

assert(fetchCalls[0].url === 'https://example.test/v1/chat/completions', 'should call chat completions URL')
assert(responses.length === 1, 'should yield one response')
assert(
  responses[0].content?.parts?.[0].functionCall?.name === 'lookup_campaign_count',
  'OpenAI tool call should map to ADK functionCall',
)
assert(
  responses[0].content?.parts?.[0].functionCall?.args?.query === 'count',
  'OpenAI tool arguments should parse as JSON',
)

console.log('LLM adapter smoke passed')
