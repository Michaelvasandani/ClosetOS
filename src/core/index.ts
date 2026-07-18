/**
 * ClosetOS core library — the reusable brain (ADR-0002).
 *
 * Owns all reasoning and data access, with NO dependency on any CLI or
 * arg-parsing framework, so a future WhatsApp/Lambda shell can reuse it
 * unchanged. Modules (model, availability, store, constraints, recommend,
 * llm) are added in later issues and re-exported from here.
 */

export * from "./availability.js";
export * from "./constraints.js";
export * from "./model.js";
export * from "./store.js";
