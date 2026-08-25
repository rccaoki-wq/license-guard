import { describe, expect, it } from 'vitest';
import { parseTomlPackages } from '../../src/manifests/toml-packages';
import { scan } from '../../src/scan';

const CARGO = `
[[package]]
name = "serde"
version = "1.0.210"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "my_app"
version = "0.1.0"

[[package]]
name = "some_fork"
version = "0.3.0"
source = "git+https://github.com/acme/some_fork?rev=abc123#abc123"

[[package]]
name = "internal_registry_crate"
version = "2.0.0"
source = "sparse+https://crates.acme.internal/index/"
`;

describe('Cargo.lock の source から出所を読む', () => {
  it('crates.io / ワークスペース / git / 私設レジストリを区別する', () => {
    const deps = parseTomlPackages(CARGO, 'cargo');
    const by = Object.fromEntries(deps.map((d) => [d.name, d.origin]));

    expect(by['serde']).toBe('registry');
    // source 行が無い = このロックファイル自身のワークスペースメンバー
    expect(by['my_app']).toBe('workspace');
    expect(by['some_fork']).toBe('git');
    // 公開レジストリではないので crates.io に問い合わせても無い
    expect(by['internal_registry_crate']).toBe('other-registry');
  });

  it('poetry / uv には source 行が無いが、workspace 扱いにしない', () => {
    // Cargo.lock 以外の [[package]] 形式まで巻き込むと、解決できるものを
    // 照会しなくなる。判定は Cargo.lock の書式に対してのみ行う
    const poetry = `
[[package]]
name = "requests"
version = "2.32.3"
description = "HTTP for Humans"
`;
    const deps = parseTomlPackages(poetry, 'pypi');
    expect(deps[0]!.origin).toBeUndefined();
  });
});

describe('公開レジストリに無いと分かっている依存を照会しない', () => {
  const noopCache = { async get() { return null; }, async put() {} };

  it('照会もせず、上限の枠も消費しない', async () => {
    let calls = 0;
    const fetchers = {
      npm: async () => ({ spdx: null }),
      pypi: async () => ({ spdx: null }),
      go: async () => ({ spdx: null }),
      cargo: async () => {
        calls += 1;
        return { spdx: 'MIT' };
      },
    };

    const r = await scan(CARGO, 'saas', noopCache, fetchers);

    // serde だけが crates.io にある
    expect(calls).toBe(1);
    expect(r.summary.total).toBe(4);
  });

  it('黙って消さず、確認していない理由を名指しする', async () => {
    const fetchers = {
      npm: async () => ({ spdx: null }),
      pypi: async () => ({ spdx: null }),
      go: async () => ({ spdx: null }),
      cargo: async () => ({ spdx: 'MIT' }),
    };
    const r = await scan(CARGO, 'saas', noopCache, fetchers);

    const own = r.findings.find((f) => f.name === 'my_app')!;
    const git = r.findings.find((f) => f.name === 'some_fork')!;

    // 上限に達したわけではないので not-checked ではない
    expect(own.resolvedFrom).toBe('not-published');
    expect(git.resolvedFrom).toBe('not-published');
    // 確認できていない以上、allowed にはならない
    expect(own.verdict).not.toBe('allowed');
    expect(git.verdict).not.toBe('allowed');
    // 「レジストリが答えなかった」ではなく「レジストリに無い」と言う
    expect(own.rationale).toMatch(/workspace/i);
    expect(git.rationale).toMatch(/git/i);
  });
});
