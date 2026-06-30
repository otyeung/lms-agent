import { BaseLlm } from '@google/adk'
import type { BaseLlmConnection, LlmRequest, LlmResponse } from '@google/adk'
import type { Content, FunctionDeclaration, Part } from '@google/genai'

interface OpenAICompatibleLlmConfig {
  apiUrl?: string
  apiToken?: string
  model?: string
  fallbackModel?: string
  fetchFn?: typeof fetch
}

interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_call_id?: string
  tool_calls?: OpenAIChatToolCall[]
}

interface OpenAIChatToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

interface OpenAIChatCompletion {
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: OpenAIChatToolCall[]
    }
    finish_reason?: string
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
  error?: {
    message?: string
    code?: string | number
    type?: string
  }
  model?: string
}

export class OpenAICompatibleLlm extends BaseLlm {
  private readonly apiUrl?: string
  private readonly apiToken?: string
  private readonly fallbackModel?: string
  private readonly fetchFn: typeof fetch

  constructor({
    apiUrl = process.env.LLM_API_URL?.trim(),
    apiToken = process.env.LLM_API_TOKEN?.trim(),
    model = process.env.LLM_MODEL?.trim() || 'gpt-5-mini',
    fallbackModel = process.env.LLM_FALLBACK_MODEL?.trim(),
    fetchFn = fetch,
  }: OpenAICompatibleLlmConfig = {}) {
    super({ model })
    this.apiUrl = apiUrl
    this.apiToken = apiToken
    this.fallbackModel = fallbackModel
    this.fetchFn = fetchFn
  }

  static readonly supportedModels = [/^gpt-.+/, /^claude-.+/, /^gemini-.+/]

  async *generateContentAsync(
    llmRequest: LlmRequest,
    _stream = false,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<LlmResponse, void> {
    if (!this.apiUrl || !this.apiToken) {
      yield {
        errorCode: 'LLM_PROVIDER_NOT_CONFIGURED',
        errorMessage:
          'Set LLM_API_URL and LLM_API_TOKEN in .env, then restart the ADK web server.',
      }
      return
    }

    this.maybeAppendUserContent(llmRequest)

    const primaryModel = llmRequest.model ?? this.model
    const fallbackModel =
      this.fallbackModel && this.fallbackModel !== primaryModel
        ? this.fallbackModel
        : undefined

    const requestBody = buildOpenAIChatRequest(llmRequest, primaryModel)
    const primaryResponse = await this.callChatCompletions(requestBody, abortSignal)

    if (primaryResponse.ok) {
      yield openAIResponseToLlmResponse(primaryResponse.body)
      return
    }

    if (fallbackModel) {
      const fallbackResponse = await this.callChatCompletions(
        { ...requestBody, model: fallbackModel },
        abortSignal,
      )

      if (fallbackResponse.ok) {
        yield openAIResponseToLlmResponse(fallbackResponse.body)
        return
      }

      yield {
        errorCode: String(fallbackResponse.status),
        errorMessage: fallbackResponse.errorMessage,
      }
      return
    }

    yield {
      errorCode: String(primaryResponse.status),
      errorMessage: primaryResponse.errorMessage,
    }
  }

  async connect(_llmRequest: LlmRequest): Promise<BaseLlmConnection> {
    throw new Error('OpenAI-compatible live connections are not supported.')
  }

  private async callChatCompletions(
    requestBody: Record<string, unknown>,
    abortSignal?: AbortSignal,
  ): Promise<
    | { ok: true; body: OpenAIChatCompletion }
    | { ok: false; status: number | string; errorMessage: string }
  > {
    const response = await this.fetchFn(toChatCompletionsUrl(this.apiUrl ?? ''), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: abortSignal,
    })

    const responseText = await response.text()
    const responseBody = safeJsonParse<OpenAIChatCompletion>(responseText)

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        errorMessage:
          responseBody?.error?.message ||
          responseBody?.error?.code?.toString() ||
          responseText ||
          response.statusText,
      }
    }

    if (!responseBody) {
      return {
        ok: false,
        status: 'INVALID_RESPONSE',
        errorMessage: 'OpenAI-compatible endpoint returned non-JSON response.',
      }
    }

    return { ok: true, body: responseBody }
  }
}

export function isOpenAICompatibleLlmConfigured(): boolean {
  return Boolean(process.env.LLM_API_URL?.trim() && process.env.LLM_API_TOKEN?.trim())
}

export function createConfiguredLlm(): OpenAICompatibleLlm {
  return new OpenAICompatibleLlm()
}

export function buildOpenAIChatRequest(llmRequest: LlmRequest, model: string) {
  const messages = contentsToOpenAIMessages(llmRequest)
  const tools = extractFunctionDeclarations(llmRequest).map((declaration) => ({
    type: 'function',
    function: {
      name: declaration.name,
      description: declaration.description,
      parameters: toOpenAIJsonSchema(declaration.parameters ?? {
        type: 'OBJECT',
        properties: {},
      }),
    },
  }))

  return {
    model,
    messages,
    ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
  }
}

function contentsToOpenAIMessages(llmRequest: LlmRequest): OpenAIChatMessage[] {
  const messages: OpenAIChatMessage[] = []
  const systemInstruction = stringifySystemInstruction(
    llmRequest.config?.systemInstruction,
  )

  if (systemInstruction) {
    messages.push({ role: 'system', content: systemInstruction })
  }

  for (const content of llmRequest.contents) {
    messages.push(...contentToOpenAIMessages(content))
  }

  return messages
}

function contentToOpenAIMessages(content: Content): OpenAIChatMessage[] {
  const parts = content.parts ?? []
  const text = parts
    .map((part) => part.text)
    .filter((partText): partText is string => Boolean(partText))
    .join('\n')
  const functionCalls = parts
    .map((part) => part.functionCall)
    .filter((functionCall): functionCall is NonNullable<Part['functionCall']> =>
      Boolean(functionCall?.name),
    )
  const functionResponses = parts
    .map((part) => part.functionResponse)
    .filter(
      (
        functionResponse,
      ): functionResponse is NonNullable<Part['functionResponse']> =>
        Boolean(functionResponse?.name),
    )

  const messages: OpenAIChatMessage[] = []

  if (functionCalls.length > 0) {
    messages.push({
      role: 'assistant',
      content: text || null,
      tool_calls: functionCalls.map((functionCall, index) => ({
        id: functionCall.id ?? `tool_call_${index}`,
        type: 'function',
        function: {
          name: functionCall.name ?? '',
          arguments: JSON.stringify(functionCall.args ?? {}),
        },
      })),
    })
  } else if (text) {
    messages.push({
      role: content.role === 'model' ? 'assistant' : 'user',
      content: text,
    })
  }

  for (const functionResponse of functionResponses) {
    messages.push({
      role: 'tool',
      tool_call_id: functionResponse.id ?? `${functionResponse.name}_call`,
      content: JSON.stringify(functionResponse.response ?? {}),
    })
  }

  return messages
}

function extractFunctionDeclarations(llmRequest: LlmRequest): FunctionDeclaration[] {
  return (llmRequest.config?.tools ?? []).flatMap((tool) =>
    'functionDeclarations' in tool && Array.isArray(tool.functionDeclarations)
      ? tool.functionDeclarations
      : [],
  )
}

function openAIResponseToLlmResponse(response: OpenAIChatCompletion): LlmResponse {
  const choice = response.choices?.[0]
  const message = choice?.message
  const parts: Part[] = []

  if (message?.content) {
    parts.push({ text: message.content })
  }

  for (const toolCall of message?.tool_calls ?? []) {
    parts.push({
      functionCall: {
        id: toolCall.id,
        name: toolCall.function.name,
        args: safeJsonParse<Record<string, unknown>>(
          toolCall.function.arguments,
        ) ?? {},
      },
    })
  }

  if (parts.length === 0) {
    parts.push({ text: '' })
  }

  return {
    content: {
      role: 'model',
      parts,
    },
    usageMetadata: {
      promptTokenCount: response.usage?.prompt_tokens,
      candidatesTokenCount: response.usage?.completion_tokens,
      totalTokenCount: response.usage?.total_tokens,
    },
    modelVersion: response.model,
  }
}

function toOpenAIJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map(toOpenAIJsonSchema)
  }

  if (!schema || typeof schema !== 'object') {
    return schema
  }

  const record = schema as Record<string, unknown>
  const converted: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(record)) {
    if (key === 'type' && typeof value === 'string') {
      converted[key] = value.toLowerCase()
    } else if (key === 'properties' && value && typeof value === 'object') {
      converted[key] = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(
          ([propertyName, propertyValue]) => [
            propertyName,
            toOpenAIJsonSchema(propertyValue),
          ],
        ),
      )
    } else if (key === 'items') {
      converted[key] = toOpenAIJsonSchema(value)
    } else {
      converted[key] = toOpenAIJsonSchema(value)
    }
  }

  return converted
}

function stringifySystemInstruction(systemInstruction: unknown): string | undefined {
  if (!systemInstruction) {
    return undefined
  }

  if (typeof systemInstruction === 'string') {
    return systemInstruction
  }

  if (
    typeof systemInstruction === 'object' &&
    systemInstruction !== null &&
    'parts' in systemInstruction &&
    Array.isArray((systemInstruction as Content).parts)
  ) {
    return (systemInstruction as Content).parts
      ?.map((part) => part.text)
      .filter((partText): partText is string => Boolean(partText))
      .join('\n')
  }

  return String(systemInstruction)
}

function toChatCompletionsUrl(apiUrl: string): string {
  const trimmedApiUrl = apiUrl.replace(/\/+$/, '')

  if (trimmedApiUrl.endsWith('/chat/completions')) {
    return trimmedApiUrl
  }

  return `${trimmedApiUrl}/chat/completions`
}

function safeJsonParse<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T
  } catch {
    return undefined
  }
}
