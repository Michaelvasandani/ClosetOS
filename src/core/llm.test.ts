import {
  APIConnectionError,
  APIError,
  AuthenticationError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { classifyLlmError } from "./llm.js";

/** An Anthropic error body as the SDK parses it onto `error.error`. */
function body(type: string, message: string) {
  return { type: "error", error: { type, message } };
}

describe("classifyLlmError", () => {
  it("reads a rejected key as an auth failure with status + short detail", () => {
    const error = new AuthenticationError(
      401,
      body("authentication_error", "invalid x-api-key"),
      undefined,
      new Headers(),
    );
    expect(classifyLlmError(error, true)).toEqual({
      kind: "auth",
      status: 401,
      detail: "invalid x-api-key",
    });
  });

  it("reads a 429 as a rate-limit failure", () => {
    const error = new RateLimitError(
      429,
      body("rate_limit_error", "slow down"),
      undefined,
      new Headers(),
    );
    expect(classifyLlmError(error, true)).toEqual({ kind: "rate-limit", status: 429 });
  });

  it("reads a transport failure as a connection error", () => {
    const error = new APIConnectionError({ message: "Connection error." });
    expect(classifyLlmError(error, true)).toEqual({
      kind: "connection",
      detail: "Connection error.",
    });
  });

  it("reads any other API status as a generic api failure", () => {
    const error = APIError.generate(500, body("api_error", "overloaded"), undefined, new Headers());
    expect(classifyLlmError(error, true)).toEqual({
      kind: "api",
      status: 500,
      detail: "overloaded",
    });
  });

  it("reads the SDK's auth-resolution error as a missing key when none is set", () => {
    const error = new Error(
      "Could not resolve authentication method. Expected one of apiKey, authToken, ...",
    );
    expect(classifyLlmError(error, false)).toEqual({ kind: "missing-key" });
  });

  it("does not claim a missing key when one is actually set", () => {
    const error = new Error("Could not resolve authentication method.");
    expect(classifyLlmError(error, true)).toBeNull();
  });

  it("returns null for a non-API error so real bugs still surface", () => {
    expect(classifyLlmError(new TypeError("cannot read x of undefined"), false)).toBeNull();
    expect(classifyLlmError(new Error("something unrelated broke"), false)).toBeNull();
  });
});
