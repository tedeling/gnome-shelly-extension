// Shelly Switch.GetStatus reports apower directly in watts.
export function parseReading(status) {
    if (!status || typeof status !== 'object' || Array.isArray(status))
        throw new Error('The device returned an invalid status.');

    const power = status.apower;
    if (typeof power !== 'number' || !Number.isFinite(power))
        throw new Error('The device did not return a valid power reading.');

    // A failed measurement must not be presented as a successful live reading.
    if (status.errors?.length)
        throw new Error(`Shelly reported: ${status.errors.join(', ')}`);

    return {
        powerWatts: power,
        voltage: finiteOrNull(status.voltage),
        current: finiteOrNull(status.current),
        output: typeof status.output === 'boolean' ? status.output : null,
    };
}

function finiteOrNull(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function formatValue(value, unit, digits = 3, locale = undefined) {
    if (value === null || value === undefined)
        return `— ${unit}`;
    return `${new Intl.NumberFormat(locale, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
    }).format(value)} ${unit}`;
}

export function panelText(reading, locale = undefined) {
    return formatValue(reading?.powerWatts, 'W', 0, locale);
}
