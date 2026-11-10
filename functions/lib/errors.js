// Errors the importer can explain to a person. `code` is a short machine-readable reason the page
// maps to a plain-language message; `message` is a safe sentence (it never contains the full URL,
// credentials or anything from inside the network).
class ImportError extends Error {
    constructor(code, message) {
        super(message || code);
        this.name = 'ImportError';
        this.code = code;
    }
}

module.exports = { ImportError };
