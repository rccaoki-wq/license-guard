import { describe, expect, it } from 'vitest';
import { detectAndParse } from '../../src/manifests';
import { isPyprojectToml, parsePyprojectToml } from '../../src/manifests/pyproject';

const byName = (deps: ReturnType<typeof parsePyprojectToml>) =>
  Object.fromEntries(deps.map((d) => [d.name, d.scope]));

describe('pyproject.toml (PEP 621)', () => {
  const PEP621 = `[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "myapp"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "requests>=2.31.0",
    "flask~=3.0",
    "tomli ; python_version < '3.11'",
]

[project.optional-dependencies]
postgres = ["psycopg2-binary>=2.9"]

[dependency-groups]
dev = ["pytest>=8.0", "ruff"]
`;

  it('認識する', () => {
    expect(isPyprojectToml(PEP621)).toBe(true);
  });

  it('[project] dependencies を runtime として読む', () => {
    const m = byName(parsePyprojectToml(PEP621));
    expect(m['requests']).toBe('runtime');
    expect(m['flask']).toBe('runtime');
    expect(m['tomli']).toBe('runtime');
  });

  it('extras は dev ではなく、出荷されうるものとして扱う', () => {
    // [project.optional-dependencies] は「追加機能」であって
    // 「開発用」ではない。myapp[postgres] を入れた利用者には同梱される。
    // dev に倒すと義務が丸ごと消える（dev スコープは無条件 allowed）
    const m = byName(parsePyprojectToml(PEP621));
    expect(m['psycopg2-binary']).toBe('optional');
  });

  it('[dependency-groups] は dev として読む（PEP 735）', () => {
    const m = byName(parsePyprojectToml(PEP621));
    expect(m['pytest']).toBe('dev');
    expect(m['ruff']).toBe('dev');
  });

  it('build-system.requires を依存として拾わない', () => {
    const m = byName(parsePyprojectToml(PEP621));
    expect(m['hatchling']).toBeUndefined();
  });

  it('メタデータのキーを依存として拾わない', () => {
    const m = byName(parsePyprojectToml(PEP621));
    for (const junk of ['name', 'version', 'requires-python', 'build-backend']) {
      expect(m[junk], junk).toBeUndefined();
    }
  });

  it('detectAndParse が pypi として読む', () => {
    const r = detectAndParse(PEP621);
    expect(r.ecosystem).toBe('pypi');
    // pyproject.toml は直接依存しか持たない
    expect(r.transitive).toBe(false);
    expect(r.dependencies.length).toBeGreaterThanOrEqual(6);
  });
});

describe('pyproject.toml (Poetry)', () => {
  const POETRY = `[tool.poetry]
name = "myapp"
version = "0.1.0"

[tool.poetry.dependencies]
python = "^3.11"
requests = "^2.31.0"
tomli = { version = "^2.0", python = "<3.11" }

[tool.poetry.group.dev.dependencies]
pytest = "^8.0"

[tool.poetry.dev-dependencies]
black = "^24.0"

[build-system]
requires = ["poetry-core"]
`;

  it('認識する', () => {
    expect(isPyprojectToml(POETRY)).toBe(true);
  });

  it('[tool.poetry.dependencies] を runtime として読む', () => {
    const m = byName(parsePyprojectToml(POETRY));
    expect(m['requests']).toBe('runtime');
    expect(m['tomli']).toBe('runtime');
  });

  it('python は依存ではない', () => {
    // Poetry は対応する Python のバージョンを依存と同じ場所に書く。
    // これを拾うと PyPI に "python" を問い合わせて別物のライセンスを返す
    const m = byName(parsePyprojectToml(POETRY));
    expect(m['python']).toBeUndefined();
  });

  it('group と旧 dev-dependencies を dev として読む', () => {
    const m = byName(parsePyprojectToml(POETRY));
    expect(m['pytest']).toBe('dev');
    expect(m['black']).toBe('dev');
  });

  it('[tool.poetry] のメタデータを依存として拾わない', () => {
    const m = byName(parsePyprojectToml(POETRY));
    expect(m['name']).toBeUndefined();
    expect(m['version']).toBeUndefined();
  });

  it('detectAndParse が pypi として読む', () => {
    const r = detectAndParse(POETRY);
    expect(r.ecosystem).toBe('pypi');
    expect(r.dependencies.map((d) => d.name)).toContain('requests');
  });
});

describe('他の TOML と取り違えない', () => {
  it('Cargo.toml を pyproject として読まない', () => {
    const cargo = `[package]
name = "myapp"
edition = "2021"

[dependencies]
serde = "1.0"
`;
    expect(isPyprojectToml(cargo)).toBe(false);
    expect(detectAndParse(cargo).ecosystem).toBe('cargo');
  });

  it('poetry.lock を pyproject として読まない', () => {
    const lock = `[[package]]
name = "requests"
version = "2.31.0"
python-versions = ">=3.7"
`;
    expect(isPyprojectToml(lock)).toBe(false);
    const r = detectAndParse(lock);
    expect(r.ecosystem).toBe('pypi');
    // ロックファイルなので推移的依存まで含む
    expect(r.transitive).toBe(true);
  });
});
