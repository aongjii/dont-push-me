const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Level = require('../game/Level');
const GameRoom = require('../game/GameRoom');

const RESTORE = Level.SWITCH_RESTORE_MS;

test('a bridge that was cut comes back by itself, and its switch resets', () => {
    const lv = new Level(1);
    const bridge = lv.platforms.find(p => p.triggerIndex === 0);
    assert.equal(bridge.active, true);

    assert.equal(lv.toggleSwitch(0), true);
    assert.equal(bridge.active, false, 'cut');
    assert.equal(lv.switches[0].active, true);
    assert.ok(bridge.returnMs > 0);

    lv.update(RESTORE - 500);
    assert.equal(bridge.active, false, 'still gone just before the time is up');
    lv.update(600);
    assert.equal(bridge.active, true, 'back');
    assert.equal(lv.switches[0].active, false, 'switch is back to normal too');
    assert.equal(bridge.returnMs, 0);
});

test('flipping the switch back early restores the bridge at once and cancels the timer', () => {
    const lv = new Level(1);
    const bridge = lv.platforms.find(p => p.triggerIndex === 0);
    lv.toggleSwitch(0);
    lv.update(1000);
    lv.toggleSwitch(0);
    assert.equal(bridge.active, true);
    assert.equal(bridge.returnMs, 0);
    lv.update(RESTORE * 2); // nothing odd happens afterwards
    assert.equal(bridge.active, true);
});

test('cutting it again restarts the clock', () => {
    const lv = new Level(1);
    const bridge = lv.platforms.find(p => p.triggerIndex === 0);
    lv.toggleSwitch(0);
    lv.update(RESTORE + 10);
    assert.equal(bridge.active, true);
    lv.toggleSwitch(0);
    assert.equal(bridge.active, false);
    assert.ok(bridge.returnMs > RESTORE - 100);
});

test('platforms that start hidden are hidden again after being revealed', () => {
    const lv = new Level(1);
    // pretend one switched platform starts hidden
    const p = lv.platforms.find(pl => pl.triggerIndex === 0);
    p.active = false; p.initialActive = false;
    lv.toggleSwitch(0);
    assert.equal(p.active, true);
    lv.update(RESTORE + 10);
    assert.equal(p.active, false);
});

test('in every level, whatever anyone does with the switches, every path is open again within a few seconds', () => {
    const dir = path.join(__dirname, '..', 'game', 'levels');
    for (const f of fs.readdirSync(dir).filter(n => /^level\d+\.json$/.test(n))) {
        const lv = new Level(parseInt(/\d+/.exec(f)[0], 10));
        const steady = (p) => !p.blink; // blinking platforms follow their own clock
        const normal = lv.platforms.filter(steady).map(p => p.active);
        lv.switches.forEach((_, i) => lv.toggleSwitch(i)); // a griefer cuts everything at once
        if (lv.switches.length) assert.ok(lv.platforms.some(p => p.triggerIndex !== null && !p.active), `${f}: nothing was cut`);
        lv.update(RESTORE + 50);
        assert.deepEqual(lv.platforms.filter(steady).map(p => p.active), normal, `${f}: not back to normal`);
        assert.ok(lv.switches.every(s => s.active === s.initialActive));
    }
});

test('a player can cross a bridge that was cut once it is back', () => {
    const room = new GameRoom('0000', { to: () => ({ emit() {} }) });
    room.addPlayer('a', 'A');
    room.startGame();
    clearInterval(room.countdownInterval);
    room.status = 'playing';
    room.roundTimeLeft = 1e9;
    const p = room.players.a;
    const bridge = room.level.platforms.find(pl => pl.triggerIndex === 0); // x 320..700
    room.level.toggleSwitch(0);

    // stand on the near edge; with the bridge gone there is nothing to walk on
    p.x = bridge.x - 40; p.y = 460; p.vx = 0; p.vy = 0;
    p.input.right = true;
    const step = 1000 / 60;
    let t = 0;
    for (; t < 1500 && !p.isDead; t += step) room.gameLoop.update(step);
    assert.equal(p.isDead, true, 'fell into the pit while the bridge was gone');

    // after the bridge returns, walking the same way works
    const q = room.players.a;
    for (let i = 0; i < 600; i++) room.gameLoop.update(step); // let time pass (and respawn)
    assert.equal(bridge.active, true);
    q.isDead = false; q.respawnMs = 0; q.invulnMs = 5000;
    q.x = bridge.x - 40; q.y = 460; q.vx = 0; q.vy = 0; q.input.right = true;
    for (let i = 0; i < 180; i++) room.gameLoop.update(step);
    assert.ok(q.x > bridge.x + 100, `could not cross: x=${q.x}`);
});

test('the platform state sent to players includes how long until a cut bridge returns', () => {
    const events = [];
    const room = new GameRoom('0000', { to: () => ({ emit: (t, d) => events.push({ t, d }) }) });
    room.addPlayer('a', 'A'); room.addPlayer('b', 'B');
    room.startGame();
    clearInterval(room.countdownInterval);
    room.status = 'playing';
    room.level.toggleSwitch(0);
    room.broadcastState();
    const state = events.filter(e => e.t === 'game_state').pop().d;
    const cut = state.platforms.find(p => p.triggerIndex === 0);
    assert.equal(cut.active, false);
    assert.ok(cut.returnMs > 6000);
});
