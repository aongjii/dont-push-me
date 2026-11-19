// Custom face pictures. The browser shrinks a photo to a tiny JPEG (64x64) and sends it as a data URL;
// the server checks it hard before passing it on to the other players in the room. Never stored on disk.
// UMD: require() in Node, window.FaceImg in the browser.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.FaceImg = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    const MAX_LENGTH = 14000;   // characters of the data URL (a 64x64 JPEG is ~2-4 KB)
    const RE = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/;

    function bytesOf(b64) {
        if (typeof Buffer !== 'undefined') return Buffer.from(b64, 'base64');
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    // Returns the data URL if it is an acceptable picture, otherwise null
    function validate(value) {
        if (typeof value !== 'string' || value.length > MAX_LENGTH || value.length < 40) return null;
        const m = RE.exec(value);
        if (!m) return null;
        const bytes = bytesOf(m[2]);
        if (bytes.length < 20 || bytes.length > 10500) return null;
        const jpeg = bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;
        const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
        if (m[1] === 'jpeg' ? !jpeg : !png) return null;   // the label must match the real file type
        return value;
    }

    return { MAX_LENGTH, validate };
});
