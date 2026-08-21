/**
 * リソース。ライセンスの参照表を読めるようにする。
 *
 * これを足した理由は 2 つある。
 *
 * 1. **ツールを呼ばずに読めるべき情報がある。** 「AGPL は SaaS でどうなるか」は
 *    パッケージに依存しない固定の知識で、往復する必要がない。判定表は
 *    `verdictMatrix()` が純粋関数として持っているので、そのまま読ませればいい。
 * 2. Web ページ（`/license/<id>`）と同じ中身を、機械が読む経路にも出す。
 *    人向けにだけ用意して機械向けに用意しないのは、この製品の立て付けに反する。
 *
 * 内容は `LICENSE_CATALOG` と `verdictMatrix()` から生成する。二重に書かない。
 */
import { LICENSE_CATALOG, findLicense } from '../seo/catalog';
import { verdictMatrix } from '../policy/matrix';
import { SITE_ORIGIN } from '../ui/layout';

const SCHEME = 'licenseguard://license/';

export interface ResourceDescriptor {
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: string;
}

export const RESOURCE_DESCRIPTORS: ResourceDescriptor[] = LICENSE_CATALOG.map((l) => ({
  uri: `${SCHEME}${l.id}`,
  name: l.id,
  title: l.name,
  description: `What ${l.id} requires, and the verdict for each way of shipping software.`,
  mimeType: 'text/markdown',
}));

const MODEL_LABELS: Record<string, string> = {
  saas: 'Hosted SaaS (users reach it over a network)',
  'distributed-binary': 'Distributed binary',
  'on-prem-delivery': 'On-premises delivery',
  'internal-only': 'Internal use only',
  'library-published': 'Published library',
};

/**
 * 1 ライセンスを Markdown にする。
 *
 * 判定は `verdictMatrix()` に任せる。ここで文言を作り直すと、ツールの答えと
 * リソースの答えが食い違いうる。**同じ問いに 2 つの答えを持たせない。**
 */
export function renderLicenseResource(id: string): string | null {
  const entry = findLicense(id);
  if (!entry) return null;

  const rows = verdictMatrix(entry.id)
    .map((r) => {
      const obligations = r.obligations.length > 0 ? r.obligations.join(', ') : '—';
      return `| ${MODEL_LABELS[r.model] ?? r.model} | ${r.verdict} | ${obligations} | ${r.rationale} |`;
    })
    .join('\n');

  return `# ${entry.name} (\`${entry.id}\`)

${entry.summary}

## Verdict by how you ship

Runtime dependency, dynamically linked. A build-time-only dependency (\`scope\` of
\`dev\`, \`build\` or \`test\`) never reaches users and therefore carries no
distribution obligation, whatever this table says.

| How you ship | Verdict | Obligations | Why |
|---|---|---|---|
${rows}

## Notes

Informational only, derived from the published license text. Not legal advice.
Live page: ${SITE_ORIGIN}/license/${entry.id}
`;
}

/** URI からライセンス ID を取り出す。scheme が違えば null */
export function parseLicenseUri(uri: unknown): string | null {
  if (typeof uri !== 'string' || !uri.startsWith(SCHEME)) return null;
  const id = uri.slice(SCHEME.length);
  return id === '' ? null : id;
}

export interface ResourceContents {
  contents: Array<{ uri: string; mimeType: string; text: string }>;
}

/** 読み出し。未知の URI は null を返し、呼び出し側がプロトコルエラーにする */
export function readResource(uri: unknown): ResourceContents | null {
  const id = parseLicenseUri(uri);
  if (id === null) return null;

  const text = renderLicenseResource(id);
  if (text === null) return null;

  return { contents: [{ uri: uri as string, mimeType: 'text/markdown', text }] };
}
