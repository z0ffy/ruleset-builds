#!/usr/bin/env node

import { readFile, rename, writeFile } from 'node:fs/promises';
import process from 'node:process';

const DEFAULT_SOURCE_URL =
  'https://raw.githubusercontent.com/SukkaW/Surge/refs/heads/master/Source/domainset/download.conf';
const DEFAULT_LOCAL_FILE = 'rules/local/download.yaml';
const DEFAULT_OUTPUT_FILE = 'rules/domain/download.yaml';
const MAX_SOURCE_SIZE = 2 * 1024 * 1024;
const MIN_UPSTREAM_RULES = 1_000;

function parseArguments(argv) {
  const options = {
    sourceUrl: process.env.DOWNLOAD_SOURCE_URL || DEFAULT_SOURCE_URL,
    sourceFile: undefined,
    localFile: DEFAULT_LOCAL_FILE,
    outputFile: DEFAULT_OUTPUT_FILE,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = argv[index + 1];

    if (argument === '--source-url' && value) {
      options.sourceUrl = value;
      index += 1;
    } else if (argument === '--source-file' && value) {
      options.sourceFile = value;
      index += 1;
    } else if (argument === '--local' && value) {
      options.localFile = value;
      index += 1;
    } else if (argument === '--output' && value) {
      options.outputFile = value;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
  }

  return options;
}

async function loadSource(options) {
  if (options.sourceFile) {
    return readFile(options.sourceFile, 'utf8');
  }

  const response = await fetch(options.sourceUrl, {
    headers: { 'user-agent': 'ruleset-builds' },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to download source: HTTP ${response.status}`);
  }

  const source = await response.text();
  if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_SIZE) {
    throw new Error(`Source exceeds ${MAX_SOURCE_SIZE} bytes`);
  }

  return source;
}

function splitRuleAndComment(line) {
  const match = line.match(/^(.*?)(\s+#\s*.*)$/);
  return match ? [match[1].trim(), match[2].trimStart()] : [line.trim(), ''];
}

function normalizeRule(rule) {
  return rule.startsWith('.') ? `+${rule}` : rule;
}

function validateRule(rule, origin) {
  if (!/^(?:\+\.)?[A-Za-z0-9_*.-]+$/.test(rule)) {
    throw new Error(`Invalid rule in ${origin}: ${JSON.stringify(rule)}`);
  }
}

function appendBlankLine(lines) {
  if (lines.length > 1 && lines.at(-1) !== '') {
    lines.push('');
  }
}

function convertUpstream(source) {
  const output = ['payload:'];
  const rules = new Set();

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line) {
      appendBlankLine(output);
      continue;
    }

    if (line === '# $ custom_build_script') {
      continue;
    }

    if (line.startsWith('#')) {
      if (output.at(-1)?.startsWith('  - ')) {
        appendBlankLine(output);
      }
      output.push(`  ${line}`);
      continue;
    }

    const [sourceRule, comment] = splitRuleAndComment(line);
    const rule = normalizeRule(sourceRule);
    validateRule(rule, 'upstream source');

    if (rules.has(rule)) {
      continue;
    }

    rules.add(rule);
    output.push(`  - '${rule}'${comment ? ` ${comment}` : ''}`);
  }

  while (output.at(-1) === '') {
    output.pop();
  }

  return { output, rules };
}

function parseLocalRules(source, fileName) {
  const rules = [];
  const seen = new Set();

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
    validateRule(rule, `${fileName}:${index + 1}`);
    if (seen.has(rule)) {
      throw new Error(`Duplicate local rule at ${fileName}:${index + 1}: ${rule}`);
    }

    seen.add(rule);
    rules.push(rule);
  }

  return rules;
}

function mergeLocalRules(converted, localRules) {
  const additions = localRules.filter((rule) => !converted.rules.has(rule));
  if (additions.length === 0) {
    return;
  }

  appendBlankLine(converted.output);
  converted.output.push('  # >> Local additions');

  for (const rule of additions) {
    converted.rules.add(rule);
    converted.output.push(`  - '${rule.replaceAll("'", "''")}'`);
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const [upstreamSource, localSource] = await Promise.all([
    loadSource(options),
    readFile(options.localFile, 'utf8'),
  ]);

  const converted = convertUpstream(upstreamSource);
  if (converted.rules.size < MIN_UPSTREAM_RULES) {
    throw new Error(
      `Upstream contains only ${converted.rules.size} rules; expected at least ${MIN_UPSTREAM_RULES}`,
    );
  }

  const localRules = parseLocalRules(localSource, options.localFile);
  mergeLocalRules(converted, localRules);

  const result = `${converted.output.join('\n')}\n`;
  const temporaryOutput = `${options.outputFile}.tmp`;
  await writeFile(temporaryOutput, result, 'utf8');
  await rename(temporaryOutput, options.outputFile);

  console.log(
    `Wrote ${converted.rules.size} unique rules to ${options.outputFile} ` +
      `(${localRules.length} configured local additions)`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
