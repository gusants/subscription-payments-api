import {
  parseSummaryOutput,
  SUGGESTED_ACTION_MAX_LENGTH,
  SUMMARY_MAX_LENGTH,
  SUMMARY_OUTPUT_JSON_SCHEMA,
} from './summary-output.js';

const valid = {
  summary: 'Pays on time.',
  paymentBehavior: 'on_time',
  riskLevel: 'low',
  suggestedAction: 'No action needed.',
};

describe('parseSummaryOutput', () => {
  it('returns the validated output', () => {
    expect(parseSummaryOutput(JSON.stringify(valid))).toEqual(valid);
  });

  it('trims the texts', () => {
    expect(
      parseSummaryOutput(JSON.stringify({ ...valid, summary: '  ok  ' })),
    ).toMatchObject({ summary: 'ok' });
  });

  it('drops fields outside the schema', () => {
    const parsed = parseSummaryOutput(
      JSON.stringify({ ...valid, totalPaidCents: 99 }),
    );

    expect(parsed).toEqual(valid);
  });

  it.each([
    ['text that is not JSON', '{"summary": "trunc'],
    ['JSON that is not an object', '[]'],
    [
      'an unknown behavior',
      JSON.stringify({ ...valid, paymentBehavior: 'pontual' }),
    ],
    ['an unknown risk', JSON.stringify({ ...valid, riskLevel: 'medio' })],
    [
      'a missing field',
      JSON.stringify({ ...valid, suggestedAction: undefined }),
    ],
    ['an empty summary', JSON.stringify({ ...valid, summary: ' ' })],
    [
      'a summary over the limit',
      JSON.stringify({ ...valid, summary: 'x'.repeat(SUMMARY_MAX_LENGTH + 1) }),
    ],
    [
      'an action over the limit',
      JSON.stringify({
        ...valid,
        suggestedAction: 'x'.repeat(SUGGESTED_ACTION_MAX_LENGTH + 1),
      }),
    ],
  ])('rejects %s', (_case, text) => {
    expect(parseSummaryOutput(text)).toBeNull();
  });
});

describe('SUMMARY_OUTPUT_JSON_SCHEMA', () => {
  it('lists the enums and required fields without references', () => {
    expect(SUMMARY_OUTPUT_JSON_SCHEMA).toMatchObject({
      type: 'object',
      required: ['summary', 'paymentBehavior', 'riskLevel', 'suggestedAction'],
      properties: {
        paymentBehavior: {
          enum: [
            'on_time',
            'occasional_delays',
            'frequent_delays',
            'unreliable',
            'insufficient_history',
          ],
        },
        riskLevel: { enum: ['low', 'medium', 'high'] },
      },
    });
    expect(JSON.stringify(SUMMARY_OUTPUT_JSON_SCHEMA)).not.toMatch(
      /\$ref|\$schema/,
    );
  });
});
