const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
test("firmware fractional EMA crosses threshold and resets after missing data", (t) => {
  const compiler = process.env.CXX || "g++";
  if (spawnSync(compiler, ["--version"]).error) {
    t.skip("C++ compiler required; exercised in CI");
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "airwatch-filter-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, "test.cpp"),
    bin = path.join(dir, "test");
  fs.writeFileSync(
    source,
    '#include "sensor_filter.h"\n#include <cassert>\n#include <cmath>\nint main(){SensorFilter f(.25f);assert(f.update(34)==34);float v=34;for(int i=0;i<30;i++)v=f.update(37);assert(lroundf(v)==37);assert(f.update(0,true)==0);assert(f.update(60,true)==60);SensorFilter g(.2f);g.update(2000);for(int i=0;i<50;i++)v=g.update(2003);assert(lroundf(v)==2003);}\n',
  );
  const build = spawnSync(
    compiler,
    ["-std=c++11", "-I", process.cwd(), source, "-o", bin],
    { encoding: "utf8" },
  );
  assert.equal(build.status, 0, build.stderr);
  assert.equal(spawnSync(bin).status, 0);
});
