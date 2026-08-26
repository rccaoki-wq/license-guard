import type { Dependency, Scope } from '../types';

/**
 * .NET のプロジェクトファイル（`.csproj` / `.vbproj` / `.fsproj`）、
 * 中央管理の `Directory.Packages.props`、および旧形式の `packages.config`。
 *
 * **実際の .NET リポジトリではこちらの方が圧倒的に多い。**
 * `packages.lock.json` は `RestorePackagesWithLockFile` を明示した
 * プロジェクトにしか無く、既定では生成されない。
 *
 * Workers に DOM パーサは無いので正規表現で読む。XML 一般を読むのではなく
 * **既知の 3 つの要素だけ**を拾うので、これで足りる。
 */

/**
 * コメントを先に落とす。
 *
 * `.csproj` では使わなくなった依存を消さずにコメントアウトして残すことが
 * ごく普通にある。落とさないと、**入っていないパッケージ**が結果に並び、
 * その義務まで報告することになる。
 */
function stripComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, '');
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(attrs);
  if (m === null) return null;
  const v = (m[2] ?? m[3] ?? '').trim();
  return v === '' ? null : v;
}

/**
 * 版として使える文字列だけを通す。
 *
 * NuGet の `Version` は素の版だけではない。MSBuild のプロパティ参照
 * (`$(SerilogVersion)`)、浮動版 (`13.0.*`)、範囲 (`[13.0.3,)`) が入る。
 * これらは**この文字列だけでは版が決まらない**。決まらないものを
 * 版として渡すと、存在しない座標を照会して必ず空振りする。
 *
 * 素の `13.0.3` は NuGet では厳密には「13.0.3 以上」の意味だが、
 * restore は条件を満たす最小の版を選ぶので、実際に入るのは 13.0.3。
 * ここは実物に合わせて確定版として扱う。
 */
export function exactVersion(raw: string | null): string | null {
  if (raw === null) return null;
  const v = raw.trim();
  if (v === '') return null;
  if (/[$*[\](),\s]/.test(v)) return null;
  if (!/^\d/.test(v)) return null;
  return v;
}

/** `<PackageReference …/>` と `<PackageVersion …/>`。子要素の `<Version>` も見る */
function parseReferences(xml: string): Dependency[] {
  const out: Dependency[] = [];
  const re = /<(PackageReference|PackageVersion)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1\s*>)/gi;

  for (const m of xml.matchAll(re)) {
    const attrs = m[2] ?? '';
    const body = m[4] ?? '';

    // props ファイルでは Include ではなく Update で指定することがある
    const name = attr(attrs, 'Include') ?? attr(attrs, 'Update');
    if (name === null) continue;
    // `Include="A;B"` のような複数指定は PackageReference では使わない。
    // 誤って拾うと存在しない名前を照会するので、区切り文字があれば捨てる
    if (name.includes(';')) continue;

    const child = /<Version\s*>([^<]*)<\/Version\s*>/i.exec(body);
    out.push({
      ecosystem: 'nuget',
      name,
      version: exactVersion(attr(attrs, 'Version') ?? child?.[1] ?? null),
      // `PrivateAssets="all"` は「自分の利用者には流さない」であって
      // 「開発専用」とは限らない。宣言されていない事実を名乗らない
      scope: 'runtime',
      origin: 'registry',
    });
  }
  return out;
}

/** 旧形式 `packages.config`: `<package id="X" version="Y" />` */
function parsePackagesConfig(xml: string): Dependency[] {
  const out: Dependency[] = [];

  for (const m of xml.matchAll(/<package\s([^>]*?)\/?>/gi)) {
    const attrs = m[1] ?? '';
    const name = attr(attrs, 'id');
    if (name === null) continue;

    // packages.config は**開発専用かどうかを明示的に持つ**唯一の形式。
    // 推測ではなく宣言なので、そのまま尊重する
    const dev = (attr(attrs, 'developmentDependency') ?? '').toLowerCase() === 'true';
    const scope: Scope = dev ? 'dev' : 'runtime';

    out.push({
      ecosystem: 'nuget',
      name,
      version: exactVersion(attr(attrs, 'version')),
      scope,
      origin: 'registry',
    });
  }
  return out;
}

/**
 * 同じソリューション内の別プロジェクトへの参照。
 *
 * nuget.org には存在しないので照会しない。`packages.lock.json` の
 * `type: "Project"` と同じ扱い——**自分のリポジトリのもの**だと名指しする。
 * 名前は参照先のファイル名から採る。パスをそのまま名前として出しても
 * 読みにくいだけで、ファイル名がプロジェクト名という規約は MSBuild の
 * ものであって、こちらの推測ではない。
 */
function parseProjectReferences(xml: string): Dependency[] {
  const out: Dependency[] = [];

  for (const m of xml.matchAll(/<ProjectReference\s([^>]*?)\/?>/gi)) {
    const path = attr(m[1] ?? '', 'Include');
    if (path === null) continue;

    const name = (path.split(/[\\/]/).pop() ?? '').replace(/\.[a-z]+proj$/i, '');
    if (name === '') continue;

    out.push({ ecosystem: 'nuget', name, version: null, scope: 'runtime', origin: 'workspace' });
  }
  return out;
}

export function isNugetProject(content: string): boolean {
  const xml = stripComments(content);
  if (/<(PackageReference|PackageVersion|ProjectReference)\b/i.test(xml)) return true;

  // 参照を一つも持たない .csproj もある。それは**非対応ではなく 0 件**で、
  // 案内する文言が違う。実物（nopCommerce の Nop.Web.csproj）が
  // ProjectReference しか持たず、「対応していない形式です」と返っていた。
  // `<Project Sdk="…">` は MSBuild の SDK 形式そのもので、他と紛れない
  if (/<Project\b[^>]*\bSdk\s*=/i.test(xml)) return true;

  // `<packages>` だけでは足りない。中に `<package id=…>` があること
  return /<packages\s*>/i.test(xml) && /<package\s[^>]*\bid\s*=/i.test(xml);
}

export function parseNugetProject(content: string): Dependency[] {
  const xml = stripComments(content);
  const found = [
    ...parseReferences(xml),
    ...parsePackagesConfig(xml),
    ...parseProjectReferences(xml),
  ];

  // 同じ座標は 1 度だけ。Directory.Packages.props と .csproj を続けて
  // 貼られた場合や、複数の TargetFramework 条件で同じ指定が並ぶ場合に重なる
  const seen = new Set<string>();
  return found.filter((d) => {
    const key = `${d.name}@${d.version ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
