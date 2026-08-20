import { parsePackageJson } from './npm';
import { parseRequirementsTxt } from './pypi';
import { parseGoMod } from './gomod';
import type { Dependency, Ecosystem } from '../types';

export interface ParsedManifest {
  ecosystem: Ecosystem;
  dependencies: Dependency[];
}

/**
 * 貼り付けられた内容からエコシステムを判定し、依存を抽出する。
 * ファイル名が無い前提のため、内容だけで判定する。
 */
export function detectAndParse(content: string): ParsedManifest {
  const trimmed = content.trim();
  if (trimmed === '') {
    throw new Error('Input is empty.');
  }

  let result: ParsedManifest;

  if (trimmed.startsWith('{')) {
    result = { ecosystem: 'npm', dependencies: parsePackageJson(trimmed) };
  } else if (/^module\s+\S+/m.test(trimmed) || /^require\s*\(/m.test(trimmed)) {
    result = { ecosystem: 'go', dependencies: parseGoMod(trimmed) };
  } else {
    result = { ecosystem: 'pypi', dependencies: parseRequirementsTxt(trimmed) };
  }

  if (result.dependencies.length === 0) {
    throw new Error(
      'No dependencies were found. Paste a package.json, requirements.txt, or go.mod.',
    );
  }

  return result;
}
