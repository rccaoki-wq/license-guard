# LicenseGuard Phase 0 (無料Webツール) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** マニフェストファイルを貼り付けるとOSSライセンスの判定結果が出る、サインアップ不要の無料Webツールを公開し、有料レポートCTAのクリック率で支払意思を実測する。

**Architecture:** Cloudflare Workers 上の Hono アプリ。マニフェスト解析 → レジストリからライセンス解決（D1キャッシュ経由） → 純粋関数のPolicy Engineで判定 → HTMLで結果表示。Policy Engine は外部I/Oを持たず、単体で網羅テストする。

**Tech Stack:** TypeScript / Hono / Cloudflare Workers / Cloudflare D1 / Vitest / `spdx-expression-parse`

**Scope:** 直接依存のみ（推移的依存は Phase 1）。npm / PyPI / Go modules の3エコシステム。

**Phase 0 に含めないもの:** プログラマティックSEOページ生成（ライセンスDBの蓄積が前提となるため Phase 1 で着手）、有料レポートの実装（CTAはクリック計測のみ）、GitHub App、認証、Stripe。

---

## File Structure

| ファイル | 責務 |
|---|---|
| `src/types.ts` | 全モジュールが共有する型定義 |
| `src/policy/categories.ts` | SPDX ID → ライセンスカテゴリの対応表 |
| `src/policy/rules.ts` | 単一ライセンスの判定ルール（純粋関数） |
| `src/policy/engine.ts` | SPDX式を評価しルールを合成する（純粋関数） |
| `src/manifests/npm.ts` | `package.json` パーサ |
| `src/manifests/pypi.ts` | `requirements.txt` パーサ |
| `src/manifests/gomod.ts` | `go.mod` パーサ |
| `src/manifests/index.ts` | 入力からエコシステムを判定してパーサへ振り分け |
| `src/resolver/cache.ts` | D1 バックのライセンスキャッシュ |
| `src/resolver/npm.ts` | npm レジストリからライセンス取得 |
| `src/resolver/pypi.ts` | PyPI JSON API からライセンス取得 |
| `src/resolver/clearlydefined.ts` | ClearlyDefined からライセンス取得（Go 用） |
| `src/resolver/index.ts` | キャッシュとレジストリを束ねる解決オーケストレータ |
| `src/scan.ts` | パース → 解決 → 判定 を繋ぐスキャンサービス |
| `src/ui/page.ts` | 無料ツールのHTML |
| `src/index.ts` | Hono ルーティング |
| `migrations/0001_init.sql` | D1 スキーマ |

---

### Task 1: プロジェクト scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `wrangler.toml`, `.gitignore`

- [ ] **Step 1: `package.json` を作成**

```json
{
  "name": "license-guard",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "db:migrate:local": "wrangler d1 migrations apply license-guard --local",
    "db:migrate": "wrangler d1 migrations apply license-guard --remote"
  },
  "dependencies": {
    "hono": "^4.6.0",
    "spdx-expression-parse": "^4.0.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20240909.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "wrangler": "^3.78.0"
  }
}
```

- [ ] **Step 2: `tsconfig.json` を作成**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: `vitest.config.ts` を作成**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 4: `wrangler.toml` を作成**

```toml
name = "license-guard"
main = "src/index.ts"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "license-guard"
database_id = "PLACEHOLDER_REPLACED_AT_DEPLOY"
migrations_dir = "migrations"
```

`database_id` は Task 19 で `wrangler d1 create` を実行した際の実IDに差し替える。

- [ ] **Step 5: `.gitignore` を作成**

```
node_modules/
.wrangler/
dist/
.dev.vars
*.log
```

- [ ] **Step 6: 依存をインストールして型チェックが通ることを確認**

Run: `npm install && npm run typecheck`
Expected: エラーなしで終了（`src/` が空なので警告のみ）

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts wrangler.toml .gitignore package-lock.json
git commit -m "chore: プロジェクト scaffold"
```

---

### Task 2: 共有型定義

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: 型定義を作成**

```typescript
export type Ecosystem = 'npm' | 'pypi' | 'go';

export type Scope = 'runtime' | 'dev' | 'build' | 'test' | 'optional';

export type Linkage = 'dynamic' | 'static' | 'separate-process';

export type DistributionModel =
  | 'saas'
  | 'distributed-binary'
  | 'on-prem-delivery'
  | 'internal-only'
  | 'library-published';

export type Verdict = 'allowed' | 'review' | 'blocked';

export type Obligation =
  | 'attribution'
  | 'notice-file'
  | 'source-disclosure'
  | 'same-license'
  | 'patent-grant';

export type LicenseCategory =
  | 'public-domain'
  | 'permissive'
  | 'weak-copyleft'
  | 'strong-copyleft'
  | 'network-copyleft'
  | 'source-available'
  | 'non-commercial'
  | 'unknown'
  | 'none';

export interface Dependency {
  ecosystem: Ecosystem;
  name: string;
  /** 具体的なバージョン。範囲指定などで確定できない場合は null */
  version: string | null;
  scope: Scope;
}

export interface PolicyContext {
  scope: Scope;
  linkage: Linkage;
  distributionModel: DistributionModel;
}

export interface PolicyResult {
  verdict: Verdict;
  obligations: Obligation[];
  /** 条項を引用した事実ベースの説明。法的助言の表現を含めないこと */
  rationale: string;
}

export type ResolvedFrom = 'registry' | 'clearlydefined' | 'cache' | 'unresolved';

export interface Finding extends Dependency {
  spdxExpression: string | null;
  resolvedFrom: ResolvedFrom;
  verdict: Verdict;
  obligations: Obligation[];
  rationale: string;
}

export interface ScanSummary {
  total: number;
  allowed: number;
  review: number;
  blocked: number;
}

export interface ScanResult {
  ecosystem: Ecosystem;
  distributionModel: DistributionModel;
  findings: Finding[];
  summary: ScanSummary;
  /** 「直接依存のみ」等、結果の限界をユーザーに伝える文言 */
  limitations: string[];
}
```

- [ ] **Step 2: 型チェック**

Run: `npm run typecheck`
Expected: エラーなし

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: 共有型定義を追加"
```

---

### Task 3: ライセンスカテゴリ表

**Files:**
- Create: `src/policy/categories.ts`
- Test: `tests/policy/categories.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```typescript
import { describe, expect, it } from 'vitest';
import { categorize } from '../../src/policy/categories';

describe('categorize', () => {
  it('MIT を permissive に分類する', () => {
    expect(categorize('MIT')).toBe('permissive');
  });

  it('AGPL-3.0 系を network-copyleft に分類する', () => {
    expect(categorize('AGPL-3.0-only')).toBe('network-copyleft');
    expect(categorize('AGPL-3.0-or-later')).toBe('network-copyleft');
    expect(categorize('AGPL-3.0')).toBe('network-copyleft');
  });

  it('GPL を strong-copyleft に分類する', () => {
    expect(categorize('GPL-3.0-only')).toBe('strong-copyleft');
    expect(categorize('GPL-2.0')).toBe('strong-copyleft');
  });

  it('LGPL / MPL を weak-copyleft に分類する', () => {
    expect(categorize('LGPL-3.0-only')).toBe('weak-copyleft');
    expect(categorize('MPL-2.0')).toBe('weak-copyleft');
  });

  it('SSPL / BSL / Elastic を source-available に分類する', () => {
    expect(categorize('SSPL-1.0')).toBe('source-available');
    expect(categorize('BUSL-1.1')).toBe('source-available');
    expect(categorize('Elastic-2.0')).toBe('source-available');
  });

  it('NC 系を non-commercial に分類する', () => {
    expect(categorize('CC-BY-NC-4.0')).toBe('non-commercial');
  });

  it('大文字小文字を無視する', () => {
    expect(categorize('mit')).toBe('permissive');
  });

  it('未知の識別子を unknown に分類する', () => {
    expect(categorize('WTF-9000')).toBe('unknown');
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run tests/policy/categories.test.ts`
Expected: FAIL — `Cannot find module '../../src/policy/categories'`

- [ ] **Step 3: 実装**

```typescript
import type { LicenseCategory } from '../types';

const EXACT: Record<string, LicenseCategory> = {
  'cc0-1.0': 'public-domain',
  unlicense: 'public-domain',
  '0bsd': 'public-domain',
  mit: 'permissive',
  'mit-0': 'permissive',
  isc: 'permissive',
  'bsd-2-clause': 'permissive',
  'bsd-3-clause': 'permissive',
  'apache-2.0': 'permissive',
  zlib: 'permissive',
  'python-2.0': 'permissive',
  'postgresql': 'permissive',
  'mpl-2.0': 'weak-copyleft',
  'epl-1.0': 'weak-copyleft',
  'epl-2.0': 'weak-copyleft',
  'cddl-1.0': 'weak-copyleft',
  'cddl-1.1': 'weak-copyleft',
  'sspl-1.0': 'source-available',
  'busl-1.1': 'source-available',
  'bsl-1.1': 'source-available',
  'elastic-2.0': 'source-available',
};

/**
 * SPDX ライセンス識別子をカテゴリに分類する。
 * 判定不能な場合は 'unknown' を返す（呼び出し側で 'review' に倒すこと）。
 */
export function categorize(licenseId: string): LicenseCategory {
  const id = licenseId.trim().toLowerCase();
  if (id === '') return 'none';

  const exact = EXACT[id];
  if (exact) return exact;

  // AGPL は GPL より先に判定する（"agpl" は "gpl" を含むため）
  if (id.startsWith('agpl-')) return 'network-copyleft';
  if (id.startsWith('lgpl-')) return 'weak-copyleft';
  if (id.startsWith('gpl-')) return 'strong-copyleft';
  if (id.startsWith('cc-by-nc')) return 'non-commercial';
  if (id.startsWith('cc-by-')) return 'permissive';

  return 'unknown';
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npx vitest run tests/policy/categories.test.ts`
Expected: PASS（8 tests）

- [ ] **Step 5: Commit**

```bash
git add src/policy/categories.ts tests/policy/categories.test.ts
git commit -m "feat: ライセンスカテゴリ分類を追加"
```

---

### Task 4: 単一ライセンスの判定ルール

これが本製品の中核。純粋関数として実装し、判定表を網羅テストする。

**Files:**
- Create: `src/policy/rules.ts`
- Test: `tests/policy/rules.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```typescript
import { describe, expect, it } from 'vitest';
import { evaluateLicense } from '../../src/policy/rules';
import type { PolicyContext } from '../../src/types';

const ctx = (over: Partial<PolicyContext> = {}): PolicyContext => ({
  scope: 'runtime',
  linkage: 'dynamic',
  distributionModel: 'saas',
  ...over,
});

describe('evaluateLicense', () => {
  it('MIT は常に allowed で表示義務のみ', () => {
    const r = evaluateLicense('MIT', ctx());
    expect(r.verdict).toBe('allowed');
    expect(r.obligations).toEqual(['attribution']);
  });

  it('Apache-2.0 は NOTICE と特許条項の義務を持つ', () => {
    const r = evaluateLicense('Apache-2.0', ctx());
    expect(r.verdict).toBe('allowed');
    expect(r.obligations).toContain('notice-file');
    expect(r.obligations).toContain('patent-grant');
  });

  it('AGPL-3.0 は SaaS で blocked', () => {
    const r = evaluateLicense('AGPL-3.0-only', ctx({ distributionModel: 'saas' }));
    expect(r.verdict).toBe('blocked');
    expect(r.obligations).toContain('source-disclosure');
  });

  it('AGPL-3.0 は社内利用のみなら allowed', () => {
    const r = evaluateLicense(
      'AGPL-3.0-only',
      ctx({ distributionModel: 'internal-only' }),
    );
    expect(r.verdict).toBe('allowed');
  });

  it('AGPL-3.0 でも devDependency なら allowed（差別化の中核）', () => {
    const r = evaluateLicense('AGPL-3.0-only', ctx({ scope: 'dev' }));
    expect(r.verdict).toBe('allowed');
    expect(r.rationale).toContain('成果物に含まれない');
  });

  it('GPL-3.0 は SaaS では allowed だが将来の配布リスクを説明する', () => {
    const r = evaluateLicense('GPL-3.0-only', ctx({ distributionModel: 'saas' }));
    expect(r.verdict).toBe('allowed');
    expect(r.rationale).toContain('配布');
  });

  it('GPL-3.0 はバイナリ配布で blocked', () => {
    const r = evaluateLicense(
      'GPL-3.0-only',
      ctx({ distributionModel: 'distributed-binary' }),
    );
    expect(r.verdict).toBe('blocked');
  });

  it('GPL-3.0 は顧客納品で blocked', () => {
    const r = evaluateLicense(
      'GPL-3.0-only',
      ctx({ distributionModel: 'on-prem-delivery' }),
    );
    expect(r.verdict).toBe('blocked');
  });

  it('LGPL は動的リンクなら allowed', () => {
    const r = evaluateLicense('LGPL-3.0-only', ctx({ linkage: 'dynamic' }));
    expect(r.verdict).toBe('allowed');
  });

  it('LGPL は静的リンクなら review', () => {
    const r = evaluateLicense('LGPL-3.0-only', ctx({ linkage: 'static' }));
    expect(r.verdict).toBe('review');
  });

  it('SSPL は SaaS で review（条項の個別確認が必要）', () => {
    const r = evaluateLicense('SSPL-1.0', ctx({ distributionModel: 'saas' }));
    expect(r.verdict).toBe('review');
  });

  it('CC-BY-NC は商用利用で blocked', () => {
    const r = evaluateLicense('CC-BY-NC-4.0', ctx());
    expect(r.verdict).toBe('blocked');
  });

  it('未知のライセンスは blocked ではなく review', () => {
    const r = evaluateLicense('WTF-9000', ctx());
    expect(r.verdict).toBe('review');
  });

  it('ライセンス表記なしは blocked（全権利留保のため）', () => {
    const r = evaluateLicense('', ctx());
    expect(r.verdict).toBe('blocked');
    expect(r.rationale).toContain('全権利留保');
  });

  it('rationale に助言的表現を含めない', () => {
    const r = evaluateLicense('AGPL-3.0-only', ctx());
    expect(r.rationale).not.toContain('すべきです');
    expect(r.rationale).not.toContain('おすすめ');
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run tests/policy/rules.test.ts`
Expected: FAIL — `Cannot find module '../../src/policy/rules'`

- [ ] **Step 3: 実装**

```typescript
import { categorize } from './categories';
import type { Obligation, PolicyContext, PolicyResult } from '../types';

/** 成果物に含まれず、配布時の義務が発生しないスコープ */
const NON_SHIPPING_SCOPES = new Set(['dev', 'build', 'test']);

/** ソフトウェアが第三者の手に渡る配布モデル */
const DISTRIBUTING_MODELS = new Set([
  'distributed-binary',
  'on-prem-delivery',
  'library-published',
]);

/**
 * 単一の SPDX ライセンス識別子を、利用文脈のもとで判定する。
 * 純粋関数。外部 I/O を持たないこと。
 *
 * rationale は事実の提示に限定する。条項を引用し、判断を下す表現
 * （「〜すべき」「〜を推奨」等）を含めてはならない。
 */
export function evaluateLicense(
  licenseId: string,
  ctx: PolicyContext,
): PolicyResult {
  const category = categorize(licenseId);

  if (category === 'none') {
    return {
      verdict: 'blocked',
      obligations: [],
      rationale:
        'ライセンスが宣言されていません。ライセンス表記のない著作物は既定で全権利留保であり、著作権者の許諾なく利用・複製・再配布する法的根拠がありません。',
    };
  }

  // 成果物に含まれないスコープでは、配布に伴う義務は発生しない。
  // ただしコード生成器など、出力に影響しうるツールは個別確認が必要。
  if (NON_SHIPPING_SCOPES.has(ctx.scope)) {
    return {
      verdict: 'allowed',
      obligations: [],
      rationale: `${licenseId} は ${ctx.scope} スコープの依存であり、配布される成果物に含まれないため、配布に伴う義務は発生しません。ただしコード生成器のように出力物へ影響しうるツールは個別の確認対象です。`,
    };
  }

  switch (category) {
    case 'public-domain':
      return {
        verdict: 'allowed',
        obligations: [],
        rationale: `${licenseId} はパブリックドメイン相当であり、利用にあたっての義務はありません。`,
      };

    case 'permissive': {
      const obligations: Obligation[] = ['attribution'];
      if (licenseId.toLowerCase() === 'apache-2.0') {
        obligations.push('notice-file', 'patent-grant');
        return {
          verdict: 'allowed',
          obligations,
          rationale:
            'Apache-2.0 第4条は著作権表示・ライセンス写し・NOTICE ファイルの保持を要求し、第3条は貢献者からの特許ライセンス許諾を定めています。ソース開示義務はありません。',
        };
      }
      return {
        verdict: 'allowed',
        obligations,
        rationale: `${licenseId} は著作権表示とライセンス条文の保持を要求します。ソース開示義務はありません。`,
      };
    }

    case 'weak-copyleft': {
      if (ctx.linkage === 'static') {
        return {
          verdict: 'review',
          obligations: ['source-disclosure', 'attribution'],
          rationale: `${licenseId} は静的リンク時に、利用者が当該ライブラリを差し替えられる手段（オブジェクトファイルの提供等）の提供を要求します。静的リンクとして検出されたため、個別の確認対象です。`,
        };
      }
      return {
        verdict: 'allowed',
        obligations: ['source-disclosure', 'attribution'],
        rationale: `${licenseId} は当該ライブラリ自体への改変を公開する義務を課しますが、動的リンクの場合、これを利用する側のコードには及びません。`,
      };
    }

    case 'strong-copyleft': {
      if (DISTRIBUTING_MODELS.has(ctx.distributionModel)) {
        return {
          verdict: 'blocked',
          obligations: ['source-disclosure', 'same-license'],
          rationale: `${licenseId} は、これを組み込んだ著作物を配布する場合、全体を同一ライセンスで頒布し対応するソースを提供することを要求します。配布モデルが「${ctx.distributionModel}」であるため、この義務が発生します。`,
        };
      }
      return {
        verdict: 'allowed',
        obligations: [],
        rationale: `${licenseId} の義務は「配布」を契機に発生します。現在の配布モデル「${ctx.distributionModel}」では配布に該当しないため義務は発生しません。将来オンプレミス提供や配布形態に転じた場合、全体のソース開示義務が発生します。`,
      };
    }

    case 'network-copyleft': {
      if (ctx.distributionModel === 'internal-only') {
        return {
          verdict: 'allowed',
          obligations: [],
          rationale: `${licenseId} 第13条の義務は、ネットワーク経由で第三者に利用させる場合に発生します。配布モデルが「internal-only」であるため、この義務は発生しません。`,
        };
      }
      return {
        verdict: 'blocked',
        obligations: ['source-disclosure', 'same-license'],
        rationale: `${licenseId} 第13条は、改変版をネットワーク経由で利用させる場合に、利用者へ対応するソース全体を提供することを要求します。配布モデルが「${ctx.distributionModel}」であるため、この義務が発生します。`,
      };
    }

    case 'source-available':
      return {
        verdict: 'review',
        obligations: [],
        rationale: `${licenseId} は OSI 承認のオープンソースライセンスではなく、商用提供や競合サービスの提供を制限する条項を含む場合があります。条項の個別確認が必要です。`,
      };

    case 'non-commercial':
      return {
        verdict: 'blocked',
        obligations: [],
        rationale: `${licenseId} は非商用利用に限定されており、営利目的の利用を許諾していません。`,
      };

    case 'unknown':
    default:
      return {
        verdict: 'review',
        obligations: [],
        rationale: `${licenseId} は既知のライセンス識別子と一致しませんでした。条文の個別確認が必要です。`,
      };
  }
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npx vitest run tests/policy/rules.test.ts`
Expected: PASS（15 tests）

- [ ] **Step 5: Commit**

```bash
git add src/policy/rules.ts tests/policy/rules.test.ts
git commit -m "feat: 単一ライセンスの判定ルールを追加"
```

---

### Task 5: SPDX式の評価と合成

**Files:**
- Create: `src/policy/engine.ts`
- Test: `tests/policy/engine.test.ts`

`OR` は利用者が選択できるため最も緩い判定を採り、`AND` は全てが適用されるため最も厳しい判定を採る。

- [ ] **Step 1: 失敗するテストを書く**

```typescript
import { describe, expect, it } from 'vitest';
import { evaluateExpression } from '../../src/policy/engine';
import type { PolicyContext } from '../../src/types';

const ctx = (over: Partial<PolicyContext> = {}): PolicyContext => ({
  scope: 'runtime',
  linkage: 'dynamic',
  distributionModel: 'saas',
  ...over,
});

describe('evaluateExpression', () => {
  it('単一ライセンスをそのまま判定する', () => {
    expect(evaluateExpression('MIT', ctx()).verdict).toBe('allowed');
  });

  it('OR は最も緩い判定を採る', () => {
    // 利用者が MIT を選択できるため allowed
    expect(evaluateExpression('(MIT OR GPL-3.0-only)', ctx({
      distributionModel: 'distributed-binary',
    })).verdict).toBe('allowed');
  });

  it('AND は最も厳しい判定を採る', () => {
    expect(evaluateExpression('(MIT AND AGPL-3.0-only)', ctx()).verdict).toBe('blocked');
  });

  it('AND の義務は合算される', () => {
    const r = evaluateExpression('(MIT AND Apache-2.0)', ctx());
    expect(r.obligations).toContain('attribution');
    expect(r.obligations).toContain('notice-file');
  });

  it('GPL-2.0+ のような plus 記法を扱える', () => {
    expect(evaluateExpression('GPL-2.0+', ctx({
      distributionModel: 'distributed-binary',
    })).verdict).toBe('blocked');
  });

  it('Classpath 例外つき GPL は静的リンクでも blocked にしない', () => {
    const r = evaluateExpression(
      'GPL-2.0-only WITH Classpath-exception-2.0',
      ctx({ distributionModel: 'distributed-binary', linkage: 'static' }),
    );
    expect(r.verdict).not.toBe('blocked');
  });

  it('パース不能な式は review にする', () => {
    const r = evaluateExpression('!!! not an spdx expression !!!', ctx());
    expect(r.verdict).toBe('review');
  });

  it('null は blocked（ライセンス不明＝全権利留保）', () => {
    const r = evaluateExpression(null, ctx());
    expect(r.verdict).toBe('blocked');
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run tests/policy/engine.test.ts`
Expected: FAIL — `Cannot find module '../../src/policy/engine'`

- [ ] **Step 3: 実装**

```typescript
import parse from 'spdx-expression-parse';
import { evaluateLicense } from './rules';
import type { Obligation, PolicyContext, PolicyResult, Verdict } from '../types';

const SEVERITY: Record<Verdict, number> = {
  allowed: 0,
  review: 1,
  blocked: 2,
};

/**
 * コピーレフト義務を緩和することが明示されている例外。
 * これらが付与されたライセンスは permissive 相当として扱う。
 */
const RELAXING_EXCEPTIONS = new Set([
  'classpath-exception-2.0',
  'gcc-exception-3.1',
  'gcc-exception-2.0',
  'llvm-exception',
  'autoconf-exception-3.0',
  'bison-exception-2.2',
]);

type Node =
  | { license: string; plus?: boolean; exception?: string }
  | { left: Node; conjunction: 'and' | 'or'; right: Node };

function mergeObligations(a: Obligation[], b: Obligation[]): Obligation[] {
  return [...new Set([...a, ...b])];
}

function evalNode(node: Node, ctx: PolicyContext): PolicyResult {
  if ('license' in node) {
    if (node.exception && RELAXING_EXCEPTIONS.has(node.exception.toLowerCase())) {
      return {
        verdict: 'allowed',
        obligations: ['attribution'],
        rationale: `${node.license} に ${node.exception} が付与されています。この例外はリンクに伴うコピーレフト義務の適用を除外します。`,
      };
    }
    return evaluateLicense(node.license, ctx);
  }

  const left = evalNode(node.left, ctx);
  const right = evalNode(node.right, ctx);

  if (node.conjunction === 'or') {
    // 利用者がいずれかを選択できるため、緩い方を採る
    const chosen = SEVERITY[left.verdict] <= SEVERITY[right.verdict] ? left : right;
    return {
      verdict: chosen.verdict,
      obligations: chosen.obligations,
      rationale: `複数ライセンスからの選択が可能です。より制約の少ない条件を採用しています。${chosen.rationale}`,
    };
  }

  // AND: 全てが適用されるため、厳しい方を採り義務を合算する
  const stricter = SEVERITY[left.verdict] >= SEVERITY[right.verdict] ? left : right;
  return {
    verdict: stricter.verdict,
    obligations: mergeObligations(left.obligations, right.obligations),
    rationale: `複数ライセンスが同時に適用されます。${left.rationale} / ${right.rationale}`,
  };
}

/**
 * SPDX ライセンス式を評価する。純粋関数。
 * null（ライセンス不明）は全権利留保として blocked を返す。
 */
export function evaluateExpression(
  expression: string | null,
  ctx: PolicyContext,
): PolicyResult {
  if (expression === null || expression.trim() === '') {
    return evaluateLicense('', ctx);
  }

  let ast: Node;
  try {
    ast = parse(expression) as Node;
  } catch {
    return {
      verdict: 'review',
      obligations: [],
      rationale: `ライセンス表記「${expression}」を SPDX 式として解釈できませんでした。原文の個別確認が必要です。`,
    };
  }

  return evalNode(ast, ctx);
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npx vitest run tests/policy/engine.test.ts`
Expected: PASS（8 tests）

- [ ] **Step 5: Commit**

```bash
git add src/policy/engine.ts tests/policy/engine.test.ts
git commit -m "feat: SPDX式の評価と判定合成を追加"
```

---

### Task 6: `package.json` パーサ

**Files:**
- Create: `src/manifests/npm.ts`
- Test: `tests/manifests/npm.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```typescript
import { describe, expect, it } from 'vitest';
import { parsePackageJson } from '../../src/manifests/npm';

describe('parsePackageJson', () => {
  it('dependencies を runtime スコープで取り出す', () => {
    const deps = parsePackageJson(
      JSON.stringify({ dependencies: { express: '4.18.2' } }),
    );
    expect(deps).toEqual([
      { ecosystem: 'npm', name: 'express', version: '4.18.2', scope: 'runtime' },
    ]);
  });

  it('devDependencies を dev スコープで取り出す', () => {
    const deps = parsePackageJson(
      JSON.stringify({ devDependencies: { vitest: '2.1.0' } }),
    );
    expect(deps[0]!.scope).toBe('dev');
  });

  it('optionalDependencies を optional スコープで取り出す', () => {
    const deps = parsePackageJson(
      JSON.stringify({ optionalDependencies: { fsevents: '2.3.3' } }),
    );
    expect(deps[0]!.scope).toBe('optional');
  });

  it('peerDependencies は対象外', () => {
    const deps = parsePackageJson(
      JSON.stringify({ peerDependencies: { react: '18.0.0' } }),
    );
    expect(deps).toEqual([]);
  });

  it('キャレット・チルダ・不等号を除去して具体バージョンを得る', () => {
    const deps = parsePackageJson(
      JSON.stringify({
        dependencies: { a: '^1.2.3', b: '~4.5.6', c: '>=7.8.9' },
      }),
    );
    expect(deps.map((d) => d.version)).toEqual(['1.2.3', '4.5.6', '7.8.9']);
  });

  it('確定できない範囲指定は version を null にする', () => {
    const deps = parsePackageJson(
      JSON.stringify({ dependencies: { a: '*', b: 'latest', c: '1.x' } }),
    );
    expect(deps.every((d) => d.version === null)).toBe(true);
  });

  it('スコープ付きパッケージ名を保持する', () => {
    const deps = parsePackageJson(
      JSON.stringify({ dependencies: { '@types/node': '22.0.0' } }),
    );
    expect(deps[0]!.name).toBe('@types/node');
  });

  it('不正な JSON では例外を投げる', () => {
    expect(() => parsePackageJson('{ not json')).toThrow();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run tests/manifests/npm.test.ts`
Expected: FAIL — `Cannot find module '../../src/manifests/npm'`

- [ ] **Step 3: 実装**

```typescript
import type { Dependency, Scope } from '../types';

const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** 範囲指定の記号を落として具体バージョンを取り出す。確定できなければ null */
function toConcreteVersion(range: string): string | null {
  const stripped = range.trim().replace(/^[\^~]|^[><=]+\s*/g, '').trim();
  return SEMVER.test(stripped) ? stripped : null;
}

const SECTIONS: Array<{ key: string; scope: Scope }> = [
  { key: 'dependencies', scope: 'runtime' },
  { key: 'devDependencies', scope: 'dev' },
  { key: 'optionalDependencies', scope: 'optional' },
];

/**
 * package.json から直接依存を抽出する。
 * peerDependencies は利用側が解決するため対象外。
 */
export function parsePackageJson(content: string): Dependency[] {
  const doc = JSON.parse(content) as Record<string, unknown>;
  const out: Dependency[] = [];

  for (const { key, scope } of SECTIONS) {
    const section = doc[key];
    if (typeof section !== 'object' || section === null) continue;

    for (const [name, range] of Object.entries(section as Record<string, unknown>)) {
      if (typeof range !== 'string') continue;
      out.push({
        ecosystem: 'npm',
        name,
        version: toConcreteVersion(range),
        scope,
      });
    }
  }

  return out;
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npx vitest run tests/manifests/npm.test.ts`
Expected: PASS（8 tests）

- [ ] **Step 5: Commit**

```bash
git add src/manifests/npm.ts tests/manifests/npm.test.ts
git commit -m "feat: package.json パーサを追加"
```

---

### Task 7: `requirements.txt` パーサ

**Files:**
- Create: `src/manifests/pypi.ts`
- Test: `tests/manifests/pypi.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```typescript
import { describe, expect, it } from 'vitest';
import { parseRequirementsTxt } from '../../src/manifests/pypi';

describe('parseRequirementsTxt', () => {
  it('== の固定バージョンを取り出す', () => {
    const deps = parseRequirementsTxt('requests==2.31.0');
    expect(deps).toEqual([
      { ecosystem: 'pypi', name: 'requests', version: '2.31.0', scope: 'runtime' },
    ]);
  });

  it('コメントと空行を無視する', () => {
    const deps = parseRequirementsTxt('# comment\n\nflask==3.0.0\n   \n');
    expect(deps).toHaveLength(1);
    expect(deps[0]!.name).toBe('flask');
  });

  it('行末コメントを除去する', () => {
    const deps = parseRequirementsTxt('django==5.0  # web framework');
    expect(deps[0]!.version).toBe('5.0');
  });

  it('extras を名前から除去する', () => {
    const deps = parseRequirementsTxt('celery[redis]==5.3.0');
    expect(deps[0]!.name).toBe('celery');
    expect(deps[0]!.version).toBe('5.3.0');
  });

  it('>= などの範囲指定は version を null にする', () => {
    const deps = parseRequirementsTxt('numpy>=1.24');
    expect(deps[0]!.name).toBe('numpy');
    expect(deps[0]!.version).toBeNull();
  });

  it('バージョン指定なしを扱える', () => {
    const deps = parseRequirementsTxt('pandas');
    expect(deps[0]!).toEqual({
      ecosystem: 'pypi',
      name: 'pandas',
      version: null,
      scope: 'runtime',
    });
  });

  it('-r や -e で始まるディレクティブを無視する', () => {
    const deps = parseRequirementsTxt('-r base.txt\n-e .\n--index-url https://x\nrich==13.0.0');
    expect(deps).toHaveLength(1);
    expect(deps[0]!.name).toBe('rich');
  });

  it('環境マーカーを除去する', () => {
    const deps = parseRequirementsTxt('tomli==2.0.1 ; python_version < "3.11"');
    expect(deps[0]!.name).toBe('tomli');
    expect(deps[0]!.version).toBe('2.0.1');
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run tests/manifests/pypi.test.ts`
Expected: FAIL — `Cannot find module '../../src/manifests/pypi'`

- [ ] **Step 3: 実装**

```typescript
import type { Dependency } from '../types';

const NAME_AND_PIN = /^([A-Za-z0-9._-]+)\s*(?:\[[^\]]*\])?\s*(?:(==)\s*([^\s]+))?/;

/**
 * requirements.txt から依存を抽出する。
 * requirements.txt には dev/runtime の区別が存在しないため、全て runtime とする。
 */
export function parseRequirementsTxt(content: string): Dependency[] {
  const out: Dependency[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    // 環境マーカーと行末コメントを落とす
    let line = rawLine.split(';')[0] ?? '';
    line = line.split('#')[0] ?? '';
    line = line.trim();

    if (line === '') continue;
    // -r / -e / --index-url などのディレクティブ
    if (line.startsWith('-')) continue;

    const m = NAME_AND_PIN.exec(line);
    if (!m || !m[1]) continue;

    out.push({
      ecosystem: 'pypi',
      name: m[1],
      version: m[2] === '==' && m[3] ? m[3] : null,
      scope: 'runtime',
    });
  }

  return out;
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npx vitest run tests/manifests/pypi.test.ts`
Expected: PASS（8 tests）

- [ ] **Step 5: Commit**

```bash
git add src/manifests/pypi.ts tests/manifests/pypi.test.ts
git commit -m "feat: requirements.txt パーサを追加"
```

---

### Task 8: `go.mod` パーサ

**Files:**
- Create: `src/manifests/gomod.ts`
- Test: `tests/manifests/gomod.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```typescript
import { describe, expect, it } from 'vitest';
import { parseGoMod } from '../../src/manifests/gomod';

describe('parseGoMod', () => {
  it('require ブロック内の依存を取り出す', () => {
    const deps = parseGoMod(`module example.com/foo

go 1.21

require (
	github.com/gin-gonic/gin v1.9.1
	github.com/stretchr/testify v1.8.4
)
`);
    expect(deps).toEqual([
      { ecosystem: 'go', name: 'github.com/gin-gonic/gin', version: 'v1.9.1', scope: 'runtime' },
      { ecosystem: 'go', name: 'github.com/stretchr/testify', version: 'v1.8.4', scope: 'runtime' },
    ]);
  });

  it('単一行の require を取り出す', () => {
    const deps = parseGoMod('module m\n\nrequire github.com/x/y v1.0.0\n');
    expect(deps).toHaveLength(1);
    expect(deps[0]!.name).toBe('github.com/x/y');
  });

  it('// indirect のコメントを除去してもパースできる', () => {
    const deps = parseGoMod('require (\n\tgithub.com/a/b v1.2.3 // indirect\n)\n');
    expect(deps[0]!.version).toBe('v1.2.3');
  });

  it('module / go 行を依存として拾わない', () => {
    const deps = parseGoMod('module example.com/foo\n\ngo 1.21\n');
    expect(deps).toEqual([]);
  });

  it('replace / exclude ブロックを無視する', () => {
    const deps = parseGoMod(`require (
	github.com/a/b v1.0.0
)

replace (
	github.com/c/d => github.com/e/f v2.0.0
)
`);
    expect(deps).toHaveLength(1);
    expect(deps[0]!.name).toBe('github.com/a/b');
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run tests/manifests/gomod.test.ts`
Expected: FAIL — `Cannot find module '../../src/manifests/gomod'`

- [ ] **Step 3: 実装**

```typescript
import type { Dependency } from '../types';

const MODULE_LINE = /^([A-Za-z0-9._~/-]+\.[A-Za-z0-9._~/-]+)\s+(v[^\s]+)$/;

/**
 * go.mod から require の依存を抽出する。
 * go.mod には dev/runtime の区別が存在しないため、全て runtime とする。
 */
export function parseGoMod(content: string): Dependency[] {
  const out: Dependency[] = [];
  let block: 'require' | 'other' | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = (rawLine.split('//')[0] ?? '').trim();
    if (line === '') continue;

    if (line === ')') {
      block = null;
      continue;
    }

    const openBlock = /^(require|replace|exclude|retract)\s*\($/.exec(line);
    if (openBlock) {
      block = openBlock[1] === 'require' ? 'require' : 'other';
      continue;
    }

    const single = /^require\s+(.+)$/.exec(line);
    if (single && single[1]) {
      const m = MODULE_LINE.exec(single[1].trim());
      if (m && m[1] && m[2]) {
        out.push({ ecosystem: 'go', name: m[1], version: m[2], scope: 'runtime' });
      }
      continue;
    }

    if (block !== 'require') continue;

    const m = MODULE_LINE.exec(line);
    if (m && m[1] && m[2]) {
      out.push({ ecosystem: 'go', name: m[1], version: m[2], scope: 'runtime' });
    }
  }

  return out;
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npx vitest run tests/manifests/gomod.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: Commit**

```bash
git add src/manifests/gomod.ts tests/manifests/gomod.test.ts
git commit -m "feat: go.mod パーサを追加"
```

---

### Task 9: マニフェスト振り分け

**Files:**
- Create: `src/manifests/index.ts`
- Test: `tests/manifests/index.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```typescript
import { describe, expect, it } from 'vitest';
import { detectAndParse } from '../../src/manifests';

describe('detectAndParse', () => {
  it('JSON で dependencies を持てば npm と判定する', () => {
    const r = detectAndParse(JSON.stringify({ dependencies: { express: '4.18.2' } }));
    expect(r.ecosystem).toBe('npm');
    expect(r.dependencies).toHaveLength(1);
  });

  it('module 行があれば go と判定する', () => {
    const r = detectAndParse('module example.com/foo\n\nrequire github.com/x/y v1.0.0\n');
    expect(r.ecosystem).toBe('go');
  });

  it('require ブロックだけでも go と判定する', () => {
    const r = detectAndParse('require (\n\tgithub.com/a/b v1.0.0\n)\n');
    expect(r.ecosystem).toBe('go');
  });

  it('それ以外は pypi として扱う', () => {
    const r = detectAndParse('requests==2.31.0\nflask==3.0.0');
    expect(r.ecosystem).toBe('pypi');
    expect(r.dependencies).toHaveLength(2);
  });

  it('空入力は例外を投げる', () => {
    expect(() => detectAndParse('   ')).toThrow('入力が空です');
  });

  it('依存が1件も取れない場合は例外を投げる', () => {
    expect(() => detectAndParse('!!!!!')).toThrow('依存を検出できませんでした');
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run tests/manifests/index.test.ts`
Expected: FAIL — `Cannot find module '../../src/manifests'`

- [ ] **Step 3: 実装**

```typescript
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
    throw new Error('入力が空です');
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
      '依存を検出できませんでした。package.json / requirements.txt / go.mod のいずれかを貼り付けてください。',
    );
  }

  return result;
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npx vitest run tests/manifests/index.test.ts`
Expected: PASS（6 tests）

- [ ] **Step 5: Commit**

```bash
git add src/manifests/index.ts tests/manifests/index.test.ts
git commit -m "feat: マニフェスト振り分けを追加"
```

---

### Task 10: D1 スキーマとライセンスキャッシュ

**Files:**
- Create: `migrations/0001_init.sql`
- Create: `src/resolver/cache.ts`
- Test: `tests/resolver/cache.test.ts`

- [ ] **Step 1: マイグレーションを作成**

```sql
-- migrations/0001_init.sql

CREATE TABLE IF NOT EXISTS license_cache (
  ecosystem   TEXT NOT NULL,
  package     TEXT NOT NULL,
  version     TEXT NOT NULL,
  spdx        TEXT,
  source      TEXT NOT NULL,
  resolved_at INTEGER NOT NULL,
  PRIMARY KEY (ecosystem, package, version)
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  session_id TEXT NOT NULL,
  payload    TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_name_created ON events (name, created_at);
```

- [ ] **Step 2: 失敗するテストを書く**

```typescript
import { describe, expect, it } from 'vitest';
import { LicenseCache } from '../../src/resolver/cache';
import type { Dependency } from '../../src/types';

/** D1Database の最小スタブ */
function fakeDb() {
  const rows = new Map<string, { spdx: string | null; source: string }>();
  const calls = { get: 0, put: 0 };

  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>(): Promise<T | null> {
              calls.get += 1;
              const key = args.join('|');
              return (rows.get(key) as T) ?? null;
            },
            async run() {
              calls.put += 1;
              const [ecosystem, pkg, version, spdx, source] = args as string[];
              rows.set(`${ecosystem}|${pkg}|${version}`, {
                spdx: spdx ?? null,
                source: source ?? 'registry',
              });
              return { success: true };
            },
          };
        },
      };
    },
  };

  return { db: db as unknown as D1Database, calls, rows };
}

const dep = (over: Partial<Dependency> = {}): Dependency => ({
  ecosystem: 'npm',
  name: 'express',
  version: '4.18.2',
  scope: 'runtime',
  ...over,
});

describe('LicenseCache', () => {
  it('未登録なら null を返す', async () => {
    const { db } = fakeDb();
    const cache = new LicenseCache(db);
    expect(await cache.get(dep())).toBeNull();
  });

  it('put した値を get で取得できる', async () => {
    const { db } = fakeDb();
    const cache = new LicenseCache(db);
    await cache.put(dep(), 'MIT', 'registry');
    expect(await cache.get(dep())).toEqual({ spdx: 'MIT', source: 'registry' });
  });

  it('version が null の依存はキャッシュしない（キーが定まらないため）', async () => {
    const { db, calls } = fakeDb();
    const cache = new LicenseCache(db);
    await cache.put(dep({ version: null }), 'MIT', 'registry');
    expect(calls.put).toBe(0);
    expect(await cache.get(dep({ version: null }))).toBeNull();
    expect(calls.get).toBe(0);
  });
});
```

- [ ] **Step 3: テストを実行して失敗を確認**

Run: `npx vitest run tests/resolver/cache.test.ts`
Expected: FAIL — `Cannot find module '../../src/resolver/cache'`

- [ ] **Step 4: 実装**

```typescript
import type { Dependency } from '../types';

export interface CachedLicense {
  spdx: string | null;
  source: string;
}

/**
 * (ecosystem, package, version) に対するライセンスは不変であるため、
 * 全ユーザー共通でキャッシュする。version が確定していない依存はキーが
 * 定まらないためキャッシュ対象外とする。
 */
export class LicenseCache {
  constructor(private readonly db: D1Database) {}

  async get(dep: Dependency): Promise<CachedLicense | null> {
    if (dep.version === null) return null;

    const row = await this.db
      .prepare(
        'SELECT spdx, source FROM license_cache WHERE ecosystem = ? AND package = ? AND version = ?',
      )
      .bind(dep.ecosystem, dep.name, dep.version)
      .first<CachedLicense>();

    return row ?? null;
  }

  async put(dep: Dependency, spdx: string | null, source: string): Promise<void> {
    if (dep.version === null) return;

    await this.db
      .prepare(
        `INSERT INTO license_cache (ecosystem, package, version, spdx, source, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (ecosystem, package, version) DO UPDATE SET
           spdx = excluded.spdx,
           source = excluded.source,
           resolved_at = excluded.resolved_at`,
      )
      .bind(dep.ecosystem, dep.name, dep.version, spdx, source, Date.now())
      .run();
  }
}
```

- [ ] **Step 5: テストを実行して成功を確認**

Run: `npx vitest run tests/resolver/cache.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 6: Commit**

```bash
git add migrations/0001_init.sql src/resolver/cache.ts tests/resolver/cache.test.ts
git commit -m "feat: D1スキーマとライセンスキャッシュを追加"
```

---

### Task 11: npm レジストリ resolver

**Files:**
- Create: `src/resolver/npm.ts`
- Test: `tests/resolver/npm.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```typescript
import { describe, expect, it, vi } from 'vitest';
import { fetchNpmLicense } from '../../src/resolver/npm';

function mockFetch(body: unknown, ok = true) {
  return vi.fn(async () => ({
    ok,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe('fetchNpmLicense', () => {
  it('指定バージョンのライセンスを返す', async () => {
    const f = mockFetch({
      'dist-tags': { latest: '4.18.2' },
      versions: { '4.18.2': { license: 'MIT' } },
    });
    expect(await fetchNpmLicense('express', '4.18.2', f)).toBe('MIT');
  });

  it('version が null なら latest のライセンスを返す', async () => {
    const f = mockFetch({
      'dist-tags': { latest: '5.0.0' },
      versions: { '5.0.0': { license: 'Apache-2.0' } },
    });
    expect(await fetchNpmLicense('foo', null, f)).toBe('Apache-2.0');
  });

  it('レガシーなオブジェクト形式の license を扱う', async () => {
    const f = mockFetch({
      'dist-tags': { latest: '1.0.0' },
      versions: { '1.0.0': { license: { type: 'BSD-3-Clause', url: 'x' } } },
    });
    expect(await fetchNpmLicense('foo', '1.0.0', f)).toBe('BSD-3-Clause');
  });

  it('レガシーな licenses 配列を OR で結合する', async () => {
    const f = mockFetch({
      'dist-tags': { latest: '1.0.0' },
      versions: {
        '1.0.0': { licenses: [{ type: 'MIT' }, { type: 'GPL-2.0' }] },
      },
    });
    expect(await fetchNpmLicense('foo', '1.0.0', f)).toBe('(MIT OR GPL-2.0)');
  });

  it('ライセンス情報がなければ null を返す', async () => {
    const f = mockFetch({
      'dist-tags': { latest: '1.0.0' },
      versions: { '1.0.0': {} },
    });
    expect(await fetchNpmLicense('foo', '1.0.0', f)).toBeNull();
  });

  it('HTTP エラーなら null を返す', async () => {
    const f = mockFetch({}, false);
    expect(await fetchNpmLicense('foo', '1.0.0', f)).toBeNull();
  });

  it('スコープ付き名を URL エンコードする', async () => {
    const f = vi.fn(async (url: string) => {
      expect(url).toContain('%40types%2Fnode');
      return { ok: true, json: async () => ({ 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { license: 'MIT' } } }) };
    }) as unknown as typeof fetch;
    await fetchNpmLicense('@types/node', '1.0.0', f);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run tests/resolver/npm.test.ts`
Expected: FAIL — `Cannot find module '../../src/resolver/npm'`

- [ ] **Step 3: 実装**

```typescript
interface NpmVersionDoc {
  license?: string | { type?: string };
  licenses?: Array<{ type?: string }>;
}

interface NpmPackageDoc {
  'dist-tags'?: { latest?: string };
  versions?: Record<string, NpmVersionDoc>;
}

function normalizeLicenseField(doc: NpmVersionDoc): string | null {
  if (typeof doc.license === 'string' && doc.license.trim() !== '') {
    return doc.license.trim();
  }
  if (doc.license && typeof doc.license === 'object' && doc.license.type) {
    return doc.license.type;
  }
  if (Array.isArray(doc.licenses)) {
    const types = doc.licenses.map((l) => l.type).filter((t): t is string => !!t);
    if (types.length === 1) return types[0]!;
    if (types.length > 1) return `(${types.join(' OR ')})`;
  }
  return null;
}

/**
 * npm レジストリからライセンスを取得する。
 * version が null の場合は dist-tags.latest を用いる。
 */
export async function fetchNpmLicense(
  name: string,
  version: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`;

  let doc: NpmPackageDoc;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    doc = (await res.json()) as NpmPackageDoc;
  } catch {
    return null;
  }

  const target = version ?? doc['dist-tags']?.latest;
  if (!target) return null;

  const versionDoc = doc.versions?.[target];
  if (!versionDoc) return null;

  return normalizeLicenseField(versionDoc);
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npx vitest run tests/resolver/npm.test.ts`
Expected: PASS（7 tests）

- [ ] **Step 5: Commit**

```bash
git add src/resolver/npm.ts tests/resolver/npm.test.ts
git commit -m "feat: npm レジストリ resolver を追加"
```

---

### Task 12: PyPI resolver

PyPI の `info.license` は自由記述であり信頼できない。`classifiers` の `License :: OSI Approved :: ...` を優先する。

**Files:**
- Create: `src/resolver/pypi.ts`
- Test: `tests/resolver/pypi.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```typescript
import { describe, expect, it, vi } from 'vitest';
import { fetchPypiLicense } from '../../src/resolver/pypi';

function mockFetch(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

describe('fetchPypiLicense', () => {
  it('classifiers を info.license より優先する', async () => {
    const f = mockFetch({
      info: {
        license: 'see LICENSE file',
        classifiers: ['License :: OSI Approved :: Apache Software License'],
      },
    });
    expect(await fetchPypiLicense('foo', '1.0.0', f)).toBe('Apache-2.0');
  });

  it('MIT の classifier を SPDX に変換する', async () => {
    const f = mockFetch({
      info: { classifiers: ['License :: OSI Approved :: MIT License'] },
    });
    expect(await fetchPypiLicense('foo', null, f)).toBe('MIT');
  });

  it('classifier がなければ info.license が SPDX 相当なら採用する', async () => {
    const f = mockFetch({ info: { license: 'BSD-3-Clause', classifiers: [] } });
    expect(await fetchPypiLicense('foo', '1.0.0', f)).toBe('BSD-3-Clause');
  });

  it('info.license が自由記述なら null を返す', async () => {
    const f = mockFetch({ info: { license: 'see the LICENSE file for details', classifiers: [] } });
    expect(await fetchPypiLicense('foo', '1.0.0', f)).toBeNull();
  });

  it('HTTP エラーなら null を返す', async () => {
    expect(await fetchPypiLicense('foo', '1.0.0', mockFetch({}, false))).toBeNull();
  });

  it('version 指定時はバージョン付き URL を叩く', async () => {
    const f = vi.fn(async (url: string) => {
      expect(url).toBe('https://pypi.org/pypi/requests/2.31.0/json');
      return { ok: true, json: async () => ({ info: { classifiers: ['License :: OSI Approved :: MIT License'] } }) };
    }) as unknown as typeof fetch;
    await fetchPypiLicense('requests', '2.31.0', f);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run tests/resolver/pypi.test.ts`
Expected: FAIL — `Cannot find module '../../src/resolver/pypi'`

- [ ] **Step 3: 実装**

```typescript
/** PyPI trove classifier → SPDX 識別子 */
const CLASSIFIER_TO_SPDX: Record<string, string> = {
  'MIT License': 'MIT',
  'MIT No Attribution License (MIT-0)': 'MIT-0',
  'Apache Software License': 'Apache-2.0',
  'BSD License': 'BSD-3-Clause',
  'ISC License (ISCL)': 'ISC',
  'GNU General Public License v2 (GPLv2)': 'GPL-2.0-only',
  'GNU General Public License v3 (GPLv3)': 'GPL-3.0-only',
  'GNU General Public License v2 or later (GPLv2+)': 'GPL-2.0-or-later',
  'GNU General Public License v3 or later (GPLv3+)': 'GPL-3.0-or-later',
  'GNU Lesser General Public License v2 (LGPLv2)': 'LGPL-2.0-only',
  'GNU Lesser General Public License v3 (LGPLv3)': 'LGPL-3.0-only',
  'GNU Affero General Public License v3': 'AGPL-3.0-only',
  'GNU Affero General Public License v3 or later (AGPL v3+)': 'AGPL-3.0-or-later',
  'Mozilla Public License 2.0 (MPL 2.0)': 'MPL-2.0',
  'Eclipse Public License 2.0 (EPL-2.0)': 'EPL-2.0',
  'The Unlicense (Unlicense)': 'Unlicense',
  'Python Software Foundation License': 'Python-2.0',
  'zlib/libpng License': 'Zlib',
};

/** SPDX 識別子として妥当な形をしているか（自由記述の除外用） */
const SPDX_SHAPE = /^[A-Za-z0-9.+-]+$/;

interface PypiDoc {
  info?: { license?: string; classifiers?: string[] };
}

export async function fetchPypiLicense(
  name: string,
  version: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const url =
    version === null
      ? `https://pypi.org/pypi/${encodeURIComponent(name)}/json`
      : `https://pypi.org/pypi/${encodeURIComponent(name)}/${encodeURIComponent(version)}/json`;

  let doc: PypiDoc;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    doc = (await res.json()) as PypiDoc;
  } catch {
    return null;
  }

  // classifiers は構造化されており、自由記述の info.license より信頼できる
  for (const c of doc.info?.classifiers ?? []) {
    const tail = c.replace(/^License :: (OSI Approved :: )?/, '');
    const spdx = CLASSIFIER_TO_SPDX[tail];
    if (spdx) return spdx;
  }

  const raw = doc.info?.license?.trim();
  if (raw && SPDX_SHAPE.test(raw)) return raw;

  return null;
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npx vitest run tests/resolver/pypi.test.ts`
Expected: PASS（6 tests）

- [ ] **Step 5: Commit**

```bash
git add src/resolver/pypi.ts tests/resolver/pypi.test.ts
git commit -m "feat: PyPI resolver を追加"
```

---

### Task 13: ClearlyDefined resolver（Go 用）

Go モジュールには中央のライセンスメタデータが存在しないため、ClearlyDefined のキュレーション済みデータを用いる。

**Files:**
- Create: `src/resolver/clearlydefined.ts`
- Test: `tests/resolver/clearlydefined.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```typescript
import { describe, expect, it, vi } from 'vitest';
import { fetchGoLicense, toGoCoordinates } from '../../src/resolver/clearlydefined';

function mockFetch(body: unknown, ok = true) {
  return vi.fn(async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
}

describe('toGoCoordinates', () => {
  it('namespace のスラッシュをエンコードする', () => {
    expect(toGoCoordinates('github.com/gin-gonic/gin', 'v1.9.1')).toBe(
      'go/golang/github.com%2Fgin-gonic/gin/v1.9.1',
    );
  });

  it('深い階層は最後の要素を name、残りを namespace にする', () => {
    expect(toGoCoordinates('gopkg.in/yaml.v3', 'v3.0.1')).toBe(
      'go/golang/gopkg.in/yaml.v3/v3.0.1',
    );
  });

  it('スラッシュを含まないモジュールは namespace を - にする', () => {
    expect(toGoCoordinates('rsc.io', 'v1.0.0')).toBe('go/golang/-/rsc.io/v1.0.0');
  });
});

describe('fetchGoLicense', () => {
  it('licensed.declared を返す', async () => {
    const f = mockFetch({ licensed: { declared: 'MIT' } });
    expect(await fetchGoLicense('github.com/a/b', 'v1.0.0', f)).toBe('MIT');
  });

  it('NOASSERTION は null にする', async () => {
    const f = mockFetch({ licensed: { declared: 'NOASSERTION' } });
    expect(await fetchGoLicense('github.com/a/b', 'v1.0.0', f)).toBeNull();
  });

  it('version が null なら null を返す（座標が定まらないため）', async () => {
    const f = mockFetch({ licensed: { declared: 'MIT' } });
    expect(await fetchGoLicense('github.com/a/b', null, f)).toBeNull();
  });

  it('HTTP エラーなら null を返す', async () => {
    expect(await fetchGoLicense('github.com/a/b', 'v1.0.0', mockFetch({}, false))).toBeNull();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run tests/resolver/clearlydefined.test.ts`
Expected: FAIL — `Cannot find module '../../src/resolver/clearlydefined'`

- [ ] **Step 3: 実装**

```typescript
/**
 * Go モジュールパスを ClearlyDefined の座標 (type/provider/namespace/name/revision)
 * に変換する。namespace 内のスラッシュはエンコードが必要。
 */
export function toGoCoordinates(modulePath: string, version: string): string {
  const parts = modulePath.split('/');
  const name = parts.pop() ?? modulePath;
  const namespace = parts.length > 0 ? encodeURIComponent(parts.join('/')) : '-';
  return `go/golang/${namespace}/${name}/${version}`;
}

interface ClearlyDefinedDoc {
  licensed?: { declared?: string };
}

export async function fetchGoLicense(
  modulePath: string,
  version: string | null,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (version === null) return null;

  const url = `https://api.clearlydefined.io/definitions/${toGoCoordinates(modulePath, version)}`;

  let doc: ClearlyDefinedDoc;
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    doc = (await res.json()) as ClearlyDefinedDoc;
  } catch {
    return null;
  }

  const declared = doc.licensed?.declared?.trim();
  if (!declared || declared === 'NOASSERTION') return null;

  return declared;
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npx vitest run tests/resolver/clearlydefined.test.ts`
Expected: PASS（7 tests）

- [ ] **Step 5: Commit**

```bash
git add src/resolver/clearlydefined.ts tests/resolver/clearlydefined.test.ts
git commit -m "feat: ClearlyDefined resolver を追加"
```

---

### Task 14: 解決オーケストレータ

**Files:**
- Create: `src/resolver/index.ts`
- Test: `tests/resolver/index.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```typescript
import { describe, expect, it, vi } from 'vitest';
import { LicenseResolver } from '../../src/resolver';
import type { Dependency } from '../../src/types';

const dep = (over: Partial<Dependency> = {}): Dependency => ({
  ecosystem: 'npm',
  name: 'express',
  version: '4.18.2',
  scope: 'runtime',
  ...over,
});

function stubCache() {
  const store = new Map<string, { spdx: string | null; source: string }>();
  return {
    store,
    async get(d: Dependency) {
      if (d.version === null) return null;
      return store.get(`${d.ecosystem}|${d.name}|${d.version}`) ?? null;
    },
    async put(d: Dependency, spdx: string | null, source: string) {
      if (d.version === null) return;
      store.set(`${d.ecosystem}|${d.name}|${d.version}`, { spdx, source });
    },
  };
}

describe('LicenseResolver', () => {
  it('キャッシュヒット時はフェッチャを呼ばない', async () => {
    const cache = stubCache();
    await cache.put(dep(), 'MIT', 'registry');
    const npm = vi.fn();
    const r = new LicenseResolver(cache, { npm, pypi: vi.fn(), go: vi.fn() });

    const out = await r.resolve(dep());
    expect(out).toEqual({ spdx: 'MIT', resolvedFrom: 'cache' });
    expect(npm).not.toHaveBeenCalled();
  });

  it('キャッシュミス時はエコシステムに応じたフェッチャを呼びキャッシュに書く', async () => {
    const cache = stubCache();
    const npm = vi.fn(async () => 'Apache-2.0');
    const r = new LicenseResolver(cache, { npm, pypi: vi.fn(), go: vi.fn() });

    const out = await r.resolve(dep());
    expect(out).toEqual({ spdx: 'Apache-2.0', resolvedFrom: 'registry' });
    expect(npm).toHaveBeenCalledOnce();
    expect(cache.store.size).toBe(1);
  });

  it('go は clearlydefined を出典として記録する', async () => {
    const cache = stubCache();
    const go = vi.fn(async () => 'BSD-3-Clause');
    const r = new LicenseResolver(cache, { npm: vi.fn(), pypi: vi.fn(), go });

    const out = await r.resolve(dep({ ecosystem: 'go', name: 'github.com/a/b', version: 'v1.0.0' }));
    expect(out.resolvedFrom).toBe('clearlydefined');
  });

  it('解決できない場合は unresolved を返す', async () => {
    const cache = stubCache();
    const npm = vi.fn(async () => null);
    const r = new LicenseResolver(cache, { npm, pypi: vi.fn(), go: vi.fn() });

    const out = await r.resolve(dep());
    expect(out).toEqual({ spdx: null, resolvedFrom: 'unresolved' });
  });

  it('フェッチャが例外を投げても unresolved に落とす', async () => {
    const cache = stubCache();
    const npm = vi.fn(async () => {
      throw new Error('network down');
    });
    const r = new LicenseResolver(cache, { npm, pypi: vi.fn(), go: vi.fn() });

    const out = await r.resolve(dep());
    expect(out.resolvedFrom).toBe('unresolved');
  });

  it('resolveAll は全依存を解決する', async () => {
    const cache = stubCache();
    const npm = vi.fn(async () => 'MIT');
    const r = new LicenseResolver(cache, { npm, pypi: vi.fn(), go: vi.fn() });

    const out = await r.resolveAll([dep(), dep({ name: 'hono', version: '4.6.0' })]);
    expect(out).toHaveLength(2);
    expect(out.every((x) => x.spdx === 'MIT')).toBe(true);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run tests/resolver/index.test.ts`
Expected: FAIL — `Cannot find module '../../src/resolver'`

- [ ] **Step 3: 実装**

```typescript
import { fetchNpmLicense } from './npm';
import { fetchPypiLicense } from './pypi';
import { fetchGoLicense } from './clearlydefined';
import type { Dependency, ResolvedFrom } from '../types';

export interface Resolution {
  spdx: string | null;
  resolvedFrom: ResolvedFrom;
}

export interface CacheLike {
  get(dep: Dependency): Promise<{ spdx: string | null; source: string } | null>;
  put(dep: Dependency, spdx: string | null, source: string): Promise<void>;
}

export type Fetcher = (name: string, version: string | null) => Promise<string | null>;

export interface Fetchers {
  npm: Fetcher;
  pypi: Fetcher;
  go: Fetcher;
}

export const defaultFetchers: Fetchers = {
  npm: (n, v) => fetchNpmLicense(n, v),
  pypi: (n, v) => fetchPypiLicense(n, v),
  go: (n, v) => fetchGoLicense(n, v),
};

/** エコシステムごとの解決出典 */
const SOURCE: Record<Dependency['ecosystem'], ResolvedFrom> = {
  npm: 'registry',
  pypi: 'registry',
  go: 'clearlydefined',
};

/** 外部 API への同時接続数の上限 */
const CONCURRENCY = 8;

export class LicenseResolver {
  constructor(
    private readonly cache: CacheLike,
    private readonly fetchers: Fetchers = defaultFetchers,
  ) {}

  async resolve(dep: Dependency): Promise<Resolution> {
    const cached = await this.cache.get(dep);
    if (cached) {
      return { spdx: cached.spdx, resolvedFrom: 'cache' };
    }

    let spdx: string | null = null;
    try {
      spdx = await this.fetchers[dep.ecosystem](dep.name, dep.version);
    } catch {
      // ネットワーク障害等はブロック要因にせず unresolved に落とす
      return { spdx: null, resolvedFrom: 'unresolved' };
    }

    if (spdx === null) {
      return { spdx: null, resolvedFrom: 'unresolved' };
    }

    const source = SOURCE[dep.ecosystem];
    await this.cache.put(dep, spdx, source);
    return { spdx, resolvedFrom: source };
  }

  async resolveAll(deps: Dependency[]): Promise<Resolution[]> {
    const out: Resolution[] = new Array(deps.length);

    for (let i = 0; i < deps.length; i += CONCURRENCY) {
      const batch = deps.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map((d) => this.resolve(d)));
      results.forEach((r, j) => {
        out[i + j] = r;
      });
    }

    return out;
  }
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npx vitest run tests/resolver/index.test.ts`
Expected: PASS（6 tests）

- [ ] **Step 5: Commit**

```bash
git add src/resolver/index.ts tests/resolver/index.test.ts
git commit -m "feat: 解決オーケストレータを追加"
```

---

### Task 15: スキャンサービス

**Files:**
- Create: `src/scan.ts`
- Test: `tests/scan.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```typescript
import { describe, expect, it, vi } from 'vitest';
import { scan } from '../src/scan';
import type { CacheLike } from '../src/resolver';
import type { Dependency } from '../src/types';

function noopCache(): CacheLike {
  return { async get() { return null; }, async put() {} };
}

const fetchers = (map: Record<string, string | null>) => ({
  npm: async (n: string) => map[n] ?? null,
  pypi: async (n: string) => map[n] ?? null,
  go: async (n: string) => map[n] ?? null,
});

describe('scan', () => {
  it('package.json を判定して findings を返す', async () => {
    const content = JSON.stringify({
      dependencies: { express: '4.18.2' },
      devDependencies: { 'some-agpl-tool': '1.0.0' },
    });

    const result = await scan(content, 'saas', noopCache(), fetchers({
      express: 'MIT',
      'some-agpl-tool': 'AGPL-3.0-only',
    }));

    expect(result.ecosystem).toBe('npm');
    expect(result.findings).toHaveLength(2);

    const express = result.findings.find((f) => f.name === 'express')!;
    expect(express.verdict).toBe('allowed');

    // devDependency の AGPL は警告しない（差別化の中核）
    const tool = result.findings.find((f) => f.name === 'some-agpl-tool')!;
    expect(tool.verdict).toBe('allowed');
  });

  it('runtime の AGPL を SaaS で blocked にする', async () => {
    const content = JSON.stringify({ dependencies: { 'agpl-lib': '1.0.0' } });
    const result = await scan(content, 'saas', noopCache(), fetchers({ 'agpl-lib': 'AGPL-3.0-only' }));
    expect(result.findings[0]!.verdict).toBe('blocked');
    expect(result.summary.blocked).toBe(1);
  });

  it('同じ依存でも internal-only なら allowed になる', async () => {
    const content = JSON.stringify({ dependencies: { 'agpl-lib': '1.0.0' } });
    const result = await scan(content, 'internal-only', noopCache(), fetchers({ 'agpl-lib': 'AGPL-3.0-only' }));
    expect(result.findings[0]!.verdict).toBe('allowed');
  });

  it('解決できない依存は blocked かつ resolvedFrom が unresolved', async () => {
    const content = JSON.stringify({ dependencies: { mystery: '1.0.0' } });
    const result = await scan(content, 'saas', noopCache(), fetchers({}));
    expect(result.findings[0]!.resolvedFrom).toBe('unresolved');
    expect(result.findings[0]!.verdict).toBe('blocked');
  });

  it('Go は静的リンクを既定とする', async () => {
    const content = 'module m\n\nrequire github.com/a/b v1.0.0\n';
    const result = await scan(content, 'saas', noopCache(), fetchers({ 'github.com/a/b': 'LGPL-3.0-only' }));
    // 静的リンク既定のため review になる
    expect(result.findings[0]!.verdict).toBe('review');
  });

  it('summary を集計する', async () => {
    const content = JSON.stringify({
      dependencies: { a: '1.0.0', b: '1.0.0', c: '1.0.0' },
    });
    const result = await scan(content, 'saas', noopCache(), fetchers({
      a: 'MIT',
      b: 'AGPL-3.0-only',
      c: 'SSPL-1.0',
    }));
    expect(result.summary).toEqual({ total: 3, allowed: 1, review: 1, blocked: 1 });
  });

  it('limitations に直接依存のみである旨を含める', async () => {
    const content = JSON.stringify({ dependencies: { a: '1.0.0' } });
    const result = await scan(content, 'saas', noopCache(), fetchers({ a: 'MIT' }));
    expect(result.limitations.some((l) => l.includes('直接依存'))).toBe(true);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run tests/scan.test.ts`
Expected: FAIL — `Cannot find module '../src/scan'`

- [ ] **Step 3: 実装**

```typescript
import { detectAndParse } from './manifests';
import { LicenseResolver, defaultFetchers } from './resolver';
import type { CacheLike, Fetchers } from './resolver';
import { evaluateExpression } from './policy/engine';
import type {
  DistributionModel,
  Ecosystem,
  Finding,
  Linkage,
  ScanResult,
  ScanSummary,
} from './types';

/**
 * エコシステムごとのリンク形態の既定値。
 * インタプリタ言語は動的、コンパイル言語は静的として扱う。
 */
const DEFAULT_LINKAGE: Record<Ecosystem, Linkage> = {
  npm: 'dynamic',
  pypi: 'dynamic',
  go: 'static',
};

function summarize(findings: Finding[]): ScanSummary {
  return {
    total: findings.length,
    allowed: findings.filter((f) => f.verdict === 'allowed').length,
    review: findings.filter((f) => f.verdict === 'review').length,
    blocked: findings.filter((f) => f.verdict === 'blocked').length,
  };
}

function limitationsFor(ecosystem: Ecosystem, findings: Finding[]): string[] {
  const out = [
    'この結果は直接依存のみを対象としています。推移的依存（依存の依存）は含まれません。',
    'この結果はマニフェストに宣言されたライセンス情報に基づくものであり、ソースコード内に混入したコード片は検出していません。',
  ];

  if (ecosystem === 'go') {
    out.push('Go はリンク形態を静的として判定しています。');
  }

  if (findings.some((f) => f.version === null)) {
    out.push(
      'バージョンが範囲指定されている依存は、最新版のライセンスで判定しています。実際に導入されるバージョンとは異なる場合があります。',
    );
  }

  return out;
}

/**
 * マニフェストの内容を解析し、ライセンス判定結果を返す。
 */
export async function scan(
  content: string,
  distributionModel: DistributionModel,
  cache: CacheLike,
  fetchers: Fetchers = defaultFetchers,
): Promise<ScanResult> {
  const parsed = detectAndParse(content);
  const resolver = new LicenseResolver(cache, fetchers);
  const resolutions = await resolver.resolveAll(parsed.dependencies);
  const linkage = DEFAULT_LINKAGE[parsed.ecosystem];

  const findings: Finding[] = parsed.dependencies.map((dep, i) => {
    const res = resolutions[i]!;
    const policy = evaluateExpression(res.spdx, {
      scope: dep.scope,
      linkage,
      distributionModel,
    });

    return {
      ...dep,
      spdxExpression: res.spdx,
      resolvedFrom: res.resolvedFrom,
      verdict: policy.verdict,
      obligations: policy.obligations,
      rationale: policy.rationale,
    };
  });

  // 重い判定を上に出す
  const order = { blocked: 0, review: 1, allowed: 2 } as const;
  findings.sort((a, b) => order[a.verdict] - order[b.verdict]);

  return {
    ecosystem: parsed.ecosystem,
    distributionModel,
    findings,
    summary: summarize(findings),
    limitations: limitationsFor(parsed.ecosystem, findings),
  };
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npx vitest run tests/scan.test.ts`
Expected: PASS（7 tests）

- [ ] **Step 5: 全テストを実行**

Run: `npm test`
Expected: 全てPASS（合計 70 tests 前後）

- [ ] **Step 6: Commit**

```bash
git add src/scan.ts tests/scan.test.ts
git commit -m "feat: スキャンサービスを追加"
```

---

### Task 16: 無料ツールのHTMLページ

**Files:**
- Create: `src/ui/page.ts`
- Test: `tests/ui/page.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```typescript
import { describe, expect, it } from 'vitest';
import { renderPage } from '../../src/ui/page';

describe('renderPage', () => {
  it('免責文を含む', () => {
    const html = renderPage();
    expect(html).toContain('法的助言ではありません');
  });

  it('配布モデルの選択肢を全て含む', () => {
    const html = renderPage();
    for (const v of ['saas', 'distributed-binary', 'on-prem-delivery', 'internal-only', 'library-published']) {
      expect(html).toContain(`value="${v}"`);
    }
  });

  it('有料レポートCTAを含む', () => {
    expect(renderPage()).toContain('id="cta-paid-report"');
  });

  it('ダークモードに対応している', () => {
    expect(renderPage()).toContain('prefers-color-scheme: dark');
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run tests/ui/page.test.ts`
Expected: FAIL — `Cannot find module '../../src/ui/page'`

- [ ] **Step 3: 実装**

```typescript
export function renderPage(): string {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LicenseGuard — 依存ライセンスの適合チェック</title>
<meta name="description" content="package.json / requirements.txt / go.mod を貼り付けるだけで、依存OSSのライセンスがあなたの配布モデルに対して義務を発生させるかを判定します。">
<style>
:root{--bg:#fff;--fg:#16161a;--muted:#6b6b76;--line:#e4e4e8;--card:#fafafa;
--ok:#0a7c3f;--warn:#8a6100;--bad:#b3261e;--accent:#1a5fd0}
@media (prefers-color-scheme: dark){
:root{--bg:#111114;--fg:#eaeaef;--muted:#9a9aa6;--line:#2a2a31;--card:#1a1a1f;
--ok:#4ad07f;--warn:#e0b040;--bad:#ff6b5e;--accent:#6fa8ff}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
font:16px/1.65 system-ui,-apple-system,"Segoe UI","Hiragino Sans","Noto Sans JP",sans-serif}
.wrap{max-width:920px;margin:0 auto;padding:32px 20px 80px}
h1{font-size:1.6rem;margin:0 0 8px}
.sub{color:var(--muted);margin:0 0 28px}
label{display:block;font-weight:600;margin:20px 0 6px}
textarea{width:100%;min-height:220px;padding:12px;border:1px solid var(--line);
border-radius:8px;background:var(--card);color:var(--fg);
font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;resize:vertical}
select,button{font:inherit}
select{padding:9px 12px;border:1px solid var(--line);border-radius:8px;
background:var(--card);color:var(--fg);width:100%;max-width:420px}
button{padding:11px 22px;border:0;border-radius:8px;background:var(--accent);
color:#fff;font-weight:600;cursor:pointer}
button:disabled{opacity:.55;cursor:progress}
.hint{color:var(--muted);font-size:.85rem;margin-top:6px}
.summary{display:flex;gap:10px;flex-wrap:wrap;margin:24px 0 12px}
.chip{padding:6px 14px;border-radius:999px;border:1px solid var(--line);font-weight:600;font-size:.9rem}
.chip.bad{color:var(--bad);border-color:var(--bad)}
.chip.warn{color:var(--warn);border-color:var(--warn)}
.chip.ok{color:var(--ok);border-color:var(--ok)}
.f{border:1px solid var(--line);border-left-width:4px;border-radius:8px;
padding:14px 16px;margin-bottom:10px;background:var(--card)}
.f.blocked{border-left-color:var(--bad)}
.f.review{border-left-color:var(--warn)}
.f.allowed{border-left-color:var(--ok)}
.f h3{margin:0 0 4px;font-size:1rem;font-family:ui-monospace,monospace;word-break:break-all}
.meta{color:var(--muted);font-size:.82rem;margin-bottom:8px}
.why{font-size:.92rem;margin:0}
.limits{margin-top:28px;padding:14px 16px;border:1px solid var(--line);
border-radius:8px;color:var(--muted);font-size:.85rem}
.limits ul{margin:6px 0 0;padding-left:20px}
.cta{margin-top:28px;padding:22px;border:1px solid var(--accent);border-radius:10px;text-align:center}
.cta p{margin:0 0 14px}
.disclaimer{margin-top:40px;padding-top:18px;border-top:1px solid var(--line);
color:var(--muted);font-size:.8rem}
.err{color:var(--bad);font-weight:600;margin-top:14px}
.hidden{display:none}
</style>
</head>
<body>
<div class="wrap">
<h1>LicenseGuard</h1>
<p class="sub">依存OSSのライセンスが、あなたの配布モデルに対して義務を発生させるかを判定します。サインアップ不要。</p>

<label for="model">配布モデル</label>
<select id="model">
  <option value="saas">SaaS として外部提供する</option>
  <option value="distributed-binary">バイナリ・アプリとして配布する</option>
  <option value="on-prem-delivery">顧客環境に納品する</option>
  <option value="internal-only">社内でのみ利用する</option>
  <option value="library-published">ライブラリとして公開する</option>
</select>
<p class="hint">同じライセンスでも、配布モデルによって結論が変わります。</p>

<label for="content">マニフェストを貼り付け</label>
<textarea id="content" placeholder='package.json / requirements.txt / go.mod のいずれかをそのまま貼り付けてください'></textarea>
<p class="hint">貼り付けた内容はライセンス判定にのみ使用し、保存しません。</p>

<p style="margin-top:18px"><button id="run">判定する</button></p>
<p id="error" class="err hidden"></p>

<div id="result" class="hidden">
  <div class="summary" id="summary"></div>
  <div id="findings"></div>
  <div class="limits" id="limits"></div>
  <div class="cta">
    <p>この結果を、監査提出用のPDFレポートにまとめますか？<br>推移的依存まで含めた完全版を作成します。</p>
    <button id="cta-paid-report">有料レポートを見る（$199）</button>
    <p id="cta-thanks" class="hint hidden">ありがとうございます。準備ができ次第ご案内します。</p>
  </div>
</div>

<p class="disclaimer">
本ツールが提示するのは、公開されたライセンス条文と依存マニフェストに基づく情報であり、<strong>法的助言ではありません</strong>。
本ツールの利用によって弁護士・依頼者関係は成立しません。
判定はマニフェストに宣言されたライセンス情報に基づくものであり、全ての義務や違反を網羅するものではありません。
実際の判断にあたっては有資格の専門家にご相談ください。
</p>
</div>

<script>
const sid = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function track(name) {
  fetch('/api/track', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, sessionId: sid }),
  }).catch(() => {});
}

const LABEL = { allowed: '問題なし', review: '要確認', blocked: '義務が発生' };

$('run').addEventListener('click', async () => {
  const btn = $('run');
  const content = $('content').value;
  $('error').classList.add('hidden');

  if (!content.trim()) {
    $('error').textContent = 'マニフェストを貼り付けてください。';
    $('error').classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = '判定中…';
  track('scan_submitted');

  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content, distributionModel: $('model').value }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || '判定に失敗しました');

    $('summary').innerHTML =
      '<span class="chip bad">義務が発生 ' + data.summary.blocked + '</span>' +
      '<span class="chip warn">要確認 ' + data.summary.review + '</span>' +
      '<span class="chip ok">問題なし ' + data.summary.allowed + '</span>';

    $('findings').innerHTML = data.findings.map((f) =>
      '<div class="f ' + f.verdict + '">' +
        '<h3>' + esc(f.name) + (f.version ? '@' + esc(f.version) : '') + '</h3>' +
        '<p class="meta">' + LABEL[f.verdict] + ' ・ ' +
          esc(f.spdxExpression || 'ライセンス不明') + ' ・ ' + esc(f.scope) + '</p>' +
        '<p class="why">' + esc(f.rationale) + '</p>' +
      '</div>'
    ).join('');

    $('limits').innerHTML = '<strong>この結果の限界</strong><ul>' +
      data.limitations.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul>';

    $('result').classList.remove('hidden');
    track('scan_succeeded');
  } catch (e) {
    $('error').textContent = e.message;
    $('error').classList.remove('hidden');
    track('scan_failed');
  } finally {
    btn.disabled = false;
    btn.textContent = '判定する';
  }
});

$('cta-paid-report').addEventListener('click', () => {
  track('cta_paid_report_clicked');
  $('cta-thanks').classList.remove('hidden');
});
</script>
</body>
</html>`;
}
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npx vitest run tests/ui/page.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add src/ui/page.ts tests/ui/page.test.ts
git commit -m "feat: 無料ツールのUIページを追加"
```

---

### Task 17: HTTP ルーティング

**Files:**
- Create: `src/index.ts`
- Test: `tests/index.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```typescript
import { describe, expect, it, vi } from 'vitest';
import app from '../src/index';

/** D1Database の最小スタブ */
function fakeEnv() {
  const inserted: unknown[][] = [];
  return {
    inserted,
    env: {
      DB: {
        prepare() {
          return {
            bind(...args: unknown[]) {
              return {
                async first() { return null; },
                async run() { inserted.push(args); return { success: true }; },
              };
            },
          };
        },
      } as unknown as D1Database,
    },
  };
}

describe('app', () => {
  it('GET / はHTMLを返す', async () => {
    const { env } = fakeEnv();
    const res = await app.request('/', {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('LicenseGuard');
  });

  it('GET /healthz は ok を返す', async () => {
    const { env } = fakeEnv();
    const res = await app.request('/healthz', {}, env);
    expect(res.status).toBe(200);
  });

  it('POST /api/scan は content 未指定で 400', async () => {
    const { env } = fakeEnv();
    const res = await app.request('/api/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ distributionModel: 'saas' }),
    }, env);
    expect(res.status).toBe(400);
  });

  it('POST /api/scan は不正な配布モデルで 400', async () => {
    const { env } = fakeEnv();
    const res = await app.request('/api/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '{"dependencies":{}}', distributionModel: 'nonsense' }),
    }, env);
    expect(res.status).toBe(400);
  });

  it('POST /api/scan はパース不能な入力で 400 とメッセージを返す', async () => {
    const { env } = fakeEnv();
    const res = await app.request('/api/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '!!!!!', distributionModel: 'saas' }),
    }, env);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('依存を検出できませんでした');
  });

  it('POST /api/scan は 100KB を超える入力を 413 で拒否する', async () => {
    const { env } = fakeEnv();
    const res = await app.request('/api/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'x'.repeat(100_001), distributionModel: 'saas' }),
    }, env);
    expect(res.status).toBe(413);
  });

  it('POST /api/track はイベントを記録して 204 を返す', async () => {
    const { env, inserted } = fakeEnv();
    const res = await app.request('/api/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'cta_paid_report_clicked', sessionId: 'abc' }),
    }, env);
    expect(res.status).toBe(204);
    expect(inserted).toHaveLength(1);
  });

  it('POST /api/track は不正なイベント名を無視して 204 を返す', async () => {
    const { env, inserted } = fakeEnv();
    const res = await app.request('/api/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x'.repeat(200), sessionId: 'abc' }),
    }, env);
    expect(res.status).toBe(204);
    expect(inserted).toHaveLength(0);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `npx vitest run tests/index.test.ts`
Expected: FAIL — `Cannot find module '../src/index'`

- [ ] **Step 3: 実装**

```typescript
import { Hono } from 'hono';
import { renderPage } from './ui/page';
import { scan } from './scan';
import { LicenseCache } from './resolver/cache';
import type { DistributionModel } from './types';

type Env = { Bindings: { DB: D1Database } };

const app = new Hono<Env>();

const MAX_CONTENT_BYTES = 100_000;

const DISTRIBUTION_MODELS: readonly DistributionModel[] = [
  'saas',
  'distributed-binary',
  'on-prem-delivery',
  'internal-only',
  'library-published',
];

const TRACKED_EVENTS = new Set([
  'scan_submitted',
  'scan_succeeded',
  'scan_failed',
  'cta_paid_report_clicked',
]);

app.get('/', (c) =>
  c.html(renderPage(), 200, {
    'cache-control': 'public, max-age=300',
  }),
);

app.get('/healthz', (c) => c.json({ ok: true }));

app.post('/api/scan', async (c) => {
  let body: { content?: unknown; distributionModel?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'リクエストボディが JSON として解釈できません。' }, 400);
  }

  const { content, distributionModel } = body;

  if (typeof content !== 'string' || content.trim() === '') {
    return c.json({ error: 'content は必須です。' }, 400);
  }

  // D1 の 1 ステートメント上限と処理時間の両方を考慮した入力上限。
  // UTF-8 バイト数で計測する（String.length は UTF-16 単位のため過小評価となる）
  if (new TextEncoder().encode(content).length > MAX_CONTENT_BYTES) {
    return c.json({ error: '入力が大きすぎます（上限 100KB）。' }, 413);
  }

  if (!DISTRIBUTION_MODELS.includes(distributionModel as DistributionModel)) {
    return c.json({ error: '配布モデルの指定が不正です。' }, 400);
  }

  const cache = new LicenseCache(c.env.DB);

  try {
    const result = await scan(content, distributionModel as DistributionModel, cache);
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : '判定に失敗しました。' }, 400);
  }
});

app.post('/api/track', async (c) => {
  try {
    const { name, sessionId } = (await c.req.json()) as {
      name?: unknown;
      sessionId?: unknown;
    };

    if (typeof name === 'string' && TRACKED_EVENTS.has(name) && typeof sessionId === 'string') {
      await c.env.DB.prepare(
        'INSERT INTO events (name, session_id, payload, created_at) VALUES (?, ?, ?, ?)',
      )
        .bind(name, sessionId.slice(0, 64), null, Date.now())
        .run();
    }
  } catch {
    // 計測の失敗はユーザー体験に影響させない
  }

  return c.body(null, 204);
});

export default app;
```

- [ ] **Step 4: テストを実行して成功を確認**

Run: `npx vitest run tests/index.test.ts`
Expected: PASS（8 tests）

- [ ] **Step 5: 全テストと型チェック**

Run: `npm test && npm run typecheck`
Expected: 全てPASS、型エラーなし

- [ ] **Step 6: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: HTTPルーティングを追加"
```

---

### Task 18: 実データによる検証

外部APIの実挙動を確認する。ネットワークに依存するため、通常のテストスイートとは分離する。

**Files:**
- Create: `scripts/smoke.ts`

- [ ] **Step 1: スモークスクリプトを作成**

```typescript
// scripts/smoke.ts
// 実ネットワークに接続して resolver の実挙動を確認する。
// Run: npx tsx scripts/smoke.ts
import { fetchNpmLicense } from '../src/resolver/npm';
import { fetchPypiLicense } from '../src/resolver/pypi';
import { fetchGoLicense } from '../src/resolver/clearlydefined';

const cases: Array<[string, Promise<string | null>, string]> = [
  ['npm express@4.18.2', fetchNpmLicense('express', '4.18.2'), 'MIT'],
  ['npm @types/node', fetchNpmLicense('@types/node', null), 'MIT'],
  ['pypi requests@2.31.0', fetchPypiLicense('requests', '2.31.0'), 'Apache-2.0'],
  ['pypi flask', fetchPypiLicense('flask', null), 'BSD-3-Clause'],
  ['go gin@v1.9.1', fetchGoLicense('github.com/gin-gonic/gin', 'v1.9.1'), 'MIT'],
];

let failed = 0;

for (const [label, promise, expected] of cases) {
  const actual = await promise;
  const ok = actual === expected;
  if (!ok) failed += 1;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label} -> ${actual} (expected ${expected})`);
}

console.log(failed === 0 ? '\nすべて期待通りです。' : `\n${failed} 件が期待と異なります。`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 2: 実行して結果を確認**

Run: `npx tsx scripts/smoke.ts`
Expected: 全て `OK`。FAIL が出た場合、期待値の方が誤っている可能性があるため、実際のレジストリの値を確認してから該当 resolver を修正する。

- [ ] **Step 3: Commit**

```bash
git add scripts/smoke.ts
git commit -m "test: resolver のスモークスクリプトを追加"
```

---

### Task 19: デプロイ

**Files:**
- Modify: `wrangler.toml`

- [ ] **Step 1: D1 データベースを作成**

Run: `npx wrangler d1 create license-guard`
Expected: `database_id = "..."` を含む出力

- [ ] **Step 2: `wrangler.toml` の `database_id` を実IDに差し替え**

`PLACEHOLDER_REPLACED_AT_DEPLOY` を Step 1 で得た UUID に置換する。

- [ ] **Step 3: ローカルDBにマイグレーションを適用**

Run: `npm run db:migrate:local`
Expected: `0001_init.sql` が適用された旨の出力

- [ ] **Step 4: ローカルで起動して動作確認**

Run: `npm run dev`

ブラウザで `http://localhost:8787` を開き、以下を確認する。

- `{"dependencies":{"express":"4.18.2"},"devDependencies":{"grafana-fake":"1.0.0"}}` を貼り付けて判定が返る
- 配布モデルを `SaaS` → `社内でのみ利用する` に切り替えると AGPL の判定が変わる
- 「有料レポートを見る」を押すとメッセージが出る

- [ ] **Step 5: 本番DBにマイグレーションを適用してデプロイ**

Run: `npm run db:migrate && npm run deploy`
Expected: `https://license-guard.<subdomain>.workers.dev` が払い出される

- [ ] **Step 6: 本番の疎通確認**

Run: `curl -s https://license-guard.<subdomain>.workers.dev/healthz`
Expected: `{"ok":true}`

- [ ] **Step 7: Commit**

```bash
git add wrangler.toml
git commit -m "chore: D1 database_id を設定しデプロイ可能にする"
```

---

## 計測とPhase 0の判断

デプロイ後、以下のSQLでCTAクリック率を確認する。

```sql
SELECT
  (SELECT COUNT(DISTINCT session_id) FROM events WHERE name = 'scan_succeeded') AS scanned,
  (SELECT COUNT(DISTINCT session_id) FROM events WHERE name = 'cta_paid_report_clicked') AS clicked;
```

Run: `npx wrangler d1 execute license-guard --remote --command "<上記SQL>"`

**判断基準:** 判定を完了したセッションのうち、CTAをクリックした割合。

- 5%以上 → Phase 1（GitHub App）へ進む
- 1〜5% → 訴求文と価格の検証を継続。CTAの文言を変えて再計測
- 1%未満 → 買い手仮説の誤りを疑う。想定顧客を「資金調達準備中のCTO / 受託開発会社 / 上場準備企業」に切り替え、スポット監査レポートの直接販売を先行させる

---

## Done定義

- [ ] 無料Webツールが npm / PyPI / Go のマニフェストを受け付け、ライセンス判定結果を表示する
- [ ] 配布モデルの変更により判定が変化する（AGPL が saas で blocked、internal-only で allowed）
- [ ] devDependency の AGPL を警告しない
- [ ] 解決できない依存を blocked として扱い、その旨が表示される
- [ ] 「有料レポート取得」ボタンのクリック率が計測できる
- [ ] 判定結果が「法的助言ではない」旨を明示している
- [ ] 結果の限界（直接依存のみ、宣言ベース）が画面に表示される
- [ ] `npm test` が全てPASSする
- [ ] `npm run typecheck` が通る
- [ ] 本番URLで疎通確認が取れている
