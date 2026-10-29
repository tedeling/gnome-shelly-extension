// Keep this independent of GNOME so address validation can also be unit tested.
export function normalizeAddress(input) {
    let value = input.trim();
    if (!value)
        throw new Error('Enter the Shelly IP address in Settings.');
    if (!/^https?:\/\//i.test(value))
        value = `http://${value}`;

    // Only accept a device origin. Paths, credentials, and queries can cause
    // surprising requests and must never be treated as part of the host.
    const match = /^(https?):\/\/(\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::([0-9]{1,5}))?\/?$/i.exec(value);
    if (!match || (match[3] && (Number(match[3]) < 1 || Number(match[3]) > 65535)))
        throw new Error('Use an IP address or hostname, optionally with http://, https://, or a port.');
    return `${match[1].toLowerCase()}://${match[2].toLowerCase()}${match[3] ? `:${Number(match[3])}` : ''}`;
}
