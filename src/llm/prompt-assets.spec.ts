import { readFileSync } from 'node:fs';
import { join, matchesGlob } from 'node:path';
import { CUSTOMER_SUMMARY_PROMPT_FILE } from './prompt-loader.js';

interface NestAsset {
  include: string;
  outDir?: string;
}

const projectFile = (name: string) => join(process.cwd(), name);

describe('prompt assets in the build output', () => {
  const nestCli = JSON.parse(
    readFileSync(projectFile('nest-cli.json'), 'utf8'),
  );
  const sourceRoot: string = nestCli.sourceRoot;
  const assets: NestAsset[] = nestCli.compilerOptions.assets;

  it('declares a nest-cli asset that matches the prompt file', () => {
    const promptPathInSourceRoot = `llm/prompts/${CUSTOMER_SUMMARY_PROMPT_FILE}`;

    expect(
      assets.some((asset) =>
        matchesGlob(promptPathInSourceRoot, asset.include),
      ),
    ).toBe(true);
    expect(
      readFileSync(
        projectFile(`${sourceRoot}/${promptPathInSourceRoot}`),
        'utf8',
      ),
    ).not.toBe('');
  });

  it('copies the assets into the same dist the Dockerfile ships', () => {
    const dockerfile = readFileSync(projectFile('Dockerfile'), 'utf8');

    expect(assets.every((asset) => asset.outDir === 'dist')).toBe(true);
    expect(dockerfile).toMatch(/^RUN pnpm build$/m);
    expect(dockerfile).toMatch(
      /^COPY --from=build --chown=node:node \/app\/dist \.\/dist$/m,
    );
  });
});
