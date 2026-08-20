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

/** 配布モデルの人間可読ラベル。理由文に埋め込む */
const MODEL_LABEL: Record<string, string> = {
  saas: 'hosted SaaS',
  'distributed-binary': 'distributed binary or application',
  'on-prem-delivery': 'software delivered to a customer environment',
  'internal-only': 'internal use only',
  'library-published': 'a published library',
};

/**
 * 単一の SPDX ライセンス識別子を、利用文脈のもとで判定する。
 * 純粋関数。外部 I/O を持たないこと。
 *
 * rationale は事実の提示に限定する。条項を引用し、判断を下す表現
 * （"you should" / "we recommend" 等）を含めてはならない。
 */
export function evaluateLicense(licenseId: string, ctx: PolicyContext): PolicyResult {
  const category = categorize(licenseId);
  const model = MODEL_LABEL[ctx.distributionModel] ?? ctx.distributionModel;

  if (category === 'none') {
    return {
      verdict: 'blocked',
      obligations: [],
      rationale:
        'No license is declared. A work published without a license is by default all rights reserved, which leaves no grant permitting use, copying, or redistribution.',
    };
  }

  // 成果物に含まれないスコープでは、配布に伴う義務は発生しない。
  // ただしコード生成器など、出力に影響しうるツールは個別確認が必要。
  if (NON_SHIPPING_SCOPES.has(ctx.scope)) {
    return {
      verdict: 'allowed',
      obligations: [],
      rationale: `${licenseId} appears as a ${ctx.scope} dependency, so it is not part of the artifact you ship. Distribution-triggered obligations do not arise. Tools that emit code into your output, such as code generators, are a separate case worth checking individually.`,
    };
  }

  switch (category) {
    case 'public-domain':
      return {
        verdict: 'allowed',
        obligations: [],
        rationale: `${licenseId} is a public-domain dedication or equivalent. It carries no conditions on use.`,
      };

    case 'permissive': {
      const obligations: Obligation[] = ['attribution'];
      if (licenseId.trim().toLowerCase() === 'apache-2.0') {
        obligations.push('notice-file', 'patent-grant');
        return {
          verdict: 'allowed',
          obligations,
          rationale:
            'Apache-2.0 section 4 requires retaining copyright notices, a copy of the license, and any NOTICE file. Section 3 grants a patent license from contributors. There is no source-disclosure obligation.',
        };
      }
      return {
        verdict: 'allowed',
        obligations,
        rationale: `${licenseId} requires retaining the copyright notice and the license text. There is no source-disclosure obligation.`,
      };
    }

    case 'weak-copyleft': {
      if (ctx.linkage === 'static') {
        return {
          verdict: 'review',
          obligations: ['source-disclosure', 'attribution'],
          rationale: `${licenseId} requires that recipients be able to replace the library with a modified version. Under static linking this normally means shipping object files or equivalent relinking material. Static linking was assumed here, so this case needs individual review.`,
        };
      }
      return {
        verdict: 'allowed',
        obligations: ['source-disclosure', 'attribution'],
        rationale: `${licenseId} requires publishing modifications to the library itself, but under dynamic linking that obligation does not extend to the code that calls it.`,
      };
    }

    case 'strong-copyleft': {
      if (DISTRIBUTING_MODELS.has(ctx.distributionModel)) {
        return {
          verdict: 'blocked',
          obligations: ['source-disclosure', 'same-license'],
          rationale: `${licenseId} requires that a work incorporating it, when distributed, be licensed as a whole under the same terms with corresponding source made available. Your distribution model is ${model}, which triggers that obligation.`,
        };
      }
      return {
        verdict: 'allowed',
        obligations: [],
        rationale: `${licenseId} triggers its obligations on distribution. Your distribution model is ${model}, which is not distribution, so no obligation arises today. Shipping this software later — on-premises delivery, a binary, or a published library — would trigger whole-work source disclosure.`,
      };
    }

    case 'network-copyleft': {
      if (ctx.distributionModel === 'internal-only') {
        return {
          verdict: 'allowed',
          obligations: [],
          rationale: `${licenseId} section 13 applies when users interact with the software remotely over a network, and its inherited GPL terms apply on distribution. Your distribution model is ${model}, so neither obligation arises.`,
        };
      }

      // AGPL には2つの独立した引き金がある。SaaS はネットワーク条項（第13条）、
      // 配布は GPL 由来の配布条項。根拠を取り違えないよう分岐する。
      if (DISTRIBUTING_MODELS.has(ctx.distributionModel)) {
        return {
          verdict: 'blocked',
          obligations: ['source-disclosure', 'same-license'],
          rationale: `${licenseId} carries the GPL-3.0 copyleft terms it is built on: distributing a work that incorporates it requires licensing the whole work under the same terms with corresponding source made available. Your distribution model is ${model}, which is distribution and triggers that obligation. Section 13 additionally extends this over a network, so hosting the same code would not avoid it.`,
        };
      }

      return {
        verdict: 'blocked',
        obligations: ['source-disclosure', 'same-license'],
        rationale: `${licenseId} section 13 requires that users interacting with a modified version over a network be offered the corresponding source of the whole work. Your distribution model is ${model}, which triggers that obligation. This is the clause that makes AGPL behave differently from GPL for hosted services.`,
      };
    }

    case 'source-available':
      return {
        verdict: 'review',
        obligations: [],
        rationale: `${licenseId} is not an OSI-approved open source license. Licenses in this family commonly restrict offering the software as a commercial or competing service. The specific terms need individual review.`,
      };

    case 'non-commercial':
      return {
        verdict: 'blocked',
        obligations: [],
        rationale: `${licenseId} permits non-commercial use only and does not grant rights for commercial use.`,
      };

    case 'unknown':
    default:
      return {
        verdict: 'review',
        obligations: [],
        rationale: `${licenseId} does not match a known license identifier. The license text needs individual review.`,
      };
  }
}
