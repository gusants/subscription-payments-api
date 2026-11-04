import { z } from 'zod';

export const PAYMENT_BEHAVIORS = [
  'on_time',
  'occasional_delays',
  'frequent_delays',
  'unreliable',
  'insufficient_history',
] as const;

export const RISK_LEVELS = ['low', 'medium', 'high'] as const;

export const SUMMARY_MAX_LENGTH = 600;
export const SUGGESTED_ACTION_MAX_LENGTH = 300;

export const summaryOutputSchema = z.object({
  summary: z.string().trim().min(1).max(SUMMARY_MAX_LENGTH),
  paymentBehavior: z.enum(PAYMENT_BEHAVIORS),
  riskLevel: z.enum(RISK_LEVELS),
  suggestedAction: z.string().trim().min(1).max(SUGGESTED_ACTION_MAX_LENGTH),
});

export type PaymentBehavior = (typeof PAYMENT_BEHAVIORS)[number];
export type RiskLevel = (typeof RISK_LEVELS)[number];
export type SummaryOutput = z.infer<typeof summaryOutputSchema>;

const { $schema: _draftUri, ...outputJsonSchema } =
  z.toJSONSchema(summaryOutputSchema);

export const SUMMARY_OUTPUT_JSON_SCHEMA: Record<string, unknown> =
  outputJsonSchema;

export function parseSummaryOutput(text: string): SummaryOutput | null {
  try {
    const parsed = summaryOutputSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
