import Secret from 'gi://Secret';

// Create the schema lazily; importing an extension must not acquire resources.
function schema() {
    return new Secret.Schema('org.gnome.shell.extensions.shelly-energy',
        Secret.SchemaFlags.NONE, {origin: Secret.SchemaAttributeType.STRING});
}

export function lookupPassword(origin, cancellable = null) {
    return new Promise((resolve, reject) => {
        Secret.password_lookup(schema(), {origin}, cancellable, (_source, result) => {
            try {
                resolve(Secret.password_lookup_finish(result));
            } catch (error) {
                reject(error);
            }
        });
    });
}

export function savePassword(origin, password, cancellable = null) {
    return new Promise((resolve, reject) => {
        Secret.password_store(schema(), {origin}, Secret.COLLECTION_DEFAULT,
            `Shelly Energy (${origin})`, password, cancellable, (_source, result) => {
                try {
                    if (!Secret.password_store_finish(result))
                        throw new Error('The login keyring did not save the password.');
                    resolve();
                } catch (error) {
                    reject(error);
                }
            });
    });
}

export function clearPassword(origin, cancellable = null) {
    return new Promise((resolve, reject) => {
        Secret.password_clear(schema(), {origin}, cancellable, (_source, result) => {
            try {
                resolve(Secret.password_clear_finish(result));
            } catch (error) {
                reject(error);
            }
        });
    });
}
