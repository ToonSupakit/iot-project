const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness() {
    const elements = {};
    const storage = {};
    const handlers = {};
    let history = [];
    function element() {
        return {
            children: [], innerHTML: 'CONNECTING...',
            style: { setProperty() {} }, classList: { add() {}, remove() {} },
            insertBefore(item) { this.children.unshift(item); },
            get lastElementChild() { return { remove: () => this.children.pop() }; },
            getContext() { return {}; }
        };
    }
    const document = {
        getElementById: id => elements[id] ||= element(),
        querySelector: () => elements.pill ||= element(),
        createElement: element, body: element(), documentElement: element()
    };
    const context = vm.createContext({
        document, window: {}, console,
        localStorage: { getItem: key => storage[key] || null, setItem: (key, value) => storage[key] = value },
        io: () => ({ on: (name, fn) => handlers[name] = fn }),
        fetch: async url => ({ ok: true, json: async () => url === '/api/latest' ? {} : history }),
        setTimeout: () => 1, clearTimeout() {}, setInterval() {},
        Chart: function(ctx, config) { this.data = config.data; this.update = () => {}; }
    });
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
    vm.runInContext(scripts[scripts.length - 1][1], context);
    return { elements, handlers, setHistory: rows => history = rows,
        run: code => vm.runInContext(code, context) };
}

test('empty history, missing measurements, alert episodes and offline fans', async () => {
    const h = harness();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.run('!!pmChart'), true);
    assert.equal(h.elements.pill.innerHTML, 'OFFLINE');
    const data = { in_pm25: 60, out_pm25: null, in_gas: 1000, out_gas: null,
        in_co2: null, temperature: 0, humidity: 0, vent_fan_status: 1, filt_fan_status: 0 };
    const update = value => h.run('updateUI(' + JSON.stringify(value) + ')');
    update(data); update(data);
    assert.equal(h.run('alertCount'), 1);
    assert.equal(h.elements.out_pm25.textContent, 'No data');
    assert.equal(h.elements['temp-val'].textContent, '0.0°C');
    h.run('setDeviceOffline()');
    assert.equal(h.elements['tl-vent'].textContent, 'UNKNOWN');
    assert.equal(h.run('alertCount'), 1);
    update({ ...data, in_pm25: 0 }); update(data);
    assert.equal(h.run('alertCount'), 2);
    h.run('dismissAlert()'); update(data);
    assert.equal(h.run('alertCount'), 2);
    update({ ...data, in_pm25: null }); update(data);
    assert.equal(h.run('alertCount'), 2);
    for (let i = 0; i < 110; i++) { update({ ...data, in_pm25: 0 }); update(data); }
    assert.equal(h.elements['notif-items'].children.length, 100);

    h.setHistory([{ bucket_ms: 600000, in_pm25: '42.1', out_pm25: null }]);
    await h.run('initChart()');
    assert.equal(h.run('pmChart.data.datasets[0].data[0]'), 42.1);
    assert.equal(h.run('pmChart.data.datasets[1].data[0]'), null);
});

test('a fresh socket event marks the device live', async () => {
    const h = harness();
    await new Promise(resolve => setImmediate(resolve));
    h.handlers.sensorData({ in_pm25: 0, out_pm25: null, in_gas: 0, out_gas: null });
    assert.match(h.elements.pill.innerHTML, /LIVE/);
});

test('browser endpoints use the current server', () => {
    for (const file of ['index.html', 'history.html']) {
        const html = fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');
        assert.doesNotMatch(html, /(?:io|fetch)\(['"]http:\/\/localhost/);
    }
});
