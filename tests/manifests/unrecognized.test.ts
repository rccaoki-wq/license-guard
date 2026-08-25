import { describe, expect, it } from 'vitest';
import { detectAndParse } from '../../src/manifests';
import { isRequirementsTxt } from '../../src/manifests/pypi';

/**
 * 対応していない形式を requirements.txt として読んでしまう問題。
 *
 * detectAndParse の最後の分岐は、どの判定にも当たらなかった内容を無条件に
 * requirements.txt として扱っていた。requirements.txt のパーサは行頭の
 * 語を名前として拾うため、Gemfile.lock からは `GEM` `PLATFORMS`
 * `DEPENDENCIES` という「パッケージ」が出てきて、そのまま普通のレポートに
 * なっていた。**利用者には自分の Ruby プロジェクトが検査されたように見える。**
 *
 * 何も検査できていないなら、それを言うこと。
 */
describe('対応していない形式を黙って読まない', () => {
  const FOREIGN: Array<[string, string]> = [
    [
      'Gemfile.lock',
      `GEM
  remote: https://rubygems.org/
  specs:
    rails (7.1.3)
    nokogiri (1.16.0)

PLATFORMS
  ruby

DEPENDENCIES
  rails (~> 7.1)
`,
    ],
    [
      'build.gradle',
      `dependencies {
    implementation 'com.squareup.okhttp3:okhttp:4.12.0'
    testImplementation 'junit:junit:4.13.2'
}
`,
    ],
    [
      'Pipfile',
      `[[source]]
url = "https://pypi.org/simple"

[packages]
requests = "*"
flask = ">=2.0"
`,
    ],
    [
      'composer.json 風の非対応 JSON',
      `{"require":{"monolog/monolog":"^3.0"}}`,
    ],
    ['ただの散文', 'Hello, this is my project.\nIt uses several libraries.\n'],
    ['CSV', 'name,version,license\nfoo,1.0,MIT\n'],
    ['go.work', 'go 1.22\n\nuse (\n    ./api\n    ./worker\n)\n'],
  ];

  for (const [name, content] of FOREIGN) {
    it(`${name} は依存として読まずに失敗する`, () => {
      expect(() => detectAndParse(content), name).toThrow();
    });
  }

  it('失敗の理由が「形式が分からない」と分かる', () => {
    expect(() => detectAndParse('Hello, this is my project.\n')).toThrow(
      /does not look like/i,
    );
  });
});

describe('本物の requirements.txt は従来どおり読む', () => {
  const REAL: Array<[string, string]> = [
    ['固定と範囲', 'requests==2.31.0\nflask>=2.0,<3.0\n'],
    ['名前だけ', 'requests\nflask\ndjango\n'],
    ['extras と空白', 'Django [argon2] == 4.2.7\n'],
    [
      'コメントとディレクティブ',
      '# base deps\n-r base.txt\n--index-url https://pypi.example.com/simple\nrequests==2.31.0\n',
    ],
    [
      'pip-compile のハッシュ固定',
      'requests==2.31.0 \\\n    --hash=sha256:aaaa \\\n    --hash=sha256:bbbb\n',
    ],
    ['環境マーカー', 'tomli==2.0.1 ; python_version < "3.11"\n'],
    ['直接参照', 'mypkg @ https://example.com/mypkg-1.0.whl\n'],
  ];

  for (const [name, content] of REAL) {
    it(`${name} を requirements.txt として認識する`, () => {
      expect(isRequirementsTxt(content), name).toBe(true);
      const r = detectAndParse(content);
      expect(r.ecosystem).toBe('pypi');
      expect(r.dependencies.length).toBeGreaterThan(0);
    });
  }

  it('意味のある行が1つも無いものは requirements.txt とみなさない', () => {
    expect(isRequirementsTxt('# comment only\n\n-r base.txt\n')).toBe(false);
  });
});
