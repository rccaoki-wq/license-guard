import { categorize } from './categories';
import type { Obligation, PolicyContext, PolicyResult } from '../types';

/** 成果物に含まれず、配布時の義務が発生しないスコープ */
const NON_SHIPPING_SCOPES = new Set<string>(['dev', 'build', 'test']);

/** ソフトウェアが第三者の手に渡る配布モデル */
const DISTRIBUTING_MODELS = new Set<string>([
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
export function evaluateLicense(licenseId: string, ctx: PolicyContext): PolicyResult {
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
      if (licenseId.trim().toLowerCase() === 'apache-2.0') {
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
