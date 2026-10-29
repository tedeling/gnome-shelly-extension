// RFC 7616 SHA-256 digest, used by authenticated Shelly Gen2+ HTTP APIs.
// The checksum function is supplied by the GNOME client (GLib.ChecksumType.SHA256).
export function digestAuthorization(challenge, password, cnonce, sha256, uri) {
    if (!/^Digest\s/i.test(challenge ?? ''))
        throw new Error('The device did not provide a supported authentication challenge.');

    const fields = {};
    const pattern = /([a-z_]+)\s*=\s*(?:"((?:\\.|[^"\\])*)"|([^,\s]+))/gi;
    for (const match of challenge.matchAll(pattern))
        fields[match[1].toLowerCase()] = (match[2] ?? match[3]).replace(/\\(.)/g, '$1');
    if (fields.algorithm?.toUpperCase() !== 'SHA-256' ||
        !fields.realm || !fields.nonce || !fields.qop?.split(',').map(s => s.trim()).includes('auth'))
        throw new Error('The device did not provide a supported SHA-256 authentication challenge.');

    const nc = '00000001';
    const ha1 = sha256(`admin:${fields.realm}:${password}`);
    const ha2 = sha256(`GET:${uri}`);
    const response = sha256(`${ha1}:${fields.nonce}:${nc}:${cnonce}:auth:${ha2}`);
    const quote = value => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    const parts = [
        'username="admin"', `realm=${quote(fields.realm)}`, `nonce=${quote(fields.nonce)}`,
        `uri=${quote(uri)}`, 'algorithm=SHA-256', 'qop=auth', `nc=${nc}`,
        `cnonce=${quote(cnonce)}`, `response=${quote(response)}`,
    ];
    if (fields.opaque)
        parts.push(`opaque=${quote(fields.opaque)}`);
    return `Digest ${parts.join(', ')}`;
}
