// 隐藏窗口的 pnpm 执行器：spawnSync 不传 shell，windowsHide:true 避免弹 cmd 黑框
const { spawnSync } = require('child_process');
const { readFileSync, writeFileSync, existsSync } = require('fs');
const { join, dirname } = require('path');

var cwd = process.argv[2];
var args = process.argv.slice(3);

// H4 修复：优先使用桌面壳注入的内置 pnpm（DSH_BUNDLED_PNPM_DIR 指向 @pnpm/exe 目录，
// main.ts 在启动 dsh 子进程时注入），避免依赖系统 PATH 中的 pnpm —— 与"免装 Node/pnpm"承诺一致。
function resolvePnpm() {
  var bundledDir = process.env.DSH_BUNDLED_PNPM_DIR;
  if (bundledDir) {
    var bin = join(bundledDir, process.platform === 'win32' ? 'pnpm.exe' : 'pnpm');
    if (existsSync(bin)) return bin;
  }
  // 回退：尝试从当前模块向上查找就近的 pnpm（dev 目录布局）
  var probe = dirname(dirname(dirname(require.main ? require.main.filename : __filename)));
  var local = join(probe, 'node_modules', '@pnpm', 'exe', process.platform === 'win32' ? 'pnpm.exe' : 'pnpm');
  if (existsSync(local)) return local;
  return 'pnpm';
}

// 先读 before 用于 reconcile
var pkgFile = join(cwd, 'package.json');
var before = {};
try { before = JSON.parse(readFileSync(pkgFile, 'utf8')); } catch {}

var pnpmBin = resolvePnpm();
var spawnResult = spawnSync(pnpmBin, args, {
  cwd: cwd,
  windowsHide: true,
  stdio: 'pipe',
  shell: process.platform === 'win32' && pnpmBin === 'pnpm',
});

process.stdout.write(spawnResult.stdout || '');
process.stderr.write(spawnResult.stderr || '');

var exitCode = spawnResult.status !== null ? spawnResult.status : (spawnResult.error ? 1 : 0);

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
      // 写回前最后一次核对：pnpm 运行期间另一写者（快照恢复/安全模式）可能
      // 已修改 package.json。若依赖表已变，本轮 reconcile 不覆盖它的成果
      // （bundles 调整留待下次 pnpm 操作）——基于陈旧视图回写会丢失并发修改。
      try {
        var latest = JSON.parse(readFileSync(pkgFile, 'utf8'));
        var sameDeps = JSON.stringify(latest.dependencies) === JSON.stringify(after.dependencies);
        if (!sameDeps) {
          process.stderr.write('[run-pnpm] 检测到并发修改,跳过 bundles reconcile\n');
        } else {
          if (!after.dsh) after.dsh = {};
          if (!after.dsh.profile) after.dsh.profile = {};
          after.dsh.profile.bundles = bundles;
          writeFileSync(pkgFile, JSON.stringify(after, null, 2) + '\n');
        }
      } catch (e) { process.stderr.write('[run-pnpm] reconcile 写回失败: ' + e.message + '\n') }
    }
  } catch (e) { process.stderr.write('[run-pnpm] reconcile 失败: ' + e.message + '\n') }
}

process.exit(exitCode);