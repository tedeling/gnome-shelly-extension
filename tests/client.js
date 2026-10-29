// Exercise the production GJS/Soup transport without sockets or a real plug.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import {ShellyClient, AuthenticationError} from '../lib/client.js';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

const status = {apower: 1250, output: true, voltage: 230, current: 5.4};
const client = new ShellyClient('192.168.30.91', async () => 'secret');
const cancellable = new Gio.Cancellable();

// Run the real callback/finish/decode path against an in-memory response.
client._session.send_and_read_finish = () => new GLib.Bytes(new TextEncoder().encode(JSON.stringify(status)));
client._session.send_and_read_async = (message, _priority, _cancel, callback) => {
    callback(client._session, null);
};
const decoded = await client._request(cancellable);
assert(JSON.parse(decoded.body).apower === 1250, 'Soup response was not decoded correctly');

// The request factory must produce an actual libsoup message before mocking I/O.
const originalSend = client._session.send_and_read_async;
let messageChecked = false;
client._session.send_and_read_async = message => {
    assert(message instanceof Soup.Message, 'Expected Soup.Message');
    assert(message.get_uri().to_string() === 'http://192.168.30.91/rpc/Switch.GetStatus?id=0', 'Wrong endpoint');
    assert(message.get_flags() & Soup.MessageFlags.NO_REDIRECT, 'Redirects must be disabled');
    messageChecked = true;
};
client._request(cancellable);
assert(messageChecked, 'Request was not sent');
client._session.send_and_read_async = message => {
    assert(message.request_headers.get_one('Authorization') === 'Digest test', 'Authorization header was not set');
};
client._request(cancellable, 'Digest test');
client._session.send_and_read_async = originalSend;

client._request = async () => ({status: 200, body: JSON.stringify(status)});
let reading = await client.read(cancellable);
assert(reading.powerWatts === 1250, 'Expected power in watts');

let calls = 0;
client._request = async (_cancel, authorization) => {
    calls++;
    if (!authorization)
        return {status: 401, challenge: 'Digest realm="shelly-test", nonce="123", algorithm=SHA-256, qop="auth"'};
    assert(authorization.includes('algorithm=SHA-256'), 'Missing digest algorithm');
    assert(authorization.includes('response="'), 'Missing digest response');
    return {status: 200, body: JSON.stringify(status)};
};
reading = await client.read(cancellable);
assert(calls === 2 && reading.powerWatts === 1250, 'Authentication should retry once');

for (const [response, expectedClass, expectedText] of [
    [{status: 401, challenge: 'Digest realm="test", nonce="123", algorithm=SHA-256, qop="auth"'}, AuthenticationError, 'Authentication failed'],
    [{status: 403}, AuthenticationError, 'Authentication failed'],
    [{status: 429}, AuthenticationError, 'rate limiting'],
    [{status: 404}, Error, 'HTTP 404'],
    [{status: 302}, Error, 'HTTP 302'],
    [{status: 200, body: '<html>not JSON</html>'}, Error, 'invalid JSON'],
    [{status: 200, body: '{}'}, Error, 'valid power reading'],
]) {
    calls = 0;
    client._request = async () => { calls++; return response; };
    let error;
    try { await client.read(cancellable); } catch (e) { error = e; }
    assert(error instanceof expectedClass && error.message.includes(expectedText), `Wrong error for ${response.status}: ${error}`);
    assert(calls <= 2, 'Authentication must not loop');
}

client._passwordLookup = async () => null;
client._request = async () => ({status: 401});
try {
    await client.read(cancellable);
    throw new Error('Missing password should fail');
} catch (error) {
    assert(error instanceof AuthenticationError, 'Expected authentication error for missing password');
}

client._passwordLookup = async () => { cancellable.cancel(); return 'secret'; };
try {
    await client.read(cancellable);
    throw new Error('Cancelled request should fail');
} catch (error) {
    assert(error.message === 'Request cancelled.', 'Cancellation should prevent authenticated retry');
}
client.destroy();
print('GJS client checks passed (Soup response decoding, message construction, auth, cancellation, HTTP/JSON errors).');
