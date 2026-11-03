import { ModelAccessProfileSchema, ModelPreflightSchema, DeclaredRatesSchema, type ModelAccessErrorCode } from '../../../../packages/contracts/src/model-access.ts';
export class ModelAccessError extends Error { constructor(readonly code: ModelAccessErrorCode) { super(code); this.name = 'ModelAccessError'; } }
/** Declaration checking only: no environment lookup, credentials, SDK construction, DNS or HTTP. */
export function preflightModelAccess(raw: unknown) {
  const p = ModelAccessProfileSchema.safeParse(raw);
  if (!p.success) return ModelPreflightSchema.parse({ configValid: false, mode: null, canExecuteFixture: false, canExecuteLive: false,
    credentialInspection: 'not-performed', networkAccess: 'disabled', issues: ['MODEL_CONFIG_INVALID'] });
  const config = p.data, issues: ('LIVE_TRANSPORT_DISABLED' | 'PROVIDER_MODEL_OR_PRICING_UNSELECTED')[] = [];
  if (config.mode === 'live-planned') {
    issues.push('LIVE_TRANSPORT_DISABLED');
    if ([config.providerId, config.modelId, config.apiFamily, config.pricing.id].includes('unselected')) issues.push('PROVIDER_MODEL_OR_PRICING_UNSELECTED');
  }
  return ModelPreflightSchema.parse({ configValid: true, mode: config.mode, canExecuteFixture: config.mode === 'offline-fixture', canExecuteLive: false,
    credentialInspection: 'not-performed', networkAccess: 'disabled', issues });
}
/** USD micro-units, caller-declared token rates; not an observed vendor charge. */
export function estimateCostMicros(rawRates: unknown, inputTokens: number, outputTokens: number): number {
  const p = DeclaredRatesSchema.safeParse(rawRates);
  if (!p.success || !Number.isSafeInteger(inputTokens) || inputTokens < 0 || inputTokens > 10_000_000 ||
    !Number.isSafeInteger(outputTokens) || outputTokens < 0 || outputTokens > 10_000_000) throw new ModelAccessError('MODEL_CONFIG_INVALID');
  const numerator = BigInt(inputTokens) * BigInt(p.data.inputMicrosPerMillionTokens) + BigInt(outputTokens) * BigInt(p.data.outputMicrosPerMillionTokens);
  return Number((numerator + 999999n) / 1000000n);
}
