// Custom face pictures on the browser side: shrink a chosen photo, remember it, and keep decoded
// images of everybody in the room for the renderer.
const CustomFaces = (() => {
    const KEY = 'dpm-face';
    const images = {};            // player id (or 'me') -> { img, ready }
    let mine = null;               // data URL of our own picture

    try { mine = window.localStorage.getItem(KEY); } catch (e) {}
    if (mine && !FaceImg.validate(mine)) mine = null;

    function decode(url) {
        const holder = { img: new Image(), ready: false };
        holder.img.onload = () => { holder.ready = true; };
        holder.img.src = url;
        return holder;
    }
    if (mine) images.me = decode(mine);

    // Photo -> centred square -> 64x64 JPEG that fits the server's size limit
    function shrink(file) {
        return new Promise((resolve, reject) => {
            if (!file || !/^image\//.test(file.type)) { reject(new Error('ไม่ใช่ไฟล์รูปภาพ')); return; }
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                const side = Math.min(img.naturalWidth, img.naturalHeight);
                if (!side) { reject(new Error('อ่านรูปไม่ได้')); return; }
                const cv = document.createElement('canvas');
                cv.width = cv.height = 64;
                const g = cv.getContext('2d');
                g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64);
                g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, 64, 64);
                for (const q of [0.8, 0.65, 0.5, 0.35]) {
                    const out = cv.toDataURL('image/jpeg', q);
                    if (FaceImg.validate(out)) { resolve(out); return; }
                }
                reject(new Error('รูปซับซ้อนเกินไป ลองรูปอื่น'));
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('อ่านรูปไม่ได้')); };
            img.src = url;
        });
    }

    return {
        shrink,
        hasMine: () => !!mine,
        mine: () => mine,
        setMine(url) {
            mine = url;
            try { if (url) window.localStorage.setItem(KEY, url); else window.localStorage.removeItem(KEY); } catch (e) {}
            if (url) images.me = decode(url); else delete images.me;
        },
        // a picture arrived from the server for player `id`
        set(id, url) {
            if (url && FaceImg.validate(url)) images[id] = decode(url); else delete images[id];
        },
        // our own picture also stands in for our real player id once we have one
        adopt(id) { if (images.me) images[id] = images.me; },
        // decoded image ready to draw, or null
        get(id) { const h = images[id]; return h && h.ready ? h.img : null; }
    };
})();
