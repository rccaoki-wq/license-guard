/**
 * プロンプト。ツールだけでは埋まらない使い方の穴を埋める。
 *
 * 実際にある穴は 2 つ。
 *
 * 1. **ロックファイルを渡すべきだと利用者が知らない。** 問題のあるライセンスは
 *    直接足した依存より、依存の依存として紛れ込むことの方が多い。それを見るには
 *    ロックファイルが要るのに、ツールの説明を読んだだけでは
 *    「どのファイルを探して渡すか」までは伝わらない。手順として渡す。
 * 2. **比較の型がない。** 「SaaS なら AGPL と GPL でどう違うか」は頻出だが、
 *    ツールを 2 回呼んで自分で並べる必要があった。
 *
 * ここに書くのは**手順**であって判定ではない。判定は必ずツールに行わせる。
 * プロンプト側で結論を書くと、判定エンジンを迂回した答えが生まれる。
 */
import { ALL_DISTRIBUTION_MODELS } from '../policy/matrix';

export interface PromptArgument {
  name: string;
  description: string;
  required: boolean;
}

export interface PromptDescriptor {
  name: string;
  title: string;
  description: string;
  arguments: PromptArgument[];
}

const MODELS = ALL_DISTRIBUTION_MODELS.join(', ');

export const PROMPT_DESCRIPTORS: PromptDescriptor[] = [
  {
    name: 'audit_project',
    title: 'Audit this project for license obligations',
    description:
      "Find this project's dependency manifest and check every dependency, including transitive ones, against the way the project ships.",
    arguments: [
      {
        name: 'distribution_model',
        description: `How this project reaches its users. One of: ${MODELS}.`,
        required: true,
      },
    ],
  },
  {
    name: 'compare_licenses',
    title: 'Compare two licenses for a shipping model',
    description:
      'Explain how two licenses differ for one specific way of shipping software, rather than in the abstract.',
    arguments: [
      { name: 'license_a', description: 'SPDX identifier, e.g. "AGPL-3.0-only".', required: true },
      { name: 'license_b', description: 'SPDX identifier, e.g. "GPL-3.0-only".', required: true },
      {
        name: 'distribution_model',
        description: `The shipping model to compare under. One of: ${MODELS}.`,
        required: true,
      },
    ],
  },
];

const text = (t: string) => ({ role: 'user' as const, content: { type: 'text' as const, text: t } });

function auditProject(args: Record<string, unknown>) {
  const model = typeof args['distribution_model'] === 'string' ? args['distribution_model'] : '';

  return {
    description: 'Audit every dependency, including transitive ones.',
    messages: [
      text(
        `Audit this project's open source dependencies for license obligations. It ships as: ${model}.

Work in this order.

1. Look for a lockfile first, in this order of preference:
   package-lock.json, pnpm-lock.yaml, yarn.lock, go.sum, Cargo.lock, poetry.lock, uv.lock,
   Gemfile.lock.
   Use a lockfile if one exists. Problem licenses usually arrive as a dependency of a
   dependency rather than one that was added on purpose, and only a lockfile shows those.
   Fall back to package.json, requirements.txt, pyproject.toml, go.mod or Cargo.toml
   only when no lockfile is present, and say so in your answer.

2. Pass the full file contents to check_manifest_licenses with distribution_model
   set to "${model}". Do not summarise or trim the file first.

3. Report what came back:
   - Every dependency with a verdict of "blocked", with the license and the reason given.
   - Every dependency marked "review", which means the license needs a human decision
     or could not be resolved. Do not present these as safe.
   - Anything reported as "not-checked". An incomplete scan is not a clean scan.

4. Do not add legal conclusions of your own. Report what the tool returned, including
   its stated limitations.

If the project has more than one manifest — a frontend and a backend, say — audit each
one separately, because they may not ship the same way.`,
      ),
    ],
  };
}

function compareLicenses(args: Record<string, unknown>) {
  const a = typeof args['license_a'] === 'string' ? args['license_a'] : '';
  const b = typeof args['license_b'] === 'string' ? args['license_b'] : '';
  const model = typeof args['distribution_model'] === 'string' ? args['distribution_model'] : '';

  return {
    description: `Compare ${a} and ${b} for ${model}.`,
    messages: [
      text(
        `Compare ${a} and ${b} for software that ships as: ${model}.

1. Call explain_license for ${a} and again for ${b}. Do not answer from memory —
   the difference between these licenses often turns on a specific clause, and
   which clause applies depends on the shipping model.

2. Set out the difference for "${model}" specifically:
   - What each license requires in that situation.
   - Which clause creates the obligation, if there is one.
   - Whether the two actually differ here, or only differ under some other model.

3. State plainly if they reach the same result for this model. People assume
   AGPL and GPL always differ; for a distributed binary they largely do not,
   and for a hosted service they very much do.

Report the clauses the tool cited. Do not give a recommendation or a legal
conclusion of your own.`,
      ),
    ],
  };
}

/** 未知の名前は null。呼び出し側がプロトコルエラーにする */
export function getPrompt(name: unknown, args: Record<string, unknown>) {
  if (name === 'audit_project') return auditProject(args);
  if (name === 'compare_licenses') return compareLicenses(args);
  return null;
}
