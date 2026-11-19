const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeInput, sanitizeName, sanitizeRoomCode, createRateLimiter } = require('../game/validation');

test('sanitizeInput keeps only known keys as strict booleans', () => {
    assert.deepEqual(
        sanitizeInput({ left: true, right: 'yes', jump: 1, x: 999, __proto__: { evil: 1 } }),
        { left: true, right: false, jump: false }
    );
    assert.deepEqual(sanitizeInput(null), {});
    assert.deepEqual(sanitizeInput('left'), {});
});

test('sanitizeName trims, strips control chars and caps length', () => {
    assert.equal(sanitizeName('  Bob \n', 'x'), 'Bob');
    assert.equal(sanitizeName('a'.repeat(40), 'x').length, 12);
    assert.equal(sanitizeName('', 'fallback'), 'fallback');
    assert.equal(sanitizeName({ a: 1 }, 'fallback'), 'fallback');
    assert.equal(sanitizeName('\u0000\u0007', 'fallback'), 'fallback');
});

test('sanitizeRoomCode accepts only 6-digit codes', () => {
    assert.equal(sanitizeRoomCode('123456'), '123456');
    assert.equal(sanitizeRoomCode(123456), '123456');
    assert.equal(sanitizeRoomCode('1234'), null, 'old 4-digit codes are no longer valid');
    assert.equal(sanitizeRoomCode('1234567'), null);
    assert.equal(sanitizeRoomCode('12345a'), null);
    assert.equal(sanitizeRoomCode(undefined), null);
});

test('rate limiter blocks bursts and recovers next window', () => {
    let t = 0;
    const allow = createRateLimiter(3, 1000, () => t);
    assert.deepEqual([allow(), allow(), allow(), allow()], [true, true, true, false]);
    t = 1000;
    assert.equal(allow(), true);
});

test('sanitizeEmote accepts only indexes 0-3', () => {
    const { sanitizeEmote } = require('../game/validation');
    assert.equal(sanitizeEmote(0), 0);
    assert.equal(sanitizeEmote(3), 3);
    for (const bad of [4, -1, 1.5, '1', null, undefined, {}, NaN]) assert.equal(sanitizeEmote(bad), null);
});
