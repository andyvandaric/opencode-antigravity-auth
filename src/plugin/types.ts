import type { PluginInput } from "@opencode-ai/plugin";
import type { AntigravityTokenExchangeResult } from "../antigravity/oauth";

export interface OAuthAuthDetails {
  type: "oauth";
  refresh: string;
  access?: string;
  expires?: number;
}

export interface ApiKeyAuthDetails {
  type: "api_key";
  key: string;
}

export interface NonOAuthAuthDetails {
  type: string;
  [key: string]: unknown;
}

export type AuthDetails = OAuthAuthDetails | ApiKeyAuthDetails | NonOAuthAuthDetails;

export type GetAuth = () => Promise<AuthDetails>;

export interface ProviderModel {
  cost?: {
    input: number;
    output: number;
  };
  [key: string]: unknown;
}

export interface Provider {
  models?: Record<string, ProviderModel>;
}

export interface LoaderResult {
  apiKey: string;
  fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
}

export type PluginClient = PluginInput["client"];

export interface PluginContext {
  client: PluginClient;
  directory: string;
}

export type AuthPrompt =
  | {
      type: "text";
      key: string;
      message: string;
      placeholder?: string;
      validate?: (value: string) => string | undefined;
      condition?: (inputs: Record<string, string>) => boolean;
    }
  | {
      type: "select";
      key: string;
      message: string;
      options: Array<{ label: string; value: string; hint?: string }>;
      condition?: (inputs: Record<string, string>) => boolean;
    };

export type OAuthAuthorizationResult = { url: string; instructions: string } & (
  | {
      method: "auto";
      callback: () => Promise<AntigravityTokenExchangeResult>;
    }
  | {
      method: "code";
      callback: (code: string) => Promise<AntigravityTokenExchangeResult>;
    }
);

export interface AuthMethod {
  provider?: string;
  label: string;
  type: "oauth" | "api";
  prompts?: AuthPrompt[];
  authorize?: (inputs?: Record<string, string>) => Promise<OAuthAuthorizationResult>;
}

export interface PluginEventPayload {
  event: {
    type: string;
    properties?: unknown;
  };
}

export interface PluginResult {
  auth: {
    provider: string;
    loader: (getAuth: GetAuth, provider: Provider) => Promise<LoaderResult | Record<string, unknown>>;
    methods: AuthMethod[];
  };
  event?: (payload: PluginEventPayload) => void;
  tool?: Record<string, unknown>;
}

export interface RefreshParts {
  refreshToken: string;
  projectId?: string;
  managedProjectId?: string;
}

export interface ProjectContextResult {
  auth: OAuthAuthDetails;
  effectiveProjectId: string;
}

export type UnknownRecord = Record<string, unknown>

export interface RequestContentWithParts extends UnknownRecord {
  role?: unknown;
  parts: unknown[];
}

export interface RequestMessageWithContent extends UnknownRecord {
  role?: unknown;
  content: unknown[];
}

export function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

export function isContentWithParts(value: unknown): value is RequestContentWithParts {
  return isRecord(value) && Array.isArray(value.parts);
}

export function isMessageWithContent(value: unknown): value is RequestMessageWithContent {
  return isRecord(value) && Array.isArray(value.content);
}

export function isGeminiToolUseBoundaryPart(part: unknown): part is UnknownRecord {
  if (!isRecord(part)) {
    return false;
  }

  return "functionCall" in part || "tool_use" in part || "toolUse" in part;
}

export function isGeminiThinkingBoundaryPart(part: unknown): part is UnknownRecord {
  if (!isRecord(part)) {
    return false;
  }

  return part.thought === true || part.type === "thinking" || part.type === "reasoning";
}

export function isThinkingMessageBlock(part: unknown): part is UnknownRecord {
  if (!isRecord(part)) {
    return false;
  }

  return part.type === "thinking" || part.type === "redacted_thinking";
}

export function hasBoundarySignature(part: unknown, minLength = 1): boolean {
  if (!isRecord(part)) {
    return false;
  }

  if (part.thought === true) {
    return typeof part.thoughtSignature === "string" && part.thoughtSignature.length >= minLength;
  }

  if (part.type === "thinking" || part.type === "reasoning" || part.type === "redacted_thinking") {
    return typeof part.signature === "string" && part.signature.length >= minLength;
  }

  return false;
}

