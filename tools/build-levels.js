// Generates game/levels/level{1,2,3}.json from short layout descriptions.
// Distances respect the measured jump limits (see tools/jump-limits.js):
//   max rise ~108px, max flat gap ~217px  ->  we keep rises <= 90 and gaps <= 150.
// Run:  node tools/build-levels.js   then   node tools/reach.js   to verify solvability.
const fs = require('fs');
const path = require('path');

const GROUND_Y = 500;
const WOOD = '#C98B4B';
// Patrolling spikes sweep their whole platform, edge to edge, at a gentle ~60 px/s (speed = range x freq)
const PATROL_SPEED = 60;
const patrol = (platX, platW, y, w = 40) => {
    const range = (platW - w) / 2;
    return { x: platX + range, y, width: w, height: 40, type: 'moving_spikes', rangeX: range, rangeY: 0, freq: +(PATROL_SPEED / range).toFixed(2) };
};

function write(index, data) {
    const name = typeof index === 'number' ? `level${index}` : index;
    const file = path.join(__dirname, '..', 'game', 'levels', `${name}.json`);
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
    console.log(`wrote ${name}.json  (${data.platforms.length} platforms, ${data.hazards.length} hazards, ${(data.items || []).length} items, width ${data.width}, height ${data.height})`);
}

// ---------------------------------------------------------------- level 1: bridges
function level1() {
    const platforms = [], switches = [], hazards = [], items = [], checkpoints = [], shooters = [];
    let x = 0;
    let sw = 0;
    // Respawn flag standing on solid ground (never on a removable bridge)
    const checkpoint = (cx) => checkpoints.push({ x: cx, y: GROUND_Y });

    const ground = (w, extra = {}) => { platforms.push({ x, y: GROUND_Y, width: w, height: 220, ...extra }); x += w; };
    const pit = (w) => { hazards.push({ x, y: 660, width: w, height: 60, type: 'spikes' }); x += w; };
    // A wooden bridge over spikes. Its switch sits just past the far end, so whoever
    // crosses first can cut it behind them.
    const bridge = (w) => {
        platforms.push({ x, y: GROUND_Y, width: w, height: 20, active: true, triggerIndex: sw, color: WOOD });
        hazards.push({ x, y: 660, width: w, height: 60, type: 'spikes' });
        switches.push({ x: x + w + 20, y: GROUND_Y - 40, width: 30, height: 40 });
        sw++;
        x += w;
    };
    const stone = (w, y, h = 30) => platforms.push({ x, y, width: w, height: h });
    const item = (type, ix, iy) => items.push({ type, x: ix, y: iy });

    ground(320); item('orb', 200, 470); item('star', 270, 470);
    bridge(380);
    ground(320); item('star', x - 120, 470); checkpoint(x - 200);
    pit(130);
    ground(90, { bounce: true });   // spring pad: launches you over the next stretch
    ground(110);
    bridge(450);
    ground(260); item('orb', x - 100, 470); checkpoint(x - 190);

    // stepping stones up and over a spike floor
    const stairStart = x;
    const stones = [[140, 430], [140, 360], [140, 290], [140, 360], [140, 430]];
    let sx = x + 100;
    stones.forEach(([w, y]) => { platforms.push({ x: sx, y, width: w, height: 30 }); sx += w + 100; });
    hazards.push({ x: stairStart, y: 660, width: sx - 100 - stairStart + 100, height: 60, type: 'spikes' });
    // patrolling spikes ride on top of the highest stone: land, then time your jump
    // (kept to the right half: you can't hop over them from the lower stone, so the left side must stay free to land on)
    hazards.push(patrol(stairStart + 100 + 2 * 240, 140, 250));
    item('star', stairStart + 100 + 1 * 240 + 70, 320);
    x = sx; // landing starts right after the last gap
    ground(350); item('orb', x - 150, 470); checkpoint(x - 250);
    // an arrow cannon covers the long bridge: time your run
    shooters.push({ x: x + 520 + 70, y: GROUND_Y - 24, vx: -300, vy: 0, width: 36, height: 14, kind: 'arrow', intervalMs: 3000, lifeMs: (590 / 300) * 1000 + 200, offsetMs: 900 });
    bridge(520);
    ground(240); item('star', x - 100, 470); checkpoint(x - 170);

    // pillar hop: narrow pillars with spike gaps
    const hopStart = x;
    for (let i = 0; i < 5; i++) { platforms.push({ x, y: GROUND_Y, width: 100, height: 220 }); x += 100; pit(120); }
    x -= 120; hazards.pop(); // no pit after the last pillar
    // an arrow cannon at the far end sweeps the pillars: jump over the arrows
    const arrowSpeed = 300;
    shooters.push({ x: x + 60, y: GROUND_Y - 24, vx: -arrowSpeed, vy: 0, width: 36, height: 14, kind: 'arrow', intervalMs: 2800, lifeMs: ((x + 60 - hopStart) / arrowSpeed) * 1000 + 300, offsetMs: 1200 });
    ground(300); item('orb', x - 120, 470); item('star', x - 60, 470); checkpoint(x - 220);
    bridge(300);
    ground(120);
    ground(90, { bounce: true });   // a last spring before the finish
    ground(240);

    const width = x;
    write(1, {
        theme: 'meadow',
        timeLimit: 150,
        width, height: 720,
        spawn: { x: 80, y: 440 },
        finish: { x: width - 180, y: 380, width: 80, height: 120 },
        platforms, switches, hazards, items, checkpoints, shooters
    });
}

// ---------------------------------------------------------------- level 2: floating factory
function level2() {
    const platforms = [], switches = [], hazards = [], items = [], checkpoints = [], shooters = [];
    const CHECKPOINT_AT = [3, 7, 12, 16, 20, 25];
    // surface / obstacle kind per floating platform (index in seq)
    const KIND = { 1: 'belt+', 2: 'crumble', 5: 'belt-', 6: 'rock', 11: 'rock', 13: 'belt+', 14: 'crumble', 19: 'belt-', 20: 'crumble', 25: 'belt-' }; // which floating platforms get a respawn flag
    platforms.push({ x: 0, y: 500, width: 240, height: 220 });
    items.push({ type: 'orb', x: 150, y: 470 }, { type: 'star', x: 200, y: 470 });

    // [gap, dy (negative = up), width, flags]
    const seq = [
        [110, -40, 180], [120, -40, 160], [110, 70, 180], [130, -60, 150],
        [100, -50, 170, 'spikes'], [120, 60, 160], [110, 50, 180], [140, -80, 150, 'star'],
        [110, 0, 170, 'cut'], [120, -40, 170], [100, 70, 180, 'spikes'], [130, -30, 150],
        [110, -60, 170, 'orb'], [120, 50, 160], [140, 60, 170],
        [110, -70, 180, 'cut'], [120, -50, 160, 'star'], [110, 50, 170, 'spikes'], [130, 40, 160],
        [100, -80, 180], [120, -50, 150], [110, 70, 170, 'orb'], [130, 60, 160, 'spikes'],
        [110, -70, 170, 'cut'], [120, -40, 180, 'star'], [110, 60, 160], [120, 50, 200]
    ];

    let x = 240, y = 500, pendingSwitch = null, sw = 0;
    seq.forEach(([gap, dy, w, flag], i) => {
        x += gap;
        y = Math.max(220, Math.min(520, y + dy));
        const plat = { x, y, width: w, height: 30 };
        const kind = KIND[i];
        if (kind === 'crumble') plat.crumble = true;
        if (kind === 'belt-') plat.conveyor = -120;
        if (kind === 'belt+') plat.conveyor = 120;
        if (kind === 'rock') {
            // a boulder falls onto this platform every few seconds
            const top = Math.max(20, y - 330);
            shooters.push({ x: x + w / 2 - 15, y: top, vx: 0, vy: 300, width: 30, height: 30, kind: 'rock', intervalMs: 3200, lifeMs: ((y - top + 60) / 300) * 1000, offsetMs: 600 + i * 90 });
        }
        if (flag === 'cut') { plat.active = true; plat.triggerIndex = sw; plat.color = WOOD; pendingSwitch = sw; sw++; }
        platforms.push(plat);
        if (CHECKPOINT_AT.includes(i)) checkpoints.push({ x: x + w / 2, y });
        if (flag === 'spikes') {
            hazards.push(patrol(x, w, y - 40)); // sweeps the whole platform
        }
        if (flag === 'star') items.push({ type: 'star', x: x + w / 2, y: y - 30 });
        if (flag === 'orb') items.push({ type: 'orb', x: x + w / 2, y: y - 30 });
        // a switch on the platform after a "cut" platform lets the crosser drop it behind them
        if (pendingSwitch !== null && flag !== 'cut' && i > 0 && seq[i - 1][3] === 'cut') {
            switches.push({ x: x + 20, y: y - 40, width: 30, height: 40 });
            pendingSwitch = null;
        }
        x += w;
    });

    // a switch needs to follow every cut platform; if the last one was a cut, add it on the goal pad
    const goalX = x + 120;
    platforms.push({ x: goalX, y: 500, width: 420, height: 220 });
    const width = goalX + 420;
    hazards.push({ x: 240, y: 660, width: goalX - 240, height: 60, type: 'spikes' });

    write(2, {
        theme: 'candy',
        timeLimit: 150,
        width, height: 720,
        spawn: { x: 80, y: 440 },
        finish: { x: width - 200, y: 380, width: 80, height: 120 },
        platforms, switches, hazards, items, checkpoints, shooters
    });
}

// ---------------------------------------------------------------- level 3: lava tower
function level3() {
    const platforms = [], switches = [], hazards = [], items = [], checkpoints = [], shooters = [];
    const CHECKPOINT_AT = [4, 11, 17, 22, 28];
    const ARROWS_AT = { 6: 'L', 10: 'R', 14: 'L', 19: 'R', 23: 'L', 26: 'R' }; // wall vents spitting fireballs across the shaft at these platforms // climbing-platform numbers that get a respawn flag
    const FLOOR = 3150;
    platforms.push({ x: 0, y: FLOOR, width: 900, height: 100 });
    items.push({ type: 'orb', x: 200, y: FLOOR - 30 }, { type: 'star', x: 300, y: FLOOR - 30 });

    // zig-zag up in steps of 85px; x stays within the 900px-wide shaft
    const RISE = 85;
    const lanes = [120, 330, 540, 330]; // left edges, cycling
    let y = FLOOR, sw = 0, n = 0;
    while (y - RISE > 330) {
        y -= RISE;
        const w = 190;
        const x = lanes[n % lanes.length] + (n % 7 === 3 ? 40 : 0);
        const plat = { x, y, width: w, height: 30 };
        if (n % 9 === 5) { plat.active = true; plat.triggerIndex = sw; plat.color = WOOD; }
        // special surfaces (never on a switch plank, a checkpoint or a spiked platform)
        const plain = n % 9 === 5 || n % 9 === 6 || CHECKPOINT_AT.includes(n) || (n % 6 === 2 && n > 4) || ARROWS_AT[n];
        if (!plain) {
            if (n % 3 === 1) plat.ice = true;              // frozen ledges: slippery
        }
        if (ARROWS_AT[n]) {
            const fromLeft = ARROWS_AT[n] === 'L', sp = 260;
            shooters.push({ x: fromLeft ? 0 : 864, y: y - 24, vx: fromLeft ? sp : -sp, vy: 0, width: 36, height: 14, kind: 'fireball', intervalMs: 2900, lifeMs: (900 / sp) * 1000 + 200, offsetMs: 800 + n * 60 });
        }
        platforms.push(plat);
        if (CHECKPOINT_AT.includes(n)) checkpoints.push({ x: x + w / 2, y });
        // the switch sits on the platform AFTER the removable one, so you cut it behind you
        if (n % 9 === 6) { switches.push({ x: x + 20, y: y - 40, width: 30, height: 40 }); sw++; }
        if (n % 10 === 4) items.push({ type: 'star', x: x + w / 2, y: y - 30 });
        if (n % 10 === 8) items.push({ type: 'orb', x: x + w / 2, y: y - 30 });
        if (n % 6 === 2 && n > 4) {
            hazards.push(patrol(x, w, y - 40));
        }
        n++;
    }
    // summit
    const topY = y - RISE;
    platforms.push({ x: 300, y: topY, width: 300, height: 30 });
    // if the last climbing platform was a removable one, its switch goes on the summit
    if (platforms.filter(p => p.triggerIndex !== undefined).length > switches.length) {
        switches.push({ x: 320, y: topY - 40, width: 30, height: 40 });
    }

    write(3, {
        theme: 'volcano',
        timeLimit: 150,
        width: 900, height: FLOOR + 250,
        spawn: { x: 100, y: FLOOR - 60 },
        finish: { x: 410, y: topY - 100, width: 80, height: 100 },
        hasRisingLava: true,
        lavaSpeed: 34,
        lavaInitialY: FLOOR + 250,
        platforms, switches, hazards, items, checkpoints, shooters
    });
}

// ---------------------------------------------------------------- level 4: windy dusk (wind + blinking platforms)
function level4() {
    const platforms = [], switches = [], hazards = [], items = [], checkpoints = [], zones = [];
    let x = 0, blinkN = 0;
    const ground = (w) => { platforms.push({ x, y: GROUND_Y, width: w, height: 220 }); x += w; };
    const pit = (w) => { hazards.push({ x, y: 660, width: w, height: 60, type: 'spikes' }); x += w; };
    const flag = (cx) => checkpoints.push({ x: cx, y: GROUND_Y });
    const item = (type, ix, iy) => items.push({ type, x: ix, y: iy });
    // platforms that are solid for 2.4s and gone for 1.4s; neighbours are out of step so there is always a way on
    const blinkRun = (n, gap, width) => {
        const start = x;
        for (let i = 0; i < n; i++) {
            x += gap;
            platforms.push({ x, y: GROUND_Y, width, height: 24, blink: { onMs: 2400, offMs: 1400, offsetMs: (blinkN++ * 900) % 3800 } });
            x += width;
        }
        hazards.push({ x: start, y: 660, width: x - start + gap, height: 60, type: 'spikes' });
        x += gap;
    };
    // wind over a stretch: pushes at `vx` px/s anywhere from the ground up to well above it
    const wind = (x0, w, vx) => zones.push({ kind: 'wind', x: x0, y: GROUND_Y - 330, width: w, height: 420, vx });

    ground(420); item('orb', 200, 470); item('star', 300, 470);
    blinkRun(5, 100, 130);
    ground(360); flag(x - 200); item('star', x - 120, 470);
    // headwind over a gap: jump early and keep pushing
    const g1 = x; ground(300); const w1 = x; pit(110); ground(320);
    wind(w1 - 280, 560, -110);
    flag(x - 160); item('orb', x - 100, 470);
    // tailwind: it carries you too far, so don't over-jump
    ground(100); pit(110); ground(300);
    wind(x - 560, 640, 130);
    blinkRun(4, 100, 130);
    ground(340); flag(x - 170); item('star', x - 100, 470);
    // a gusty finale: headwind over a long blinking run
    const f0 = x;
    blinkRun(5, 100, 140);
    wind(f0, x - f0, -90);
    ground(420); item('orb', x - 200, 470);
    ground(300);

    const width = x;
    write(4, {
        theme: 'dusk',
        timeLimit: 150,
        width, height: 720,
        spawn: { x: 80, y: 440 },
        finish: { x: width - 180, y: 380, width: 80, height: 120 },
        platforms, switches, hazards, items, checkpoints, shooters: [], zones
    });
}

// ---------------------------------------------------------------- level 5: night saw mill (saw blades + low gravity)
function level5() {
    const platforms = [], switches = [], hazards = [], items = [], checkpoints = [], zones = [];
    let x = 0;
    const ground = (w) => { platforms.push({ x, y: GROUND_Y, width: w, height: 220 }); x += w; };
    const pit = (w) => { hazards.push({ x, y: 660, width: w, height: 60, type: 'spikes' }); x += w; };
    const flag = (cx) => checkpoints.push({ x: cx, y: GROUND_Y });
    const item = (type, ix, iy) => items.push({ type, x: ix, y: iy });
    // a saw circling a point in the air: time your crossing
    const saw = (cx, cy, r, freq) => hazards.push({ x: cx - 22, y: cy - 22, width: 44, height: 44, type: 'saw', startX: cx - 22, startY: cy - 22, rangeX: r, rangeY: r, freq });
    const moon = (x0, y0, w, h) => zones.push({ kind: 'moon', x: x0, y: y0, width: w, height: h, g: 0.45 });

    ground(400); item('orb', 200, 470); item('star', 300, 470);
    // saws over a stepping-stone gap
    let sx = x;
    for (let i = 0; i < 3; i++) { x += 100; platforms.push({ x, y: GROUND_Y - (i % 2) * 40, width: 120, height: 30 }); x += 120; }
    hazards.push({ x: sx, y: 660, width: x - sx + 100, height: 60, type: 'spikes' });
    saw(sx + 220, 380, 55, 2.2); saw(sx + 440, 380, 55, 2.2 * 1.15);
    x += 100;
    ground(360); flag(x - 200); item('star', x - 120, 470);
    // low gravity: floaty jumps over a wide pit with saws drifting through the middle
    const m0 = x; sx = x;
    pit(330); // a wide gap that only floaty jumps can clear (need the moon zone: ~330px)
    moon(m0 - 80, GROUND_Y - 420, 330 + 240, 560);
    saw(m0 + 165, 360, 70, 1.8);
    ground(300); flag(x - 150); item('orb', x - 100, 470);
    // vertical saws on a pillar run
    for (let i = 0; i < 4; i++) {
        platforms.push({ x, y: GROUND_Y, width: 110, height: 220 }); x += 110;
        pit(110);
        saw(x - 55, 410, 80, 2.0 + i * 0.25);
    }
    x -= 110; hazards.pop();
    ground(340); flag(x - 170); item('star', x - 100, 470);
    // finale: moon platforms with saws between them
    sx = x;
    const ys = [470, 410, 360, 410, 470];
    ys.forEach(y => { x += 110; platforms.push({ x, y, width: 120, height: 30 }); x += 120; });
    hazards.push({ x: sx, y: 660, width: x - sx + 110, height: 60, type: 'spikes' });
    moon(sx, 160, x - sx + 110, 520);
    saw(sx + 285, 330, 60, 2.4); saw(sx + 745, 330, 60, 2.7);
    x += 110;
    ground(420); item('orb', x - 200, 470);
    ground(300);

    const width = x;
    write(5, {
        theme: 'night',
        timeLimit: 150,
        width, height: 720,
        spawn: { x: 80, y: 440 },
        finish: { x: width - 180, y: 380, width: 80, height: 120 },
        platforms, switches, hazards, items, checkpoints, shooters: [], zones
    });
}

// ---------------------------------------------------------------- survival arenas (last one standing)
// Everything collapses on a schedule, outer parts first; the finish is off the map so nobody "finishes".
function arena(n, theme, build, spawnX = 560) {
    const platforms = [], hazards = [], shooters = [], zones = [];
    build({ platforms, hazards, shooters, zones });
    write(`arena${n}`, {
        theme, mode: 'survival', timeLimit: 75,
        width: 1280, height: 720,
        spawn: { x: spawnX, y: 440 },
        finish: { x: -9999, y: -9999, width: 10, height: 10 },
        platforms, switches: [], hazards, items: [], checkpoints: [], shooters, zones
    });
}
function arenas() {
    arena(1, 'meadow', ({ platforms, hazards }) => {
        // a row of seven stones that fall from the outside in, and three floating ledges that go first
        const times = [16000, 26000, 36000, 48000, 36000, 26000, 16000];
        times.forEach((t, i) => platforms.push({ x: 55 + i * 170, y: 500, width: 150, height: 220, crumbleAt: t }));
        [[200, 14000], [570, 22000], [940, 14000]].forEach(([px, t]) => platforms.push({ x: px, y: 370, width: 140, height: 24, crumbleAt: t }));
        hazards.push({ x: 0, y: 660, width: 1280, height: 60, type: 'spikes' });
    });
    arena(2, 'night', ({ platforms, hazards }) => {
        platforms.push({ x: 70, y: 500, width: 280, height: 220, crumbleAt: 20000 });
        platforms.push({ x: 930, y: 500, width: 280, height: 220, crumbleAt: 20000 });
        platforms.push({ x: 400, y: 500, width: 240, height: 220, crumbleAt: 34000 });
        platforms.push({ x: 640, y: 500, width: 240, height: 220, crumbleAt: 46000 });
        platforms.push({ x: 560, y: 360, width: 160, height: 24, crumbleAt: 12000 });
        // a saw circles over the middle: keep moving
        hazards.push({ x: 618, y: 238, width: 44, height: 44, type: 'saw', startX: 618, startY: 238, rangeX: 150, rangeY: 110, freq: 1.5 });
        hazards.push({ x: 0, y: 660, width: 1280, height: 60, type: 'spikes' });
    });
    // icy islands with a steady wind pushing everyone towards the right-hand edge
    arena(3, 'dusk', ({ platforms, hazards, zones }) => {
        [[60, 230, 22000], [320, 230, 32000], [580, 230, 42000], [840, 230, 32000], [1100, 100, 22000]].forEach(([x, w, t]) =>
            platforms.push({ x, y: 500, width: w, height: 220, ice: true, crumbleAt: t }));
        platforms.push({ x: 330, y: 360, width: 150, height: 24, ice: true, crumbleAt: 14000 });
        platforms.push({ x: 780, y: 360, width: 150, height: 24, ice: true, crumbleAt: 14000 });
        zones.push({ kind: 'wind', x: 0, y: 100, width: 1280, height: 560, vx: 70 });
        hazards.push({ x: 0, y: 660, width: 1280, height: 60, type: 'spikes' });
    }, 600);
    // conveyor belts pulling towards the middle spring, with arrows flying across the floor
    arena(4, 'candy', ({ platforms, hazards, shooters }) => {
        platforms.push({ x: 90, y: 500, width: 400, height: 220, conveyor: 90, crumbleAt: 30000 });
        platforms.push({ x: 790, y: 500, width: 400, height: 220, conveyor: -90, crumbleAt: 30000 });
        platforms.push({ x: 490, y: 500, width: 300, height: 220, bounce: true, crumbleAt: 46000 });
        platforms.push({ x: 560, y: 340, width: 160, height: 24, crumbleAt: 18000 });
        shooters.push({ x: 0, y: 476, vx: 280, vy: 0, width: 36, height: 14, kind: 'arrow', intervalMs: 3200, lifeMs: 4800, offsetMs: 4000 });
        shooters.push({ x: 1244, y: 476, vx: -280, vy: 0, width: 36, height: 14, kind: 'arrow', intervalMs: 3200, lifeMs: 4800, offsetMs: 5600 });
        hazards.push({ x: 0, y: 660, width: 1280, height: 60, type: 'spikes' });
    }, 120);
}

// ---------------------------------------------------------------- tutorial (practice room, not in the level pool)
// `hints` show on screen while the player is past that x; {jump} etc. become the player's own keys.
function tutorial() {
    const platforms = [], switches = [], hazards = [], items = [], checkpoints = [], hints = [];
    let x = 0, sw = 0;
    const ground = (w, extra = {}) => { platforms.push({ x, y: GROUND_Y, width: w, height: 220, ...extra }); x += w; };
    const pit = (w) => { hazards.push({ x, y: 660, width: w, height: 60, type: 'spikes' }); x += w; };
    const hint = (hx, text) => hints.push({ x: hx, text });

    hint(0, 'เดินไปทางขวาด้วย {left} / {right}');
    ground(520);
    hint(320, 'กระโดดด้วย {jump} (กดค้างจะสูงขึ้น)');
    // a gap with spikes: the first thing to jump over
    hint(430, 'กระโดดข้ามหนามไปให้ได้!');
    pit(110);
    ground(500);
    hint(x - 380, 'ดาวสุ่มพลัง: ค้าง {inhale} ใกล้ดาวเพื่ออม แล้วปล่อยให้กลืน');
    items.push({ type: 'star', x: x - 300, y: 470 }, { type: 'star', x: x - 240, y: 470 });
    hint(x - 180, 'ได้พลังแล้ว กด {power} เพื่อใช้ (ไฟ น้ำแข็ง ใบพัด หรือปีก)');
    checkpoints.push({ x: x - 60, y: GROUND_Y });
    hint(x - 90, 'ธงชมพู = จุดเกิดใหม่ ถ้าหัวใจยังเหลือ ตายแล้วจะกลับมาที่ธง');

    // a wooden bridge with its switch just past the far end
    const bx = x, bw = 340;
    platforms.push({ x, y: GROUND_Y, width: bw, height: 20, active: true, triggerIndex: sw, color: WOOD });
    hazards.push({ x, y: 660, width: bw, height: 60, type: 'spikes' });
    switches.push({ x: x + bw + 20, y: GROUND_Y - 40, width: 30, height: 40 });
    x += bw;
    hint(bx, 'สะพานไม้: ข้ามไปแล้วกด {interact} ที่คันโยก จะตัดสะพานหลังตัวเอง (กลับมาเองใน 7 วิ)');
    ground(420);
    hint(x - 400, 'เจอเพื่อน? ผลักด้วย {push} ดึงด้วย {pull} หรือค้าง {inhale} เพื่ออมเพื่อน แล้วพ่นออก (ค้างนานพ่นแรง)');
    items.push({ type: 'orb', x: x - 200, y: 470 });
    hint(x - 220, 'ลูกแก้วอมไว้แล้วพ่นใส่เพื่อนได้ (กด {inhale} อีกครั้ง)');

    // spring pad over the last gap
    hint(x - 60, 'แผ่นสปริงสีชมพู: เหยียบแล้วเด้งสูง');
    pit(140);
    platforms.push({ x, y: GROUND_Y, width: 90, height: 220, bounce: true }); x += 90;
    ground(200);
    // the finish
    hint(x - 180, 'เส้นชัยอยู่ข้างหน้าแล้ว!');
    ground(380);

    const width = x;
    write('tutorial', {
        theme: 'meadow',
        timeLimit: 600,
        width, height: 720,
        spawn: { x: 80, y: 440 },
        finish: { x: width - 180, y: 380, width: 80, height: 120 },
        platforms, switches, hazards, items, checkpoints, shooters: [], hints
    });
}

level1(); level2(); level3(); level4(); level5(); arenas(); tutorial();
