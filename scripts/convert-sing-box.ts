#!/usr/bin/env node

import { readFile, rename, writeFile } from 'node:fs/promises';
import process from 'node:process';

type Options = {
  inputFile: string;
  outputFile: string;
};

function parseArguments(argv: string[]): Options {
  const options: Partial<Options> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];

    if (argument === '--input' && value) {
      options.inputFile = value;
      index += 1;
    } else if (argument === '--output' && value) {
      options.outputFile = value;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }

  if (!options.inputFile || !options.outputFile) {
    throw new Error('Missing required arguments: --input and --output');
  }

  return { inputFile: options.inputFile, outputFile: options.outputFile };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const source = await readFile(options.inputFile, 'utf8');
  const domains = new Set<string>();
  const suffixes = new Set<string>();

  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line === 'payload:' || line.startsWith('#')) {
      continue;
    }

    const origin = `${options.inputFile}:${index + 1}`;
    const match = line.match(/^-\s+'((?:''|[^'])+)'(?:\s+#.*)?$/);
    if (!match) {
      throw new Error(`Unsupported YAML at ${origin}`);
    }

    const rule = match[1].replaceAll("''", "'");
    // Only convert exact domains and +.suffix rules; reject other patterns
    // instead of silently changing their matching behavior.
    if (!/^(?:\+\.)?[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(rule)) {
      throw new Error(`Unsupported domain rule at ${origin}: ${JSON.stringify(rule)}`);
    }

    if (rule.startsWith('+.')) {
      suffixes.add(rule.slice(2));
    } else {
      domains.add(rule);
    }
  }

  if (domains.size + suffixes.size === 0) {
    throw new Error(`No domain rules found in ${options.inputFile}`);
  }

  const rule = {
    ...(domains.size > 0 ? { domain: [...domains] } : {}),
    ...(suffixes.size > 0 ? { domain_suffix: [...suffixes] } : {}),
  };
  // Version 2 supports these fields and is compatible with sing-box 1.10+.
  const result = `${JSON.stringify({ version: 2, rules: [rule] }, null, 2)}\n`;
  const temporaryOutput = `${options.outputFile}.tmp`;
  await writeFile(temporaryOutput, result, 'utf8');
  await rename(temporaryOutput, options.outputFile);

  console.log(
    `Wrote ${domains.size} exact domains and ${suffixes.size} domain suffixes ` +
      `to ${options.outputFile}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
