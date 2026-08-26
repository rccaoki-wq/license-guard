import { describe, expect, it } from 'vitest';
import { LOCKFILE_NAME, detectAndParse } from '../src/manifests';
import { renderPage } from '../src/ui/page';
import { buildLlmsTxt } from '../src/seo/llms';
import { PROMPT_DESCRIPTORS, getPrompt } from '../src/mcp/prompts';
import { TOOL_DEFINITIONS } from '../src/mcp/tools';
import { ECOSYSTEMS } from '../src/types';

/**
 * 対応形式の一覧が**7 箇所に散っている**。
 *
 * rubygems を足したとき、パーサも解決器も通ってテストも緑なのに、
 * 貼り付け欄の説明・llms.txt・MCP のツール説明・構造化データの
 * どれにも `Gemfile.lock` が無い状態になった。**対応したのに誰も
 * 気づかない**という壊れ方をする。型は助けてくれない——どれも
 * ただの文字列だから。
 *
 * だから列挙をここで固定する。LOCKFILE_NAME は Record<Ecosystem, string>
 * なので、エコシステムを足せば必ず新しい値が増え、掲載面のどれかが
 * 足りなければこのテストが名指しで落ちる。
 */

/** そのエコシステムを利用者が見つけられる面 */
function surfaces(): Array<[string, string]> {
  const promptText = PROMPT_DESCRIPTORS.map((d) =>
    JSON.stringify(getPrompt(d.name, Object.fromEntries((d.arguments ?? []).map((a) => [a.name, 'x'])))),
  ).join('\n');

  return [
    ['貼り付け欄（トップページ）', renderPage()],
    ['llms.txt', buildLlmsTxt()],
    ['MCP ツールの入力スキーマ', JSON.stringify(TOOL_DEFINITIONS)],
    ['MCP プロンプト', promptText],
    // 分からない形式を貼った人に、何なら読めるかを示す唯一の場所
    ['判定に落ちたときの案内', errorFor('!!! not a manifest !!!')],
    ['依存が 0 件だったときの案内', errorFor('{"dependencies":{}}')],
  ];
}

function errorFor(content: string): string {
  try {
    detectAndParse(content);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
}

/**
 * SBOM は `LOCKFILE_NAME` に載らない——エコシステムではないから。
 *
 * つまり上の Record 由来の自動チェックが効かない側にいる。ロックファイルを
 * 足したときは型が新しい値を作ってくれるが、SBOM を足しても型は何も
 * 増えないので、掲載面が古いままでも全部緑になる。ここで名指しする。
 */
const SBOM_FORMATS = ['CycloneDX', 'SPDX'] as const;

describe('対応形式はすべての掲載面に載る', () => {
  for (const [where, text] of surfaces()) {
    for (const lockfile of new Set(Object.values(LOCKFILE_NAME))) {
      it(`${where} に ${lockfile} が載っている`, () => {
        expect(text).toContain(lockfile);
      });
    }

    for (const format of SBOM_FORMATS) {
      it(`${where} に ${format} が載っている`, () => {
        expect(text).toContain(format);
      });
    }
  }

  it('掲載面はエコシステムの数だけ名前を持つ', () => {
    // Record<Ecosystem, string> なので、union を広げれば必ずここが増える。
    // 「足したのに一覧が古い」を型で捕まえられない分をここで捕まえる
    expect(Object.keys(LOCKFILE_NAME).sort()).toEqual([...ECOSYSTEMS].sort());
  });
});
