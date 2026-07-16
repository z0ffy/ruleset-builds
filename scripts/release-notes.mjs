#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

function parseArguments(argv) {
  const options = {
    previousFile: undefined,
    currentFile: undefined,
    outputFile: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];

    if (argument === '--previous' && value) {
      options.previousFile = value;
      index += 1;
    } else if (argument === '--current' && value) {
      options.currentFile = value;
      index += 1;
    } else if (argument === '--output' && value) {
      options.outputFile = value;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }

  if (!options.currentFile) {
    throw new Error('Missing required argument: --current');
  }

  return options;
}

function parseRules(source, fileName) {
  const rules = new Set();

  for (const [index, rawLine] of source.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line === 'payload:' || line.startsWith('#')) {
      continue;
    }

    const match = line.match(/^-\s+'((?:''|[^'])+)'(?:\s+#.*)?$/);
    if (!match) {
      throw new Error(`Unsupported YAML at ${fileName}:${index + 1}`);
    }

    const rule = match[1].replaceAll("''", "'");
    if (rules.has(rule)) {
      throw new Error(`Duplicate rule at ${fileName}:${index + 1}: ${rule}`);
    }

    rules.add(rule);
  }

  return rules;
}

function difference(left, right) {
  return [...left].filter((rule) => !right.has(rule)).sort();
}

function formatDetails(title, rules) {
  if (rules.length === 0) {
    return [];
  }

  return [
    '<details>',
    `<summary>${title}</summary>`,
    '',
    ...rules.map((rule) => `- \`${rule}\``),
    '',
    '</details>',
  ];
}

function formatReleaseNotes(currentRules, previousRules) {
  const lines = ['## Ruleset changes', ''];

  if (!previousRules) {
    lines.push(`- Total: ${currentRules.size.toLocaleString('en-US')}`);
    lines.push('', 'Initial release.', '', 'Automated update.');
    return `${lines.join('\n')}\n`;
  }

  const added = difference(currentRules, previousRules);
  const removed = difference(previousRules, currentRules);

  lines.push(`- Added: ${added.length.toLocaleString('en-US')}`);
  lines.push(`- Removed: ${removed.length.toLocaleString('en-US')}`);
  lines.push(
    `- Total: ${currentRules.size.toLocaleString('en-US')} ` +
      `(previously ${previousRules.size.toLocaleString('en-US')})`,
  );

  if (added.length === 0 && removed.length === 0) {
    lines.push('', 'Rules unchanged; build artifacts were updated.');
  } else {
    lines.push('', ...formatDetails('Added rules', added));
    if (added.length > 0 && removed.length > 0) {
      lines.push('');
    }
    lines.push(...formatDetails('Removed rules', removed));
  }

  lines.push('', 'Automated update.');
  return `${lines.join('\n')}\n`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const currentSource = await readFile(options.currentFile, 'utf8');
  const currentRules = parseRules(currentSource, options.currentFile);
  let previousRules;

  if (options.previousFile) {
    const previousSource = await readFile(options.previousFile, 'utf8');
    previousRules = parseRules(previousSource, options.previousFile);
  }

  const releaseNotes = formatReleaseNotes(currentRules, previousRules);
  if (options.outputFile) {
    await writeFile(options.outputFile, releaseNotes, 'utf8');
    console.log(`Wrote release notes to ${options.outputFile}`);
  } else {
    process.stdout.write(releaseNotes);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
