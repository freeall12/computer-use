export * from "./tool.js";
// ----- Actor lifecycle hook types -----
/**
 * Agent types excluded from actor.preStop / actor.postStop by default.
 * Includes the agents registered in src/agent/agent.ts plus runtime-only
 * pseudo-agents ("main" = root actor, "compaction" = auto-compaction subsystem)
 * that are never spawned via the agent registry.
 */
export const BUILT_IN_AGENTS = [
    "main", "general", "build", "explore", "summary",
    "title", "checkpoint-writer", "dream", "distill", "compaction",
];
