// dsh 重启脚本：延时后用相同参数重启 dsh
const { spawn } = require('child_process');
const { writeFileSync, appendFileSync } = require('fs');
const { join } = require('path');

const LOG = join(__dirname, '..', 'restart.log');
const RESTART_DELAY_MS = 2000;
const nodeBin = process.execPath;
const dshBin = process.argv[2];
const dshArgs = process.argv.slice(3);

function log(msg) {
  const line = new Date().toISOString() + ' ' + msg;
  appendFileSync(LOG, line + '\n');
}

log('restart.cjs started');
log('nodeBin=' + nodeBin);
log('dshBin=' + dshBin);
log('dshArgs=' + JSON.stringify(dshArgs));
log('DSH_HOME=' + process.env.DSH_HOME);

setTimeout(function () {
  log('starting dsh...');
  try {
    const child = spawn(nodeBin, [dshBin, ...dshArgs], {
      stdio: 'ignore',
      env: process.env,
      windowsHide: true,
      detached: true,
    });
    child.on('error', function (err) { log('spawn error: ' + err.message); });
    child.on('exit', function (code) { log('dsh exited with code ' + code); process.exit(code || 0); });
    log('spawned, pid=' + child.pid);
    child.unref();
  } catch (e) {
    log('exception: ' + e.message);
    process.exit(1);
  }
}, RESTART_DELAY_MS);