const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('firmware filtering recovers, crosses thresholds and handles timestamp rollover', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airwatch-firmware-'));
  try {
    fs.writeFileSync(path.join(dir, 'test.cpp'), `
#include "sensor_processing.h"
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
}
`);
    const binary = path.join(dir, 'test');
    const compile = spawnSync('g++', ['-std=c++11', '-Wall', '-Wextra', '-Werror', '-I', path.join(__dirname,'..'), path.join(dir,'test.cpp'), '-o',binary], {encoding:'utf8'});
    assert.equal(compile.status,0,compile.stderr || String(compile.error));
    const run = spawnSync(binary, [], {encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
