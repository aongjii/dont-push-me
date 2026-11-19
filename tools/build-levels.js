// Generates game/levels/level{1,2,3}.json from short layout descriptions.
// Distances respect the measured jump limits (see tools/jump-limits.js):
//   max rise ~108px, max flat gap ~217px  ->  we keep rises <= 90 and gaps <= 150.
// Run:  node tools/build-levels.js   then   node tools/reach.js   to verify solvability.
const fs = require('fs');
const path = require('path');

const GROUND_Y = 500;
const WOOD = '#C98B4B';

function write(index, data) {
    const file = path.join(__dirname, '..', 'game', 'levels', `level${index}.json`);
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
    console.log(`wrote level${index}.json  (${data.platforms.length} platforms, ${data.hazards.length} hazards, ${(data.items || []).length} items, width ${data.width}, height ${data.height})`);
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
    hazards.push({ x: stairStart + 100 + 2 * 240 + 72, y: 250, width: 40, height: 40, type: 'moving_spikes', rangeX: 14, rangeY: 0, freq: 8 });
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
            hazards.push({ x: x + w / 2 - 20, y: y - 40, width: 40, height: 40, type: 'moving_spikes', rangeX: 12, rangeY: 0, freq: 9 }); // short patrol in the middle: a safe lane at each side
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
            hazards.push({ x: x + (w - 40) / 2, y: y - 40, width: 40, height: 40, type: 'moving_spikes', rangeX: 15, rangeY: 0, freq: 7.5 });
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

level1(); level2(); level3();
