// 隐藏窗口的 pnpm 执行器：spawnSync 不传 shell，windowsHide:true 避免弹 cmd 黑框
const { spawnSync } = require('child_process');
const { readFileSync, writeFileSync, existsSync } = require('fs');
const { join } = require('path');

var cwd = process.argv[2];
var args = process.argv.slice(3);

// 先读 before 用于 reconcile
var pkgFile = join(cwd, 'package.json');
var before = {};
try { before = JSON.parse(readFileSync(pkgFile, 'utf8')); } catch {}

var result = spawnSync('pnpm', args, {
  cwd: cwd,
  windowsHide: true,
  stdio: 'pipe',
  shell: process.platform === 'win32',
});

process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');

var exitCode = result.status !== null ? result.status : (result.error ? 1 : 0);

// 成功后 reconcile：把有 dsh.bundle.patch 的依赖加入 bundles
if (exitCode === 0) {
  try {
    var after = JSON.parse(readFileSync(pkgFile, 'utf8'));
    var beforeDeps = new Set(Object.keys(before.dependencies || {}));
    var deps = Object.keys(after.dependencies || {});
    var bundles = after.dsh && after.dsh.profile && after.dsh.profile.bundles ? after.dsh.profile.bundles : [];
    var changed = false;

    for (var pkgName of deps) {
      var modDir = join(cwd, 'node_modules', pkgName);
      if (existsSync(join(modDir, 'package.json'))) {
        try {
          var pkg = JSON.parse(readFileSync(join(modDir, 'package.json'), 'utf8'));
          var isBundle = pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch !== undefined;
          if (isBundle && !bundles.includes(pkgName)) {
            bundles.push(pkgName);
            changed = true;
          }
        } catch (e) { process.stderr.write('[run-pnpm] 跳过 ' + pkgName + ': ' + e.message + '\n') }
      }
    }

    var depSet = new Set(deps);
    for (var i = bundles.length - 1; i >= 0; i--) {
      var pn = bundles[i];
      var wasDep = beforeDeps.has(pn) || depSet.has(pn);
      var stillBundle = depSet.has(pn) && existsSync(join(cwd, 'node_modules', pn, 'package.json'));
      if (wasDep && !stillBundle) {
        bundles.splice(i, 1);
        changed = true;
      }
    }

    if (changed) {
      if (!after.dsh) after.dsh = {};
      if (!after.dsh.profile) after.dsh.profile = {};
      after.dsh.profile.bundles = bundles;
      writeFileSync(pkgFile, JSON.stringify(after, null, 2) + '\n');
    }
  } catch (e) { process.stderr.write('[run-pnpm] reconcile 失败: ' + e.message + '\n') }
}

process.exit(exitCode);