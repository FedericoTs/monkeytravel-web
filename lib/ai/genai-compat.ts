/**
 * The Gemini SDK, in the shape this codebase calls it.
 *
 * Call sites were written against the retired @google/generative-ai package
 * (getGenerativeModel → generateContent / startChat, result.response.text()).
 * This module keeps that shape on top of the supported @google/genai SDK, so
 * the SDK is imported in exactly one place.
 */
import {
  GoogleGenAI,
  Type,
  type Chat,
  type Content,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type Part,
  type Schema,
} from "@google/genai";

export type { Content, Part };
export type ResponseSchema = Schema;

export const SchemaType = {
  STRING: Type.STRING,
  NUMBER: Type.NUMBER,
  INTEGER: Type.INTEGER,
  BOOLEAN: Type.BOOLEAN,
  ARRAY: Type.ARRAY,
  OBJECT: Type.OBJECT,
} as const;

export interface GenerationConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxOutputTokens?: number;
  candidateCount?: number;
  stopSequences?: string[];
  responseMimeType?: string;
  responseSchema?: ResponseSchema;
  thinkingConfig?: { thinkingBudget?: number; includeThoughts?: boolean };
}

export interface ModelParams {
  model: string;
  generationConfig?: GenerationConfig;
  systemInstruction?: string | Content;
}

export type GenerateContentRequest =
  | string
  | Array<string | Part>
  | { contents: Content[]; generationConfig?: GenerationConfig; systemInstruction?: string | Content };

export interface UsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
  thoughtsTokenCount?: number;
}

export interface EnhancedGenerateContentResponse {
  /** The model's text, or "" when the response carries none (blocked, empty). */
  text(): string;
  usageMetadata?: UsageMetadata;
  candidates?: GenerateContentResponse["candidates"];
}

export interface GenerateContentResult {
  response: EnhancedGenerateContentResponse;
}

export interface GenerateContentStreamResult {
  /** Each chunk's text() is that chunk's new text. */
  stream: AsyncGenerator<EnhancedGenerateContentResponse>;
  /** The whole response, available once the stream has been consumed. */
  response: Promise<EnhancedGenerateContentResponse>;
}

function wrap(res: GenerateContentResponse): EnhancedGenerateContentResponse {
  return {
    text: () => res.text ?? "",
    usageMetadata: res.usageMetadata as UsageMetadata | undefined,
    candidates: res.candidates,
  };
}

function toContents(request: GenerateContentRequest): Content[] {
  if (typeof request === "string") return [{ role: "user", parts: [{ text: request }] }];
  if (Array.isArray(request)) {
    return [{ role: "user", parts: request.map((p) => (typeof p === "string" ? { text: p } : p)) }];
  }
  return request.contents;
}

function toConfig(
  generationConfig: GenerationConfig | undefined,
  systemInstruction: string | Content | undefined
): GenerateContentConfig | undefined {
  if (!generationConfig && !systemInstruction) return undefined;
  return { ...(generationConfig ?? {}), ...(systemInstruction ? { systemInstruction } : {}) };
}

/** Turns the SDK's chunk generator into the old {stream, response} pair. */
function streamResult(chunks: Promise<AsyncGenerator<GenerateContentResponse>>): GenerateContentStreamResult {
  let resolveFinal!: (r: EnhancedGenerateContentResponse) => void;
  let rejectFinal!: (e: unknown) => void;
  const response = new Promise<EnhancedGenerateContentResponse>((resolve, reject) => {
    resolveFinal = resolve;
    rejectFinal = reject;
  });
  response.catch(() => undefined); // the consumer may only read the stream

  async function* stream(): AsyncGenerator<EnhancedGenerateContentResponse> {
    let text = "";
    let last: GenerateContentResponse | undefined;
    try {
      for await (const chunk of await chunks) {
        last = chunk;
        text += chunk.text ?? "";
        yield wrap(chunk);
      }
    } catch (err) {
      rejectFinal(err);
      throw err;
    }
    resolveFinal({
      text: () => text,
      usageMetadata: last?.usageMetadata as UsageMetadata | undefined,
      candidates: last?.candidates,
    });
  }
  return { stream: stream(), response };
}

export class ChatSession {
  constructor(private readonly chat: Chat) {}

  async sendMessage(message: string | Part[]): Promise<GenerateContentResult> {
    return { response: wrap(await this.chat.sendMessage({ message })) };
  }

  sendMessageStream(message: string | Part[]): GenerateContentStreamResult {
    return streamResult(this.chat.sendMessageStream({ message }));
  }
}

export class GenerativeModel {
  constructor(
    private readonly ai: GoogleGenAI,
    private readonly params: ModelParams
  ) {}

  private config(override?: GenerationConfig, systemInstruction?: string | Content) {
    return toConfig(
      override ? { ...(this.params.generationConfig ?? {}), ...override } : this.params.generationConfig,
      systemInstruction ?? this.params.systemInstruction
    );
  }

  async generateContent(request: GenerateContentRequest): Promise<GenerateContentResult> {
    const req = typeof request === "object" && !Array.isArray(request) ? request : undefined;
    const res = await this.ai.models.generateContent({
      model: this.params.model,
      contents: toContents(request),
      config: this.config(req?.generationConfig, req?.systemInstruction),
    });
    return { response: wrap(res) };
  }

  generateContentStream(request: GenerateContentRequest): GenerateContentStreamResult {
    const req = typeof request === "object" && !Array.isArray(request) ? request : undefined;
    return streamResult(
      this.ai.models.generateContentStream({
        model: this.params.model,
        contents: toContents(request),
        config: this.config(req?.generationConfig, req?.systemInstruction),
      })
    );
  }

  startChat(params: { history?: Content[]; generationConfig?: GenerationConfig } = {}): ChatSession {
    return new ChatSession(
      this.ai.chats.create({
        model: this.params.model,
        history: params.history,
        config: this.config(params.generationConfig),
      })
    );
  }
}

export class GoogleGenerativeAI {
  private readonly ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  getGenerativeModel(params: ModelParams): GenerativeModel {
    return new GenerativeModel(this.ai, params);
  }
}
