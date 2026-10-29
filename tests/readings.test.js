import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseReading, panelText, formatValue} from '../lib/readings.js';
import {normalizeAddress} from '../lib/address.js';
import {digestAuthorization} from '../lib/digest.js';
import {createHash} from 'node:crypto';

test('Plus Plug S readings show live watts without an accumulated total', () => {
    const reading = parseReading({apower: 842, aenergy: {total: 12376}, voltage: 230.1, current: 3.66, output: true});
    assert.deepEqual(reading, {powerWatts: 842, voltage: 230.1, current: 3.66, output: true});
    assert.equal(panelText(reading, 'en-US'), '842 W');
    assert.equal(panelText(parseReading({apower: 1234.6}), 'nl-NL'), '1.235 W');
    assert.equal(panelText(parseReading({apower: 0.4}), 'en-US'), '0 W');
});

test('zero readings are valid and unavailable is not zero', () => {
    const reading = parseReading({apower: 0, output: false});
    assert.equal(panelText(reading, 'en-US'), '0 W');
    assert.equal(panelText(null), '— W');
    assert.equal(formatValue(null, 'V'), '— V');
    assert.equal(reading.output, false);
    assert.equal(reading.voltage, null);
});

test('invalid payloads and device errors cannot masquerade as readings', () => {
    for (const status of [null, [], {}, {apower: '42'},
        {apower: NaN}, {apower: null}, {apower: Infinity}])
        assert.throws(() => parseReading(status));
    assert.throws(() => parseReading({apower: 0, errors: ['overtemp']}), /overtemp/);
});

test('device addresses are normalized and do not allow arbitrary paths or credentials', () => {
    for (const [input, output] of [
        ['192.168.30.91', 'http://192.168.30.91'],
        [' SHELLYPLUG.local ', 'http://shellyplug.local'],
        ['https://shelly.local:443/', 'https://shelly.local:443'],
        ['[fe80::1]:80', 'http://[fe80::1]:80'],
    ]) assert.equal(normalizeAddress(input), output);
    for (const input of ['', 'http://', 'file:///tmp/status', 'http://user:pass@shelly',
        '192.168.30.91/rpc/Reset', 'shelly?reset=1', 'shelly#reset', 'shelly:0', 'shelly:65536', 'shelly\n.local'])
        assert.throws(() => normalizeAddress(input), input);
});

test('SHA-256 HTTP Digest includes the query and matches a fixed response vector', () => {
    const sha256 = value => createHash('sha256').update(value).digest('hex');
    // Fixed vector for Shelly's admin user and the complete request URI.
    const challenge = 'Digest realm="shellyplusplugs-test", nonce="12345", qop="auth", algorithm=SHA-256';
    const header = digestAuthorization(challenge, 'secret', 'abc123', sha256, '/rpc/Switch.GetStatus?id=0');
    const expected = 'b96b48f1f0d075ab4af7b40652f319c9666950797f60b47750bd1de1364d16a5';
    assert.ok(header.includes(`response="${expected}"`));
    assert.ok(header.includes('uri="/rpc/Switch.GetStatus?id=0"'));
    assert.ok(header.includes('username="admin"'));
    assert.throws(() => digestAuthorization('Basic realm="shelly"', '', '', sha256, '/'));
    assert.throws(() => digestAuthorization(challenge.replace('SHA-256', 'MD5'), '', '', sha256, '/'));
});
