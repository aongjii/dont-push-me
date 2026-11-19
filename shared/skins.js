// Cosmetics catalogue: body colour, face, hat, accessory.
// Shared by the server (validation) and the browser (the dress-up screen).
// UMD: require() in Node, window.Skins in the browser.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.Skins = factory();
})(typeof self !== 'undefined' ? self : this, function () {

    // The first four are the original player colours (so a room of default players looks as before)
    const COLORS = [
        { id: 'pink',   hex: '#FF7EA8', name: 'ชมพู' },
        { id: 'blue',   hex: '#5BB8FF', name: 'ฟ้า' },
        { id: 'yellow', hex: '#FFC93C', name: 'เหลือง' },
        { id: 'green',  hex: '#6FD98C', name: 'เขียว' },
        { id: 'purple', hex: '#B28DFF', name: 'ม่วง' },
        { id: 'orange', hex: '#FF9D5C', name: 'ส้ม' },
        { id: 'mint',   hex: '#5ED6C4', name: 'มิ้นต์' },
        { id: 'red',    hex: '#FF6B6B', name: 'แดง' },
        { id: 'white',  hex: '#F4F1FA', name: 'ขาว' },
        { id: 'grey',   hex: '#9A93B5', name: 'เทา' },
        { id: 'brown',  hex: '#C49A6C', name: 'น้ำตาล' },
        { id: 'lime',   hex: '#B7E05A', name: 'เลมอน' },
        { id: 'teal',   hex: '#3CB8C9', name: 'ฟ้าทะเล' },
        { id: 'coral',  hex: '#FF8E7A', name: 'ปะการัง' },
        { id: 'gold',   hex: '#E8C26A', name: 'ทอง' },
        { id: 'indigo', hex: '#7B8CDE', name: 'คราม' }
    ];

    const FACES = [
        { id: 'classic', name: 'ปกติ' },
        { id: 'happy',   name: 'ยิ้มแป้น' },
        { id: 'sleepy',  name: 'ง่วงนอน' },
        { id: 'smirk',   name: 'ยิ้มมุมปาก' },
        { id: 'angry',   name: 'โกรธ' },
        { id: 'cat',     name: 'แมวเหมียว' },
        { id: 'derp',    name: 'ตาเหล่' },
        { id: 'wow',     name: 'ตกใจ' },
        { id: 'abe',     name: 'อาเบะ ยาราไนกะ' },
        { id: 'wink',    name: 'ขยิบตา' },
        { id: 'uwu',     name: 'ตาวิบวับ' },
        { id: 'bored',   name: 'เบื่อโลก' },
        { id: 'cry',     name: 'ร้องไห้' }
    ];

    const HATS = [
        { id: 'none',       name: 'ไม่ใส่' },
        { id: 'crown',      name: 'มงกุฎ' },
        { id: 'cap',        name: 'หมวกแก๊ป' },
        { id: 'beanie',     name: 'หมวกไหมพรม' },
        { id: 'party',      name: 'หมวกปาร์ตี้' },
        { id: 'catears',    name: 'หูแมว' },
        { id: 'bunny',      name: 'หูกระต่าย' },
        { id: 'chef',       name: 'หมวกเชฟ' },
        { id: 'halo',       name: 'รัศมีนางฟ้า' },
        { id: 'flower',     name: 'ดอกไม้' },
        { id: 'tophat',     name: 'หมวกทรงสูง' },
        { id: 'headband',   name: 'ผ้าคาดหัว' },
        { id: 'horns',      name: 'เขาปีศาจ' },
        { id: 'pirate',     name: 'หมวกโจรสลัด' },
        { id: 'wizard',     name: 'หมวกพ่อมด' },
        { id: 'cowboy',     name: 'หมวกคาวบอย' },
        { id: 'sprout',     name: 'ต้นอ่อน' },
        { id: 'helmet',     name: 'หมวกนิรภัย' },
        { id: 'headphones', name: 'หูฟัง' },
        { id: 'santa',      name: 'หมวกซานต้า' },
        { id: 'bow',        name: 'โบว์' },
        { id: 'mushroom',   name: 'หมวกเห็ด' }
    ];

    const ACCS = [
        { id: 'none',       name: 'ไม่ใส่' },
        { id: 'glasses',    name: 'แว่นตา' },
        { id: 'sunglasses', name: 'แว่นกันแดด' },
        { id: 'mustache',   name: 'หนวด' },
        { id: 'bowtie',     name: 'โบว์ผูกคอ' },
        { id: 'scarf',      name: 'ผ้าพันคอ' },
        { id: 'overalls',   name: 'ชุดช่างสีน้ำเงิน' },
        { id: 'eyepatch',   name: 'ผ้าปิดตา' },
        { id: 'cape',       name: 'ผ้าคลุม' },
        { id: 'backpack',   name: 'กระเป๋าเป้' },
        { id: 'tie',        name: 'เนคไท' },
        { id: 'medal',      name: 'เหรียญรางวัล' },
        { id: 'pearls',     name: 'สร้อยไข่มุก' },
        { id: 'bandaid',    name: 'พลาสเตอร์' },
        { id: 'monocle',    name: 'แว่นข้างเดียว' },
        { id: 'apron',      name: 'ผ้ากันเปื้อน' },
        { id: 'lei',        name: 'พวงมาลัยดอกไม้' }
    ];

    // patterns printed on the body
    const PATTERNS = [
        { id: 'none',     name: 'เรียบ' },
        { id: 'spots',    name: 'ลายจุด' },
        { id: 'stripes',  name: 'ลายขวาง' },
        { id: 'hearts',   name: 'ลายหัวใจ' },
        { id: 'stars',    name: 'ลายดาว' },
        { id: 'checks',   name: 'ลายหมากรุก' },
        { id: 'freckles', name: 'กระ' }
    ];

    const DEFAULT_SKIN = { color: COLORS[0].hex, face: 'classic', hat: 'none', acc: 'none', pat: 'none' };

    const has = (list, id) => list.some(o => o.id === id);

    // Accepts anything a client might send and returns a valid skin (unknown values -> default)
    function sanitizeSkin(raw) {
        const s = raw && typeof raw === 'object' ? raw : {};
        const hex = typeof s.color === 'string' ? s.color.toUpperCase() : '';
        const color = COLORS.find(c => c.hex.toUpperCase() === hex);
        return {
            color: color ? color.hex : DEFAULT_SKIN.color,
            face: typeof s.face === 'string' && has(FACES, s.face) ? s.face : DEFAULT_SKIN.face,
            hat: typeof s.hat === 'string' && has(HATS, s.hat) ? s.hat : DEFAULT_SKIN.hat,
            acc: typeof s.acc === 'string' && has(ACCS, s.acc) ? s.acc : DEFAULT_SKIN.acc,
            pat: typeof s.pat === 'string' && has(PATTERNS, s.pat) ? s.pat : DEFAULT_SKIN.pat
        };
    }

    const pick = (list, rnd) => list[Math.floor(rnd() * list.length)];

    function randomSkin(rnd) {
        rnd = rnd || Math.random;
        return {
            color: pick(COLORS, rnd).hex,
            face: pick(FACES, rnd).id,
            hat: pick(HATS, rnd).id,
            acc: pick(ACCS, rnd).id,
            pat: pick(PATTERNS, rnd).id
        };
    }

    // First palette colour that nobody in `taken` is using
    function freeColor(taken) {
        const used = new Set((taken || []).map(c => String(c).toUpperCase()));
        const c = COLORS.find(col => !used.has(col.hex.toUpperCase()));
        return c ? c.hex : COLORS[0].hex;
    }

    return { COLORS, FACES, HATS, ACCS, PATTERNS, DEFAULT_SKIN, sanitizeSkin, randomSkin, freeColor };
});
