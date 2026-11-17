import type { AppConfig } from '../config.js';
import type { BudgetGuardrail } from '../guardrail.js';
import type { JsonStore } from '../store.js';
import type { Brain } from '../types.js';
import { ClaudeCliBrain } from './claude-cli.js';
import { GeminiBrain } from './gemini.js';
import { OllamaBrain } from './ollama.js';

export function createBrain(
  config: AppConfig,
  store: JsonStore,
  guardrail: BudgetGuardrail,
): Brain {
  if (config.brainProvider === 'gemini') {
    return new GeminiBrain(config, store, guardrail);
  }
  if (config.brainProvider === 'claude-cli') {
    return new ClaudeCliBrain(config, store);
  }
  return new OllamaBrain(config, store);
}
