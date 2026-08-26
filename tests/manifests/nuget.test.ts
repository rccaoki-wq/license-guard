import { describe, expect, it } from 'vitest';
import { isNugetPackagesLock, parseNugetPackagesLock } from '../../src/manifests/nuget-lock';
import { exactVersion, isNugetProject, parseNugetProject } from '../../src/manifests/nuget-project';
import { isPackageLock } from '../../src/manifests/npm-lock';
import { detectAndParse } from '../../src/manifests';

/** 実物の packages.lock.json から構造をそのまま持ってきたもの */
const LOCK = JSON.stringify({
  version: 1,
  dependencies: {
    'net8.0': {
      'Newtonsoft.Json': { type: 'Direct', requested: '[13.0.3, )', resolved: '13.0.3' },
      Serilog: { type: 'Transitive', resolved: '4.2.0' },
      'Acme.Billing': { type: 'Project' },
    },
    'net472': {
      // 同じ名前だがフレームワークごとに違う版に解決されている
      'Newtonsoft.Json': { type: 'Direct', requested: '[12.0.3, )', resolved: '12.0.3' },
      Serilog: { type: 'Transitive', resolved: '4.2.0' },
    },
  },
});

describe('packages.lock.json', () => {
  it('npm のロックファイルと取り違えない（両方向）', () => {
    const npmLock = JSON.stringify({
      lockfileVersion: 3,
      dependencies: { lodash: { version: '4.17.21', resolved: 'https://registry.npmjs.org/...' } },
    });
    expect(isNugetPackagesLock(JSON.parse(npmLock))).toBe(false);
    expect(isPackageLock(JSON.parse(LOCK))).toBe(false);
    expect(isNugetPackagesLock(JSON.parse(LOCK))).toBe(true);
  });

  it('`dependencies` を持つだけの JSON を掴まない', () => {
    // package.json の受け皿より前に置いてあるので、ここが緩いと
    // npm の利用者が「NuGet として 0 件」を受け取る
    expect(isNugetPackagesLock({ dependencies: { react: '^18.0.0' } })).toBe(false);
    expect(isNugetPackagesLock({ dependencies: {} })).toBe(false);
    expect(isNugetPackagesLock({ dependencies: [] })).toBe(false);
    expect(isNugetPackagesLock(null)).toBe(false);
  });

  it('resolved を版として読む', () => {
    const deps = parseNugetPackagesLock(LOCK);
    const json = deps.find((d) => d.name === 'Newtonsoft.Json' && d.version === '13.0.3');
    expect(json).toBeDefined();
    expect(json?.ecosystem).toBe('nuget');
    expect(json?.origin).toBe('registry');
  });

  it('フレームワークごとに版が違えば両方残す', () => {
    const versions = parseNugetPackagesLock(LOCK)
      .filter((d) => d.name === 'Newtonsoft.Json')
      .map((d) => d.version)
      .sort();
    // 片方だけ見て答えると、もう片方で実際に入る版の話をしていない
    expect(versions).toEqual(['12.0.3', '13.0.3']);
  });

  it('版まで同じなら 1 件にまとめる', () => {
    expect(parseNugetPackagesLock(LOCK).filter((d) => d.name === 'Serilog')).toHaveLength(1);
  });

  it('Project は workspace として、レジストリを引かせない', () => {
    const p = parseNugetPackagesLock(LOCK).find((d) => d.name === 'Acme.Billing');
    // nuget.org に存在しないので、照会すれば必ず空振りして予算を食う
    expect(p?.origin).toBe('workspace');
  });
});

describe('.csproj / Directory.Packages.props / packages.config', () => {
  it('コメントアウトされた PackageReference を報告しない', () => {
    const csproj = `<Project Sdk="Microsoft.NET.Sdk">
  <ItemGroup>
    <PackageReference Include="Serilog" Version="4.2.0" />
    <!-- <PackageReference Include="RemovedPackage" Version="1.0.0" /> -->
  </ItemGroup>
</Project>`;
    const names = parseNugetProject(csproj).map((d) => d.name);
    // 入っていない依存の義務まで報告することになる
    expect(names).toEqual(['Serilog']);
  });

  it('子要素の <Version> も読む', () => {
    const csproj = `<Project>
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json">
      <Version>13.0.3</Version>
    </PackageReference>
  </ItemGroup>
</Project>`;
    expect(parseNugetProject(csproj)[0]).toMatchObject({
      name: 'Newtonsoft.Json',
      version: '13.0.3',
    });
  });

  it('Directory.Packages.props の Update 指定を拾う', () => {
    const props = `<Project>
  <ItemGroup>
    <PackageVersion Include="Serilog" Version="4.2.0" />
    <PackageVersion Update="Newtonsoft.Json" Version="13.0.3" />
  </ItemGroup>
</Project>`;
    expect(parseNugetProject(props).map((d) => d.name).sort()).toEqual([
      'Newtonsoft.Json',
      'Serilog',
    ]);
  });

  it('この文字列だけでは版が決まらないものを版として渡さない', () => {
    // 決まらないものを渡すと、存在しない座標を照会して必ず空振りする
    expect(exactVersion('$(SerilogVersion)')).toBeNull();
    expect(exactVersion('13.0.*')).toBeNull();
    expect(exactVersion('[13.0.3,)')).toBeNull();
    expect(exactVersion('(1.0,2.0)')).toBeNull();
    expect(exactVersion('  ')).toBeNull();
    expect(exactVersion(null)).toBeNull();
    expect(exactVersion('13.0.3')).toBe('13.0.3');
    expect(exactVersion('6.0.0-preview.7')).toBe('6.0.0-preview.7');
  });

  it('版が決まらなくても依存そのものは落とさない', () => {
    const csproj = `<Project><ItemGroup>
      <PackageReference Include="Serilog" Version="$(SerilogVersion)" />
    </ItemGroup></Project>`;
    // 版が無いだけで消すと、その依存は一覧に現れず「無い」ことになる
    expect(parseNugetProject(csproj)).toEqual([
      { ecosystem: 'nuget', name: 'Serilog', version: null, scope: 'runtime', origin: 'registry' },
    ]);
  });

  it('packages.config の developmentDependency を尊重する', () => {
    const config = `<?xml version="1.0" encoding="utf-8"?>
<packages>
  <package id="Newtonsoft.Json" version="12.0.3" targetFramework="net472" />
  <package id="StyleCop.Analyzers" version="1.1.118" developmentDependency="true" />
</packages>`;
    const deps = parseNugetProject(config);
    // 推測ではなく宣言なので、そのまま採る
    expect(deps.find((d) => d.name === 'StyleCop.Analyzers')?.scope).toBe('dev');
    expect(deps.find((d) => d.name === 'Newtonsoft.Json')?.scope).toBe('runtime');
  });

  it('PrivateAssets="all" を dev と名乗らない', () => {
    const csproj = `<Project><ItemGroup>
      <PackageReference Include="SomeAnalyzer" Version="1.0.0" PrivateAssets="all" />
    </ItemGroup></Project>`;
    // 「自分の利用者には流さない」であって「開発専用」とは限らない
    expect(parseNugetProject(csproj)[0]?.scope).toBe('runtime');
  });

  it('XML でも NuGet でなければ掴まない', () => {
    expect(isNugetProject('<packages></packages>')).toBe(false);
    expect(isNugetProject('<?xml version="1.0"?><configuration/>')).toBe(false);
    expect(isNugetProject('<project><target name="build"/></project>')).toBe(false);
  });

  it('参照が 0 件の .csproj は「非対応」ではなく「0 件」', () => {
    // 「対応していない形式です」と「依存が見つかりません」は別の事実で、
    // 次にやることが違う。SDK 形式の Project 要素は MSBuild のもので紛れない
    expect(isNugetProject('<Project Sdk="Microsoft.NET.Sdk"></Project>')).toBe(true);
    expect(parseNugetProject('<Project Sdk="Microsoft.NET.Sdk"></Project>')).toEqual([]);
    // ただしコメントアウトされただけの参照で「対応形式」を名乗らない
    expect(isNugetProject('<!-- <PackageReference Include="X" /> -->')).toBe(false);
  });

  it('ProjectReference を自分のリポジトリのものとして数える', () => {
    // 実物（nopCommerce の Nop.Web.csproj）は PackageReference を一つも
    // 持たず ProjectReference だけで、「対応していない形式です」と返っていた
    const csproj = `<Project Sdk="Microsoft.NET.Sdk.Web">
  <ItemGroup>
    <ProjectReference Include="..\\..\\Libraries\\Nop.Core\\Nop.Core.csproj" />
    <ProjectReference Include="../../Libraries/Nop.Data/Nop.Data.csproj" />
  </ItemGroup>
</Project>`;
    const deps = parseNugetProject(csproj);
    expect(deps.map((d) => d.name)).toEqual(['Nop.Core', 'Nop.Data']);
    // nuget.org に無いので照会させない
    expect(deps.every((d) => d.origin === 'workspace')).toBe(true);
    expect(deps.every((d) => d.version === null)).toBe(true);
  });
});

describe('detectAndParse が NuGet を経路に載せている', () => {
  it('packages.lock.json', () => {
    const r = detectAndParse(LOCK);
    expect(r.ecosystem).toBe('nuget');
    expect(r.transitive).toBe(true);
  });

  it('.csproj は推移的依存を持たない', () => {
    const r = detectAndParse(
      '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Serilog" Version="4.2.0" /></ItemGroup></Project>',
    );
    expect(r.ecosystem).toBe('nuget');
    // 実際に入る版は restore が決めるので、ここで推移的だと言ってはいけない
    expect(r.transitive).toBe(false);
  });

  it('npm のロックファイルは今も npm として読まれる', () => {
    const npmLock = JSON.stringify({
      lockfileVersion: 3,
      packages: { 'node_modules/lodash': { version: '4.17.21', license: 'MIT' } },
    });
    expect(detectAndParse(npmLock).ecosystem).toBe('npm');
  });
});
