import { readFile } from 'node:fs/promises';

export interface Prompt {
  version: string;
  text: string;
}

const CUSTOMER_SUMMARY_VERSION = 'v2';

export const CUSTOMER_SUMMARY_PROMPT_FILE = `customer-summary.${CUSTOMER_SUMMARY_VERSION}.md`;

export const PROMPTS_DIRECTORY = new URL('./prompts/', import.meta.url);

export async function loadCustomerSummaryPrompt(): Promise<Prompt> {
  const text = await readFile(
    new URL(CUSTOMER_SUMMARY_PROMPT_FILE, PROMPTS_DIRECTORY),
    'utf8',
  );
  return { version: CUSTOMER_SUMMARY_VERSION, text };
}
