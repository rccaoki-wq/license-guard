import { describe, expect, it } from 'vitest';
import { scan } from '../src/scan';
import type { CacheLike, Fetchers } from '../src/resolver';

const noopCache: CacheLike = {
  async get() {
    return null;
  },
  async put() {},
};

function fetchers(over: Partial<Fetchers> = {}): Fetchers {
  const nope = async () => ({ spdx: null });
  return { npm: nope, pypi: nope, go: nope, cargo: nope, rubygems: nope, nuget: nope, ...over };
}

const CSPROJ = `<Project Sdk="Microsoft.NET.Sdk"><ItemGroup>
  <PackageReference Include="AutoMapper" Version="16.2.0" />
</ItemGroup></Project>`;

/**
 * 「答えが無い」にも種類がある。**種類ごとに違う文言でなければ、
 * 説明が事実と食い違う。**
 */
describe('答えが無い理由ごとに、事実に合った文言を返す', () => {
  it('本文同梱を「上流が返さなかった」と説明しない', async () => {
    const r = await scan(
      CSPROJ,
      'distributed-binary',
      noopCache,
      fetchers({ nuget: async () => ({ spdx: null, source: 'license-file' as const }) }),
    );

    const f = r.findings.find((x) => x.name === 'AutoMapper')!;
    expect(f.resolvedFrom).toBe('license-file');
    // 宣言はある——読めない形で置いてあるだけ
    expect(f.rationale).not.toContain('did not return');
    expect(f.rationale).not.toContain('none is declared');
    expect(f.rationale).toContain('text file inside the package');
    // 確認できていない以上 allowed にはしない
    expect(f.verdict).toBe('review');
  });

  it('条件の中身までは主張しない', async () => {
    const r = await scan(
      CSPROJ,
      'distributed-binary',
      noopCache,
      fetchers({ nuget: async () => ({ spdx: null, source: 'license-file' as const }) }),
    );
    const f = r.findings.find((x) => x.name === 'AutoMapper')!;

    // type="file" は非標準の条件を意味しない。実測では MIT の本文を
    // そのまま同梱している発行者もいた（Microsoft.NET.Workload.*）
    expect(f.rationale).toContain('says nothing about the terms');
    expect(f.obligations).toEqual([]);
  });

  it('宣言がどこにも無い場合は今までどおりの文言のまま', async () => {
    const r = await scan(CSPROJ, 'distributed-binary', noopCache, fetchers());
    const f = r.findings.find((x) => x.name === 'AutoMapper')!;
    expect(f.resolvedFrom).toBe('unresolved');
    expect(f.rationale).toContain('could not be determined');
  });
});

describe('私設レジストリの案内は、その系の公開レジストリを名指しする', () => {
  const CARGO = `[[package]]
name = "internal_crate"
version = "1.0.0"
source = "registry+https://internal.example.com/index"

[[package]]
name = "serde"
version = "1.0.0"
source = "registry+https://github.com/rust-lang/crates.io-index"
`;

  it('Cargo では crates.io', async () => {
    const r = await scan(CARGO, 'saas', noopCache, fetchers({ cargo: async () => ({ spdx: 'MIT' }) }));
    const f = r.findings.find((x) => x.name === 'internal_crate')!;
    expect(f.rationale).toContain('crates.io');
  });

  it('Ruby の利用者に crates.io と言わない', async () => {
    // 移植のときに決め打ちが残っていて、Rust を一行も書いていない人に
    // 「crates.io 以外から来ています」と返っていた
    const GEMFILE = `GEM
  remote: https://gems.acme.internal/
  specs:
    acme_internal (1.2.3)

PLATFORMS
  ruby

DEPENDENCIES
  acme_internal
`;
    const r = await scan(GEMFILE, 'saas', noopCache, fetchers());
    const f = r.findings.find((x) => x.name === 'acme_internal')!;
    // 条件付きにすると、経路が変わったとき素通りして緑になる
    expect(f.origin).toBe('other-registry');
    expect(f.resolvedFrom).toBe('not-published');
    expect(f.rationale).toContain('RubyGems.org');
    expect(f.rationale).not.toContain('crates.io');
  });
});
