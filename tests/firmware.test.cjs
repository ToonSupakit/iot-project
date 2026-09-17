const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('firmware filtering recovers, crosses thresholds and handles timestamp rollover', t => {
  const compiler = spawnSync('g++', ['--version'], {encoding:'utf8'});
  if (compiler.error?.code === 'ENOENT' && !process.env.CI) {
    t.skip('Host C++ compiler unavailable; firmware tests run in GitHub Actions');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airwatch-firmware-'));
  try {
    const sketch = fs.readFileSync(path.join(__dirname, '..', 'firmware.ino'), 'utf8');
    const match = sketch.match(/\/\/ ===== Sensor processing[\s\S]*?\n\s*\/\/ ===== End sensor processing =====/);
    assert.ok(match, 'sensor processing block was not found in firmware.ino');
    const processing = match[0]
      .replace(/^\s*\/\/ ===== Sensor processing.*\n/, '')
      .replace(/\n\s*\/\/ ===== End sensor processing =====$/, '')
      .replace(/^\s{2}/gm, '');
    fs.writeFileSync(path.join(dir, 'sensor_processing_under_test.h'), '#include <stdint.h>\n#include <math.h>\n' + processing);
    fs.writeFileSync(path.join(dir, 'test.cpp'), `
#include "sensor_processing_under_test.h"
#include <cassert>
int main() {
  SensorEma pm;
  assert(!pm.fresh(0,5000));
  pm.update(34,0,5000,0.25f);
  for(unsigned i=1;i<=100;i++) pm.update(37,i*1000,5000,0.25f);
  assert(lroundf(pm.value)==37);
  assert(!pm.fresh(106000,5000));
  assert(pm.update(100,106001,5000,0.25f)==100);
  // Zero is a real reading: it must not silently reset an initialized filter.
  SensorEma zero; zero.update(0,0,5000,0.25f);
  assert(zero.update(100,1000,5000,0.25f)==25);
  SensorEma gas; gas.update(2499,0,5000,0.2f);
  for(unsigned i=1;i<=100;i++) gas.update(2503,i*1000,5000,0.2f);
  assert(lroundf(gas.value)==2503);
  SensorEma wrap; wrap.update(50,UINT32_MAX-100,5000,0.25f);
  assert(wrap.fresh(100,5000));
  assert(!wrap.fresh(6000,5000));
  assert(mustCloseIntake(true,true,32,150));
  assert(mustCloseIntake(true,false,32,0));
  assert(!mustCloseIntake(true,true,32,10));
  assert(!mustCloseIntake(false,true,32,150));
  assert(validClimate(0,0));
  assert(!validClimate(NAN,50));
  assert(!validClimate(25,101));
  assert(!validClimate(90,50));
  EnsRecovery ens; ens.started(0);
  assert(!ens.due(59999,false,3));
  assert(ens.due(60000,false,3));
  // Normal warm-up and first-hour conditioning must not be reset every minute.
  assert(!ens.due(180000,true,1));
  assert(ens.due(300000,true,1));
  assert(!ens.due(3600000,true,2));
  assert(ens.due(3900000,true,2));
  ens.good(4000000);
  assert(!ens.due(4059999,true,0));
  assert(ens.due(4060000,true,0));
  ens.started(4060000);
  assert(!ens.due(4061000,false,3));
  ens.started(UINT32_MAX-1000);
  assert(!ens.due(1000,false,3));
  assert(ens.due(60000,false,3));
}
`);
    const binary = path.join(dir, 'test');
    const compile = spawnSync('g++', ['-std=c++11', '-Wall', '-Wextra', '-Werror', '-I', dir, path.join(dir,'test.cpp'), '-o',binary], {encoding:'utf8'});
    assert.equal(compile.status,0,compile.stderr || String(compile.error));
    const run = spawnSync(binary, [], {encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
