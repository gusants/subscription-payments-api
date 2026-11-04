import {
  CUSTOMER_SUMMARY_PROMPT_FILE,
  loadCustomerSummaryPrompt,
} from './prompt-loader.js';

describe('loadCustomerSummaryPrompt', () => {
  it('exposes the prompt version', async () => {
    await expect(loadCustomerSummaryPrompt()).resolves.toMatchObject({
      version: 'v1',
    });
  });

  it('keeps the version in the file name', () => {
    expect(CUSTOMER_SUMMARY_PROMPT_FILE).toBe('customer-summary.v1.md');
  });

  it('loads the prompt text', async () => {
    const { text } = await loadCustomerSummaryPrompt();

    expect(text.length).toBeGreaterThan(0);
  });

  it('asks for the agreed output fields and enums', async () => {
    const { text } = await loadCustomerSummaryPrompt();

    for (const expected of [
      'summary',
      'suggestedAction',
      'paymentBehavior',
      'riskLevel',
      'on_time',
      'occasional_delays',
      'frequent_delays',
      'low',
      'medium',
      'high',
    ]) {
      expect(text).toContain(`\`${expected}\``);
    }
  });

  it('tells the model the numbers are final and it only suggests to a human', async () => {
    const { text } = await loadCustomerSummaryPrompt();

    expect(text).toMatch(/Never recalculate/);
    expect(text).toMatch(/only suggest an action to a human/);
  });
});
