const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createApp, validateTelemetry } = require('../server');

const apiKey = 'test-device-key-for-tests';
const sample = { in_pm: 0, in_co2: null, in_gas: 0, out_pm: null, out_gas: null,
    vent: 0, filt: 0, temp: 0, humidity: 0 };

test('telemetry schema distinguishes zero, null and invalid data', () => {
    assert.equal(validateTelemetry(sample), true);
    for (const invalid of [
        null, [], {}, { ...sample, in_pm: '30' }, { ...sample, in_pm: NaN },
        { ...sample, humidity: 101 }, { ...sample, in_gas: 4096 },
        { ...sample, in_co2: undefined }, { ...sample, vent: true },
        { ...sample, vent: 1, filt: 1 }
    ]) assert.equal(validateTelemetry(invalid), false);
});

test('server requires an explicit device key', () => {
    assert.throws(() => createApp({ apiKey: '' }), /DEVICE_API_KEY/);
});

test('HTTP API protects writes, handles errors and only serves public files', async t => {
    let calls = 0;
    let fail = false;
    const events = [];
    const db = { query(sql, values, callback) {
        calls++;
        if (typeof values === 'function') return values(null, []);
        callback(fail ? { code: 'DB_TEST_ERROR', sql: 'private database detail' } : null);
    } };
    const app = createApp({ db, apiKey, io: { emit: (...args) => events.push(args) } });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = 'http://127.0.0.1:' + server.address().port;
    const post = (body, key = apiKey) => fetch(base + '/api/log', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Device-Key': key },
        body: typeof body === 'string' ? body : JSON.stringify(body)
    });

    assert.equal((await post(sample, 'wrong')).status, 401);
    assert.equal(calls, 0);
    assert.equal((await post({ ...sample, in_pm: '4' })).status, 400);
    assert.equal((await post('{broken json')).status, 400);
    assert.equal((await post({ ...sample, padding: 'x'.repeat(5000) })).status, 413);
    assert.equal(calls, 0);
    assert.equal((await post(sample)).status, 201);
    assert.equal(events.length, 1);
    assert.equal(events[0][0], 'sensorData');
    assert.equal(events[0][1].in_pm25, 0);
    assert.equal(events[0][1].out_pm25, null);
    assert.ok(Number.isFinite(Date.parse(events[0][1].created_at)));

    fail = true;
    const failed = await post(sample);
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { error: 'Unable to save telemetry' });
    assert.equal(events.length, 1);
    for (const file of ['/server.js', '/firmware.ino', '/db/schema.sql', '/package.json', '/.git/config']) {
        assert.equal((await fetch(base + file)).status, 404, file);
    }
    for (const file of ['/', '/index.html', '/history.html', '/style.css']) {
        assert.equal((await fetch(base + file)).status, 200, file);
    }
});
