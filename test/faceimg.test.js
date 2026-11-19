const test = require('node:test');
const assert = require('node:assert/strict');
const FaceImg = require('../shared/faceimg');
const GameRoom = require('../game/GameRoom');
const Skins = require('../shared/skins');

const jpeg = (n = 600) => 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(n, 7)]).toString('base64');
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test('valid small JPEG and PNG pictures are accepted', () => {
    assert.ok(FaceImg.validate(jpeg()));
    assert.ok(FaceImg.validate(PNG_1PX));
});

test('everything else is rejected', () => {
    const bad = [
        null, undefined, 42, {}, [], '', 'data:image/jpeg;base64,',
        'http://evil.example/x.png',
        'data:image/svg+xml;base64,' + Buffer.from('<svg onload=alert(1)>').toString('base64'),
        'data:text/html;base64,' + Buffer.from('<script>alert(1)</script>').toString('base64'),
        'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
        'data:image/jpeg;base64,' + Buffer.from('not a jpeg at all, just text........').toString('base64'),   // wrong magic bytes
        'data:image/png;base64,' + Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF]), Buffer.alloc(60)]).toString('base64'), // label lies
        jpeg(20000),                                   // too big
        jpeg() + '"><script>',                         // junk after the data
        'data:image/jpeg;base64,/9j/%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%'
    ];
    bad.forEach(b => assert.equal(FaceImg.validate(b), null, `should reject: ${String(b).slice(0, 50)}`));
});

test('a face picture is only kept for players in the lobby, and can be removed', () => {
    const room = new GameRoom('0000', { to: () => ({ emit() {} }) });
    room.addPlayer('a', 'A');
    assert.equal(room.setFaceImage('a', jpeg()), true);
    assert.ok(room.players.a.faceImg);
    assert.equal(room.setFaceImage('a', null), true);
    assert.equal(room.players.a.faceImg, null);
    assert.equal(room.setFaceImage('nobody', jpeg()), false);
    room.status = 'playing';
    assert.equal(room.setFaceImage('a', jpeg()), false);
});

test('"custom" is a valid face id and unknown ones are still refused', () => {
    assert.equal(Skins.sanitizeSkin({ face: 'custom' }).face, 'custom');
    assert.equal(Skins.sanitizeSkin({ face: 'customx' }).face, 'classic');
});
