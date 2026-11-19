// Flat, bright rendering: pastel themes per level, round "blob" characters.
// No glows or gradients on purpose.

const INK = '#2B2140';

// The "Abe" face is a real picture pasted flat onto the cartoon blob (funny because it clashes).
// Until it has loaded, the hand-drawn vector face below is used instead.
const ABE_FACE = (() => {
    const holder = { img: new Image(), ready: false };
    holder.img.onload = () => {
        holder.ready = true;
        window.dispatchEvent(new Event('abe-ready'));
    };
    holder.img.src = 'img/abe.png';
    return holder;
})();

const THEMES = {
    meadow: {
        sky: '#9ADBFF', cloud: '#FFFFFF', hillFar: '#A8E4B9', hillNear: '#82D49C',
        ground: '#B8855C', groundDark: '#9E6E48', top: '#62CC7A', topDark: '#4DB468',
        stone: '#CBD5E8', stoneTop: '#EAF0FA', wood: '#E3A867', woodDark: '#BE8348',
        spike: '#FF6B6B', spikeBase: '#8A5252', lava: '#FF8A4C', lava2: '#FFB57A'
    },
    candy: {
        sky: '#FFD3E6', cloud: '#FFFFFF', hillFar: '#F6B9D6', hillNear: '#E7A4E6',
        ground: '#9C86E0', groundDark: '#8570CF', top: '#FF9FC5', topDark: '#F27FAE',
        stone: '#D2C0FF', stoneTop: '#F0E6FF', wood: '#FFB86B', woodDark: '#E89647',
        spike: '#FF5E7E', spikeBase: '#7A4B7A', lava: '#FF8A4C', lava2: '#FFB57A'
    },
    volcano: {
        sky: '#FFC9A3', cloud: '#FFE7D2', hillFar: '#EBA57D', hillNear: '#D6805F',
        ground: '#74504F', groundDark: '#5E3F3F', top: '#9A6E6A', topDark: '#85605C',
        stone: '#977474', stoneTop: '#C29A98', wood: '#E3A867', woodDark: '#BE8348',
        spike: '#E64A4A', spikeBase: '#5E3F3F', lava: '#FF6A2B', lava2: '#FFA14D'
    }
};

// mix a hex colour toward white (amt > 0) or black (amt < 0)
function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const mix = (c) => Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt));
    const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
    return `rgb(${r},${g},${b})`;
}

class Renderer {
    constructor(canvasId) {
        this.canvas = typeof canvasId === 'string' ? document.getElementById(canvasId) : canvasId;
        this.ctx = this.canvas.getContext('2d');

        // Virtual resolution
        this.virtualWidth = this.canvas.width;
        this.virtualHeight = this.canvas.height;

        // Camera offset
        this.camera = { x: 0, y: 0 };
        this.shakeTimer = 0;
        this.shakeIntensity = 0;

        this.time = 0;
        this.theme = THEMES.meadow;
        this.keyLabels = { interact: 'E', inhale: 'C' }; // updated from the player's key settings

        // Visual properties
        this.particles = [];
        this.emotes = {}; // playerId -> { emoji, start }
    }

    setTheme(name) {
        this.theme = THEMES[name] || THEMES.meadow;
    }

    triggerShake(duration = 200, intensity = 5) {
        this.shakeTimer = duration;
        this.shakeIntensity = intensity;
    }

    addEmote(playerId, emoji) {
        this.emotes[playerId] = { emoji, start: performance.now() };
    }

    addParticles(x, y, color, count = 8, { spread = 200, up = 100, size = 4 } = {}) {
        for (let i = 0; i < count; i++) {
            this.particles.push({
                x,
                y,
                vx: (Math.random() - 0.5) * spread,
                vy: (Math.random() - 0.5) * spread - up,
                radius: Math.random() * size + 2,
                color,
                alpha: 1,
                life: 0.5 + Math.random() * 0.5 // seconds
            });
        }
    }

    updateParticles(dt) {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vy += 300 * dt; // gravity
            p.life -= dt;
            p.alpha = Math.max(0, Math.min(1, p.life * 2));
            if (p.life <= 0) this.particles.splice(i, 1);
        }
    }

    // ------------------------------------------------------------------ frame
    // cameraTargetId: whose view to show (defaults to the local player; used when spectating)
    draw(gameState, localPlayerId, levelData, dt, cameraTargetId = localPlayerId) {
        const ctx = this.ctx;
        this.time += dt;
        this.updateParticles(dt);

        // Screen shake
        let shakeX = 0, shakeY = 0;
        if (this.shakeTimer > 0) {
            this.shakeTimer -= dt * 1000;
            shakeX = (Math.random() - 0.5) * this.shakeIntensity;
            shakeY = (Math.random() - 0.5) * this.shakeIntensity;
        }

        const localPlayer = gameState.players.find(p => p.id === localPlayerId);
        const mapWidth = levelData.levelWidth;
        const mapHeight = levelData.levelHeight;

        // Camera follows the followed player (leaning a little in the facing direction)
        const camPlayer = gameState.players.find(p => p.id === cameraTargetId) || localPlayer;
        if (camPlayer) {
            if (mapWidth > this.virtualWidth) {
                const target = camPlayer.x - this.virtualWidth / 2 + camPlayer.width / 2 + camPlayer.facing * 60;
                this.camera.x = Math.max(0, Math.min(target, mapWidth - this.virtualWidth));
            } else {
                this.camera.x = (mapWidth - this.virtualWidth) / 2;
            }
            if (mapHeight > this.virtualHeight) {
                const target = camPlayer.y - this.virtualHeight / 2 + camPlayer.height / 2;
                this.camera.y = Math.max(0, Math.min(target, mapHeight - this.virtualHeight));
            } else {
                this.camera.y = (mapHeight - this.virtualHeight) / 2;
            }
        }

        const camX = this.camera.x + shakeX;
        const camY = this.camera.y + shakeY;

        this.drawBackground(camX, camY, mapWidth, mapHeight);

        ctx.save();
        ctx.translate(-Math.round(camX), -Math.round(camY));

        // World, back to front
        this.drawFinish(levelData.finishZone);
        gameState.platforms.forEach(p => this.drawPlatform(p));
        (levelData.switches || []).forEach((sw, idx) => {
            this.drawSwitch(sw, this.switchActive(gameState, idx));
            if (localPlayer && !localPlayer.isDead && !localPlayer.isFinished) {
                const dx = sw.x + sw.width / 2 - (localPlayer.x + localPlayer.width / 2);
                const dy = sw.y + sw.height / 2 - (localPlayer.y + localPlayer.height / 2);
                if (Math.hypot(dx, dy) < 60) this.drawKeyPrompt(sw.x + sw.width / 2, sw.y - 26, this.keyLabels.interact);
            }
        });
        gameState.hazards.forEach(h => this.drawHazard(h));
        (levelData.checkpoints || []).forEach((cp, i) => this.drawCheckpoint(cp, !!localPlayer && localPlayer.cp >= i));
        // Only the closest item shows the "hold C" hint, so overlapping hints don't clutter the screen
        const items = (gameState.items || []).filter(it => it.alive);
        let nearest = null;
        if (localPlayer) {
            let best = 190;
            items.forEach(it => {
                const d = Math.hypot(it.x - (localPlayer.x + localPlayer.width / 2), it.y - (localPlayer.y + localPlayer.height / 2));
                if (d < best) { best = d; nearest = it; }
            });
        }
        items.forEach(it => this.drawItem(it, localPlayer, it === nearest));

        // Players: others first, local on top
        const players = gameState.players.filter(p => !p.swallowed);
        players.sort((a, b) => (a.id === localPlayerId) - (b.id === localPlayerId));
        players.forEach(p => this.drawPlayer(p, p.id === localPlayerId, gameState));

        (gameState.projectiles || []).forEach(pr => this.drawProjectile(pr));

        // Particles on top of characters
        this.particles.forEach(p => {
            ctx.save();
            ctx.globalAlpha = p.alpha;
            ctx.fillStyle = p.color;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });

        if (gameState.lavaY !== null) this.drawLava(gameState.lavaY, mapWidth, mapHeight);

        ctx.restore();
    }

    // Switch state comes from the platform it drives
    switchActive(gameState, idx) {
        const plat = gameState.platforms.find(p => p.triggerIndex === idx);
        return plat ? plat.active : false;
    }

    // ------------------------------------------------------------ background
    drawBackground(camX, camY, mapWidth, mapHeight) {
        const ctx = this.ctx;
        const W = this.virtualWidth, H = this.virtualHeight;
        const th = this.theme;

        ctx.fillStyle = th.sky;
        ctx.fillRect(0, 0, W, H);

        // Hills (only in side-scrolling levels)
        if (mapHeight <= H * 1.2) {
            this.drawHills(camX * 0.15, th.hillFar, 430, 70, 0.004);
            this.drawHills(camX * 0.35, th.hillNear, 500, 50, 0.007);
        }

        // Clouds drift slowly and wrap around
        ctx.fillStyle = th.cloud;
        for (let i = 0; i < 9; i++) {
            const span = W + 500;
            const cx = (((i * 337 - camX * 0.2 + this.time * (6 + i)) % span) + span) % span - 250;
            const band = H * 0.6;
            const cy = (((i * 131 + 40 - camY * 0.08) % band) + band) % band + 20;
            const s = 0.8 + (i % 3) * 0.3;
            this.cloud(cx, cy, s);
        }
    }

    cloud(x, y, s) {
        const ctx = this.ctx;
        // one filled ellipse at a time (several in one path leave connecting wedges)
        [[0, 0, 60, 22], [-34, 4, 34, 17], [38, 5, 36, 16], [6, -14, 30, 20]].forEach(([dx, dy, rx, ry]) => {
            ctx.beginPath();
            ctx.ellipse(x + dx * s, y + dy * s, rx * s, ry * s, 0, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    drawHills(offset, color, baseY, amp, freq) {
        const ctx = this.ctx;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, this.virtualHeight);
        for (let x = 0; x <= this.virtualWidth; x += 16) {
            const wx = x + offset;
            ctx.lineTo(x, baseY - Math.sin(wx * freq) * amp - Math.sin(wx * freq * 2.3 + 1) * amp * 0.35);
        }
        ctx.lineTo(this.virtualWidth, this.virtualHeight);
        ctx.closePath();
        ctx.fill();
    }

    // ------------------------------------------------------------- platforms
    drawPlatform(plat) {
        const ctx = this.ctx;
        const th = this.theme;
        const { x, y, width: w, height: h } = plat;
        const removable = plat.triggerIndex !== null && plat.triggerIndex !== undefined;
        ctx.save();

        if (!plat.active) {
            // A removed plank: a dashed outline where it was, filling in as it gets close to coming back
            const total = 7000; // keep in step with SWITCH_RESTORE_MS on the server
            const progress = plat.returnMs > 0 ? 1 - plat.returnMs / total : 0;
            const soon = plat.returnMs > 0 && plat.returnMs < 1500;
            if (progress > 0) {
                ctx.fillStyle = th.wood;
                ctx.globalAlpha = soon ? (Math.floor(this.time * 8) % 2 ? 0.7 : 0.25) : 0.12 + 0.3 * progress;
                ctx.beginPath();
                ctx.roundRect(x, y, w, h, 6);
                ctx.fill();
                ctx.globalAlpha = 1;
            }
            ctx.strokeStyle = soon ? 'rgba(190,131,72,0.9)' : 'rgba(43,33,64,0.3)';
            ctx.setLineDash([6, 6]);
            ctx.lineWidth = 2;
            ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
            ctx.restore();
            return;
        }

        if (removable) {
            // Wooden bridge planks
            ctx.fillStyle = th.wood;
            ctx.beginPath();
            ctx.roundRect(x, y, w, h, 6);
            ctx.fill();
            ctx.strokeStyle = th.woodDark;
            ctx.lineWidth = 2;
            for (let px = x + 28; px < x + w - 8; px += 28) {
                ctx.beginPath();
                ctx.moveTo(px, y + 2);
                ctx.lineTo(px, y + h - 2);
                ctx.stroke();
            }
            ctx.fillStyle = th.woodDark;
            ctx.fillRect(x + 4, y + h - 5, w - 8, 3);
        } else if (h >= 60) {
            // Ground block: soil with a grassy top
            ctx.fillStyle = th.ground;
            ctx.beginPath();
            ctx.roundRect(x, y, w, h, 10);
            ctx.fill();
            ctx.fillStyle = th.groundDark;
            for (let px = x + 20; px < x + w - 10; px += 56) {
                for (let py = y + 36; py < y + h - 10; py += 48) {
                    ctx.beginPath();
                    ctx.arc(px + ((py / 48) % 2 ? 18 : 0), py, 4, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            ctx.fillStyle = th.top;
            ctx.beginPath();
            ctx.roundRect(x, y, w, 16, [10, 10, 0, 0]);
            ctx.fill();
            ctx.fillStyle = th.topDark;
            for (let px = x + 10; px < x + w - 10; px += 22) {
                ctx.beginPath();
                ctx.moveTo(px, y + 16);
                ctx.lineTo(px + 8, y + 16);
                ctx.lineTo(px + 4, y + 24);
                ctx.closePath();
                ctx.fill();
            }
        } else {
            // Floating stone slab
            ctx.fillStyle = th.stone;
            ctx.beginPath();
            ctx.roundRect(x, y, w, h, 9);
            ctx.fill();
            ctx.fillStyle = th.stoneTop;
            ctx.beginPath();
            ctx.roundRect(x, y, w, Math.min(10, h), [9, 9, 0, 0]);
            ctx.fill();
        }
        ctx.restore();
    }

    drawSwitch(sw, active) {
        const ctx = this.ctx;
        ctx.save();
        ctx.fillStyle = '#8B7FA8';
        ctx.beginPath();
        ctx.roundRect(sw.x, sw.y + sw.height - 10, sw.width, 10, 4);
        ctx.fill();

        const kx = active ? sw.x + sw.width - 3 : sw.x + 3;
        const ky = sw.y + 10;
        ctx.strokeStyle = '#6F6490';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(sw.x + sw.width / 2, sw.y + sw.height - 10);
        ctx.lineTo(kx, ky);
        ctx.stroke();

        ctx.fillStyle = active ? '#4CC38A' : '#FF6B6B';
        ctx.beginPath();
        ctx.arc(kx, ky, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    drawKeyPrompt(x, y, key, label) {
        const ctx = this.ctx;
        ctx.save();
        const bob = Math.sin(this.time * 6) * 2;
        ctx.font = '600 13px Fredoka, "Noto Sans Thai", sans-serif';
        const text = label ? `${key}  ${label}` : key;
        const w = Math.max(26, ctx.measureText(text).width + 16);
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(x - w / 2, y - 13 + bob, w, 26, 9);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = INK;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x, y + bob + 1);
        ctx.restore();
    }

    // ---------------------------------------------------------------- hazards
    drawHazard(haz) {
        const ctx = this.ctx;
        const th = this.theme;
        ctx.save();

        if (haz.type === 'spikes' || haz.type === 'moving_spikes') {
            const moving = haz.type === 'moving_spikes';
            const spikeW = moving ? 20 : 24;
            const base = moving ? 6 : 10;
            const count = Math.max(1, Math.round(haz.width / spikeW));
            const sw = haz.width / count;

            ctx.fillStyle = th.spikeBase;
            ctx.beginPath();
            ctx.roundRect(haz.x, haz.y + haz.height - base, haz.width, base, 3);
            ctx.fill();

            ctx.fillStyle = th.spike;
            for (let i = 0; i < count; i++) {
                const sx = haz.x + i * sw;
                ctx.beginPath();
                ctx.moveTo(sx + 1, haz.y + haz.height - base + 1);
                ctx.lineTo(sx + sw / 2, haz.y);
                ctx.lineTo(sx + sw - 1, haz.y + haz.height - base + 1);
                ctx.closePath();
                ctx.fill();
            }
            if (moving) {
                // little angry eyes so patrol spikes read as "creatures"
                ctx.fillStyle = '#FFFFFF';
                const cx = haz.x + haz.width / 2;
                ctx.beginPath();
                ctx.arc(cx - 5, haz.y + haz.height * 0.55, 3, 0, Math.PI * 2);
                ctx.arc(cx + 5, haz.y + haz.height * 0.55, 3, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = INK;
                ctx.beginPath();
                ctx.arc(cx - 5, haz.y + haz.height * 0.58, 1.4, 0, Math.PI * 2);
                ctx.arc(cx + 5, haz.y + haz.height * 0.58, 1.4, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        ctx.restore();
    }

    // A respawn flag: tall and outlined so it's easy to spot. White until you reach it, then pink with a tick.
    drawCheckpoint(cp, reached) {
        const ctx = this.ctx;
        const top = cp.y - 92;
        const wave = Math.sin(this.time * 5 + cp.x) * (reached ? 4 : 1.5);
        ctx.save();
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        // base plate
        ctx.fillStyle = INK;
        ctx.beginPath();
        ctx.roundRect(cp.x - 12, cp.y - 5, 24, 6, 3);
        ctx.fill();

        // pole
        ctx.strokeStyle = INK;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(cp.x, cp.y - 3);
        ctx.lineTo(cp.x, top);
        ctx.stroke();
        ctx.fillStyle = '#FFD94A';
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cp.x, top - 3, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // pennant
        ctx.fillStyle = reached ? '#FF7EA8' : '#FFFFFF';
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(cp.x + 2, top + 2);
        ctx.lineTo(cp.x + 46, top + 16 + wave);
        ctx.lineTo(cp.x + 2, top + 34);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        if (reached) Icons.draw(ctx, 'check', cp.x + 16, top + 18 + wave * 0.4, 16);
        ctx.restore();
    }

    drawLava(lavaY, mapWidth, mapHeight) {
        const ctx = this.ctx;
        const th = this.theme;
        ctx.save();
        ctx.fillStyle = th.lava;
        ctx.beginPath();
        // extends well past the level edges so it fills the screen in narrow towers too
        const x0 = -1500, x1 = mapWidth + 1500;
        ctx.moveTo(x0, mapHeight + 600);
        ctx.lineTo(x0, lavaY);
        for (let x = x0; x <= x1; x += 20) {
            ctx.lineTo(x, lavaY + Math.sin(x * 0.04 + this.time * 3) * 6);
        }
        ctx.lineTo(x1, mapHeight + 600);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = th.lava2;
        for (let x = x0; x < x1; x += 90) {
            const bx = x + 30 + Math.sin(this.time + x) * 8;
            ctx.beginPath();
            ctx.ellipse(bx, lavaY + 26 + Math.sin(this.time * 2 + x) * 3, 18, 6, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    drawFinish(f) {
        const ctx = this.ctx;
        ctx.save();
        const poleW = 8;
        const bottom = f.y + f.height;

        // Poles
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        [f.x, f.x + f.width - poleW].forEach(px => {
            ctx.beginPath();
            ctx.roundRect(px, f.y - 10, poleW, f.height + 10, 3);
            ctx.fill();
            ctx.stroke();
        });

        // Checkered banner
        const bx = f.x + poleW, bw = f.width - poleW * 2, bh = 26;
        const cell = 9;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(bx - 2, f.y - 10, bw + 4, bh, 4);
        ctx.clip();
        for (let r = 0; r * cell < bh; r++) {
            for (let c = 0; c * cell < bw + 4; c++) {
                ctx.fillStyle = (r + c) % 2 ? '#FFFFFF' : INK;
                ctx.fillRect(bx - 2 + c * cell, f.y - 10 + r * cell, cell, cell);
            }
        }
        ctx.restore();

        // Soft finish mat
        ctx.fillStyle = 'rgba(255, 201, 60, 0.45)';
        ctx.fillRect(f.x + poleW, bottom - 8, bw, 8);

        // A little flag on top
        ctx.fillStyle = '#FF7EA8';
        ctx.beginPath();
        ctx.moveTo(f.x + f.width / 2, f.y - 40);
        ctx.lineTo(f.x + f.width / 2 + 26, f.y - 30 + Math.sin(this.time * 6) * 2);
        ctx.lineTo(f.x + f.width / 2, f.y - 20);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.beginPath();
        ctx.moveTo(f.x + f.width / 2, f.y - 40);
        ctx.lineTo(f.x + f.width / 2, f.y - 10);
        ctx.stroke();

        ctx.fillStyle = INK;
        ctx.font = '600 14px Fredoka, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('GOAL', f.x + f.width / 2, f.y + 40);
        ctx.restore();
    }

    // ----------------------------------------------------------- collectibles
    drawItem(it, localPlayer, showHint) {
        const ctx = this.ctx;
        const bob = Math.sin(this.time * 3 + it.id) * 4;
        ctx.save();
        ctx.translate(it.x, it.y + bob);

        if (it.type === 'star') {
            ctx.rotate(Math.sin(this.time * 2 + it.id) * 0.18);
            this.starPath(0, 0, 17, 8);
            ctx.fillStyle = '#FFD94A';
            ctx.fill();
            ctx.strokeStyle = '#E8A317';
            ctx.lineWidth = 3;
            ctx.lineJoin = 'round';
            ctx.stroke();
            // little face
            ctx.fillStyle = INK;
            ctx.beginPath();
            ctx.arc(-4, -1, 1.8, 0, Math.PI * 2);
            ctx.arc(4, -1, 1.8, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = INK;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(0, 3, 2.5, 0.2 * Math.PI, 0.8 * Math.PI);
            ctx.stroke();
        } else {
            // an apple-ish orb
            ctx.fillStyle = '#FF6B6B';
            ctx.beginPath();
            ctx.arc(0, 2, 14, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#FF9A9A';
            ctx.beginPath();
            ctx.ellipse(-5, -2, 4, 6, -0.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#4CC38A';
            ctx.beginPath();
            ctx.ellipse(4, -13, 7, 3.5, -0.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#8A5A3A';
            ctx.lineWidth = 2.5;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(0, -11);
            ctx.lineTo(1, -15);
            ctx.stroke();
        }
        ctx.restore();

        // Hint when you're close enough to inhale it
        if (showHint && localPlayer && !localPlayer.isDead && !localPlayer.isFinished && !localPlayer.mouth && !localPlayer.inhaling) {
            this.drawKeyPrompt(it.x, it.y - 34, this.keyLabels.inhale, 'ค้างเพื่ออม');
        }
    }

    starPath(cx, cy, outer, inner) {
        const ctx = this.ctx;
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
            const r = i % 2 === 0 ? outer : inner;
            const a = -Math.PI / 2 + i * Math.PI / 5;
            const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
    }

    drawProjectile(pr) {
        const ctx = this.ctx;
        ctx.save();
        ctx.translate(pr.x, pr.y);
        if (pr.type === 'fire') {
            const dir = pr.vx >= 0 ? 1 : -1;
            ctx.scale(dir, 1);
            const wob = Math.sin(this.time * 30) * 1.5;
            ctx.fillStyle = '#FF7A2B';
            ctx.beginPath();
            ctx.moveTo(-18, 0);
            ctx.quadraticCurveTo(-4, -12 + wob, 9, -3);
            ctx.arc(8, 0, 8, -Math.PI / 2, Math.PI / 2);
            ctx.quadraticCurveTo(-4, 12 - wob, -18, 0);
            ctx.fill();
            ctx.fillStyle = '#FFD84A';
            ctx.beginPath();
            ctx.arc(6, 0, 5, 0, Math.PI * 2);
            ctx.fill();
        } else {
            ctx.rotate(this.time * 14);
            this.starPath(0, 0, 14, 6.5);
            ctx.fillStyle = '#FFD94A';
            ctx.fill();
            ctx.strokeStyle = '#E8A317';
            ctx.lineWidth = 2.5;
            ctx.lineJoin = 'round';
            ctx.stroke();
        }
        ctx.restore();
    }

    // -------------------------------------------------------------- characters
    drawPlayer(player, isLocal, gameState) {
        const ctx = this.ctx;
        const cx = player.x + player.width / 2;
        const feetY = player.y + player.height;
        const t = this.time;

        // soft ground shadow
        if (!player.isDead) {
            ctx.fillStyle = 'rgba(43, 33, 64, 0.16)';
            ctx.beginPath();
            ctx.ellipse(cx, feetY - 1, 15, 4, 0, 0, Math.PI * 2);
            ctx.fill();
        }

        const frozen = player.pullDuration > 0 ? (player.freezeKind || 'pull') : null;
        const rolling = player.spinMs > 0 || player.spitBodyMs > 0;
        const tumbling = !rolling && !player.isGrounded && Math.abs(player.vx) > 380;

        // what is in the mouth, for the "full cheeks" look
        let mouthColor = null;
        if (player.mouth === 'player' && gameState) {
            const v = gameState.players.find(p => p.id === player.mouthId);
            mouthColor = v ? v.color : '#FFFFFF';
        } else if (player.mouth === 'orb') {
            mouthColor = '#FF6B6B';
        }

        // blink while invulnerable after respawning
        const blinking = player.invulnMs > 0 && Math.floor(t * 14) % 2 === 0;
        if (blinking) { ctx.save(); ctx.globalAlpha = 0.4; }

        this.drawCharacter({
            x: cx + (frozen === 'pull' ? (Math.random() - 0.5) * 3 : 0),
            y: feetY,
            color: player.color,
            facing: player.facing,
            vx: player.vx,
            vy: player.vy,
            grounded: player.isGrounded,
            t: t + (player.id.charCodeAt(1) || 0),
            mood: player.isDead ? 'dead' : (player.isFinished ? 'happy' : (frozen ? 'dizzy' : 'normal')),
            inhaling: player.inhaling,
            charge: player.charge || 0,
            mouthColor,
            pushing: player.pushDuration > 0,
            power: player.power,
            powerMs: player.powerMs,
            skin: { face: player.face, hat: player.hat, acc: player.acc, pat: player.pat },
            frozen,
            rot: rolling ? t * 20 * (player.facing || 1) : (tumbling ? t * 9 * Math.sign(player.vx) : 0),
            flapping: player.power === 'wings' && !player.isGrounded
        });

        if (blinking) ctx.restore();

        // Suction streaks in front of the mouth
        if (player.inhaling) this.drawInhale(player);

        this.drawNameTag(player, isLocal);

        if (frozen) {
            Icons.draw(ctx, frozen === 'ice' ? 'ice' : 'pull', cx, player.y - 40, 20);
        }

        // Emote bubble: pops in, floats up and fades over ~1.8s
        const emote = this.emotes[player.id];
        if (emote) {
            const age = (performance.now() - emote.start) / 1000;
            if (age > 1.8) {
                delete this.emotes[player.id];
            } else {
                const pop = Math.min(1, age / 0.15);
                ctx.save();
                ctx.globalAlpha = Math.min(1, (1.8 - age) / 0.4);
                Icons.draw(ctx, emote.emoji, cx, player.y - 62 - age * 14, Math.round(34 * (0.6 + 0.4 * pop)));
                ctx.restore();
            }
        }
    }

    drawNameTag(player, isLocal) {
        const ctx = this.ctx;
        const cx = player.x + player.width / 2;
        const y = player.y - 16;
        ctx.save();
        ctx.font = '600 12px Fredoka, "Noto Sans Thai", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const w = ctx.measureText(player.name).width + 14;

        ctx.fillStyle = isLocal ? '#FFE066' : 'rgba(255,255,255,0.92)';
        ctx.beginPath();
        ctx.roundRect(cx - w / 2, y - 9, w, 18, 9);
        ctx.fill();
        ctx.fillStyle = INK;
        ctx.fillText(player.name, cx, y + 0.5);

        if (isLocal && !player.isDead) {
            const bounce = Math.sin(this.time * 7) * 2;
            ctx.fillStyle = '#FFE066';
            ctx.strokeStyle = INK;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cx - 6, y - 17 + bounce);
            ctx.lineTo(cx + 6, y - 17 + bounce);
            ctx.lineTo(cx, y - 10 + bounce);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }
        ctx.restore();
    }

    // White suction streaks flowing into the mouth
    drawInhale(player) {
        const ctx = this.ctx;
        const f = player.facing;
        const mx = player.x + player.width / 2 + f * (player.width / 2 + 6);
        const my = player.y + player.height * 0.5;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        for (let i = 0; i < 7; i++) {
            const k = ((this.time * 1.8 + i / 7) % 1);
            const dist = 150 * (1 - k);
            const spread = (i % 3 - 1) * 34 * (1 - k * 0.7) + Math.sin(i * 7) * 6;
            const px = mx + f * dist;
            const py = my + spread;
            ctx.globalAlpha = 0.25 + 0.6 * k;
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(px - f * 16 * (1 - k * 0.4), py - spread * 0.18);
            ctx.stroke();
        }
        ctx.restore();
    }

    // Draws one round character with its feet at (o.x, o.y).
    // o: { x, y, color, facing, vx, vy, grounded, t, mood, inhaling, mouthColor, pushing,
    //      power, powerMs, frozen, rot, flapping, scale }
    drawCharacter(o) {
        const ctx = this.ctx;
        const f = o.facing || 1;
        const moving = o.grounded && Math.abs(o.vx) > 30;
        const outline = shade(o.color, -0.28);
        const footColor = shade(o.color, -0.38);
        const R = 19;

        // squash & stretch
        let sx = 1, sy = 1;
        if (!o.grounded) {
            const k = Math.min(0.24, Math.abs(o.vy) / 2400);
            sy = 1 + k;
            sx = 1 - k * 0.7;
        } else if (moving) {
            const b = Math.sin(o.t * 22);
            sy = 1 + b * 0.05;
            sx = 1 - b * 0.04;
        } else {
            sy = 1 + Math.sin(o.t * 3) * 0.03;
            sx = 1 - Math.sin(o.t * 3) * 0.02;
        }
        if (o.mouthColor) { sx *= 1.14 + 0.12 * (o.charge || 0); sy *= 1.06 + 0.08 * (o.charge || 0); }
        if (o.mood === 'dead') { sy *= 0.78; sx *= 1.1; }

        const hop = moving ? -Math.abs(Math.sin(o.t * 11)) * 3.5 : 0;
        const tilt = o.rot || Math.max(-1, Math.min(1, o.vx / 250)) * 0.14;

        ctx.save();
        ctx.translate(o.x, o.y);
        if (o.scale) ctx.scale(o.scale, o.scale);

        // --- feet (under the body) ---
        const step = moving ? Math.sin(o.t * 22) : 0;
        ctx.fillStyle = footColor;
        [-1, 1].forEach(side => {
            const lift = moving ? Math.max(0, side * step) * 4 : 0;
            ctx.beginPath();
            ctx.ellipse(side * 8.5 + f * 2, -3 - lift + hop * 0.5, 8, 4.8, 0, 0, Math.PI * 2);
            ctx.fill();
        });

        // --- body ---
        ctx.translate(0, -R - 2 + hop);
        ctx.rotate(tilt);
        ctx.scale(sx, sy);

        const skin = o.skin || {};

        // things that sit behind the body
        if (skin.acc === 'cape') this.drawCape(o, R, f);
        if (skin.acc === 'backpack') this.drawBackpack(R, f);
        if (o.power === 'wings') this.drawWings(o, R);

        // arms
        ctx.fillStyle = o.color;
        ctx.strokeStyle = outline;
        ctx.lineWidth = 2.5;
        if (o.pushing) {
            [-3, 5].forEach(dy => {
                ctx.beginPath();
                ctx.ellipse(f * (R + 5), dy, 6, 5, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            });
        } else if (o.inhaling) {
            [-1, 1].forEach(side => {
                ctx.beginPath();
                ctx.ellipse(side * (R - 2), -R * 0.45, 5, 6.5, side * 0.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            });
        } else {
            const sw = moving ? Math.sin(o.t * 22) * 4 : Math.sin(o.t * 3) * 1.2;
            [-1, 1].forEach(side => {
                ctx.beginPath();
                ctx.ellipse(side * (R + 1), 3 + side * sw * 0.5, 5, 6, side * 0.35, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            });
        }

        // main blob
        ctx.beginPath();
        ctx.ellipse(0, 0, R, R - 1, 0, 0, Math.PI * 2);
        ctx.fillStyle = o.color;
        ctx.fill();
        ctx.stroke();

        // soft highlight
        ctx.fillStyle = shade(o.color, 0.45);
        ctx.beginPath();
        ctx.ellipse(-7, -9, 6, 3.5, -0.6, 0, Math.PI * 2);
        ctx.fill();

        this.drawPattern(skin.pat, o.color, R);
        if (skin.acc === 'overalls') this.drawOveralls(R);
        if (skin.acc === 'apron') this.drawApron(R);

        // something in the cheeks
        if (o.mouthColor) {
            ctx.fillStyle = o.mouthColor;
            ctx.strokeStyle = outline;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(f * 4, 7, 7.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = INK;
            ctx.beginPath();
            ctx.arc(f * 4 - 2.5, 5.5, 1.3, 0, Math.PI * 2);
            ctx.arc(f * 4 + 2.5, 5.5, 1.3, 0, Math.PI * 2);
            ctx.fill();
        }

        this.drawFace(o, f);
        this.drawAccessory(o, R, f);

        // ice coating
        if (o.frozen === 'ice') {
            ctx.fillStyle = 'rgba(170, 230, 255, 0.62)';
            ctx.beginPath();
            ctx.ellipse(0, 0, R + 3, R + 2, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.beginPath();
            ctx.ellipse(-8, -9, 5, 3, -0.6, 0, Math.PI * 2);
            ctx.fill();
        }

        // a power's hat (fire/ice/spin) replaces the cosmetic one while it lasts
        if (o.power && o.power !== 'wings') this.drawPowerHat(o, R);
        else this.drawHat(o, R, f);

        ctx.restore();

        // dizzy stars orbiting
        if (o.mood === 'dizzy' && o.frozen !== 'ice') {
            ctx.save();
            ctx.translate(o.x, o.y - R * 2 - 4);
            ctx.fillStyle = '#FFD94A';
            for (let i = 0; i < 3; i++) {
                const a = o.t * 5 + i * (Math.PI * 2 / 3);
                this.starPath(Math.cos(a) * 18, Math.sin(a) * 5, 5, 2.4);
                ctx.fill();
            }
            ctx.restore();
        }

        // sparkles when finished
        if (o.mood === 'happy') {
            ctx.save();
            ctx.fillStyle = '#FFD94A';
            for (let i = 0; i < 3; i++) {
                const a = o.t * 3 + i * 2.1;
                this.starPath(o.x + Math.cos(a) * 24, o.y - 22 + Math.sin(a * 1.3) * 18, 4, 1.8);
                ctx.fill();
            }
            ctx.restore();
        }
    }

    // ------------------------------------------------------------- faces
    drawFace(o, f) {
        const ctx = this.ctx;
        const face = (o.skin && o.skin.face) || 'classic';
        const ex = [-6.5, 6.5];
        const ey = -3;
        const fx = f * 3; // face looks toward travel direction

        if (face === 'abe' && ABE_FACE.ready) {
            this.drawPastedFace(o, f, fx);
            return;
        }

        if (o.mood === 'dead') {
            ctx.strokeStyle = INK;
            ctx.lineWidth = 2.2;
            ctx.lineCap = 'round';
            ex.forEach(x => {
                ctx.beginPath();
                ctx.moveTo(fx + x - 3, ey - 3); ctx.lineTo(fx + x + 3, ey + 3);
                ctx.moveTo(fx + x + 3, ey - 3); ctx.lineTo(fx + x - 3, ey + 3);
                ctx.stroke();
            });
            ctx.beginPath();
            ctx.moveTo(fx - 4, 7); ctx.lineTo(fx + 4, 7);
            ctx.stroke();
            return;
        }

        if (o.mood === 'happy') {
            ctx.strokeStyle = INK;
            ctx.lineWidth = 2.4;
            ctx.lineCap = 'round';
            ex.forEach(x => {
                ctx.beginPath();
                ctx.arc(fx + x, ey + 2, 3.8, Math.PI * 1.05, Math.PI * 1.95);
                ctx.stroke();
            });
        } else if (o.mood === 'dizzy') {
            ctx.strokeStyle = INK;
            ctx.lineWidth = 1.8;
            ex.forEach(x => {
                ctx.beginPath();
                for (let a = 0; a < Math.PI * 4; a += 0.4) {
                    const r = a * 0.38;
                    const px = fx + x + Math.cos(a + o.t * 8) * r, py = ey + Math.sin(a + o.t * 8) * r;
                    if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
                }
                ctx.stroke();
            });
        } else {
            this.drawEyes(face, fx, ey, ex, f, o);
        }

        // blush (the stubbly face doesn't blush)
        if (face !== 'abe') {
            ctx.fillStyle = 'rgba(255, 92, 138, 0.5)';
            [-1, 1].forEach(side => {
                ctx.beginPath();
                ctx.ellipse(fx + side * 12.5, 4.5, 4, 2.4, 0, 0, Math.PI * 2);
                ctx.fill();
            });
        }

        // mouth
        if (o.inhaling) {
            ctx.fillStyle = '#7A2E48';
            ctx.beginPath();
            ctx.ellipse(fx + f * 3, 6, 6.5, 7.5, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#FF8FA8';
            ctx.beginPath();
            ctx.ellipse(fx + f * 3, 9, 4, 3, 0, 0, Math.PI * 2);
            ctx.fill();
        } else if (o.mood === 'happy') {
            ctx.fillStyle = '#7A2E48';
            ctx.beginPath();
            ctx.arc(fx, 5.5, 4, 0, Math.PI);
            ctx.fill();
        } else if (!o.mouthColor) {
            this.drawMouth(face, fx);
        }

        this.drawFaceExtras(face, fx, ey);
    }

    // A flat photo-style sticker over the face, clipped to an oval. Only the things that must stay
    // readable are drawn on top of it: an open mouth while inhaling, and X eyes when dead.
    drawPastedFace(o, f, fx) {
        const ctx = this.ctx;
        const cx = fx * 0.6, cy = -2, rx = 14.6, ry = 13.8; // a bit above centre so overalls / scarf still show below

        ctx.save();
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(ABE_FACE.img, cx - rx, cy - ry, rx * 2, ry * 2);
        ctx.restore();

        ctx.strokeStyle = 'rgba(43, 33, 64, 0.45)';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        ctx.stroke();

        if (o.mood === 'dead') {
            ctx.strokeStyle = '#E74C3C';
            ctx.lineWidth = 2.4;
            ctx.lineCap = 'round';
            [-6.5, 6.5].forEach(x => {
                ctx.beginPath();
                ctx.moveTo(fx + x - 3, -6); ctx.lineTo(fx + x + 3, 0);
                ctx.moveTo(fx + x + 3, -6); ctx.lineTo(fx + x - 3, 0);
                ctx.stroke();
            });
        } else if (o.inhaling) {
            ctx.fillStyle = '#7A2E48';
            ctx.beginPath();
            ctx.ellipse(fx + f * 3, 6, 6, 6.8, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#FF8FA8';
            ctx.beginPath();
            ctx.ellipse(fx + f * 3, 9, 3.6, 2.6, 0, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    drawEyes(face, fx, ey, ex, f, o) {
        const ctx = this.ctx;
        const oval = (x, rx, ry) => {
            ctx.fillStyle = INK;
            ctx.beginPath();
            ctx.ellipse(fx + x, ey, rx, ry, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath();
            ctx.arc(fx + x - 0.6, ey - ry * 0.45, Math.min(1.5, rx * 0.5), 0, Math.PI * 2);
            ctx.fill();
        };
        ctx.lineCap = 'round';

        switch (face) {
            case 'happy':
                ctx.strokeStyle = INK;
                ctx.lineWidth = 2.4;
                ex.forEach(x => { ctx.beginPath(); ctx.arc(fx + x, ey + 2, 3.8, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke(); });
                break;
            case 'sleepy':
                ex.forEach(x => {
                    ctx.fillStyle = INK;
                    ctx.beginPath();
                    ctx.arc(fx + x, ey + 1, 3.3, 0, Math.PI);
                    ctx.fill();
                    ctx.strokeStyle = INK;
                    ctx.lineWidth = 1.6;
                    ctx.beginPath();
                    ctx.moveTo(fx + x - 3.8, ey + 1);
                    ctx.lineTo(fx + x + 3.8, ey + 1);
                    ctx.stroke();
                });
                break;
            case 'cat':
                ex.forEach(x => oval(x, 2.4, 3.4));
                break;
            case 'derp': {
                // one big eye, one small, looking different ways
                ctx.fillStyle = '#FFFFFF';
                ctx.strokeStyle = INK;
                ctx.lineWidth = 1.6;
                [[ex[0], 4.8], [ex[1], 3.3]].forEach(([x, r]) => {
                    ctx.beginPath(); ctx.arc(fx + x, ey, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                });
                ctx.fillStyle = INK;
                ctx.beginPath(); ctx.arc(fx + ex[0] + 1.6, ey - 1.6, 1.9, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.arc(fx + ex[1] - 1, ey + 1.2, 1.4, 0, Math.PI * 2); ctx.fill();
                break;
            }
            case 'wow':
                ex.forEach(x => {
                    ctx.fillStyle = '#FFFFFF';
                    ctx.strokeStyle = INK;
                    ctx.lineWidth = 1.8;
                    ctx.beginPath(); ctx.arc(fx + x, ey, 4.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                    ctx.fillStyle = INK;
                    ctx.beginPath(); ctx.arc(fx + x, ey, 1.8, 0, Math.PI * 2); ctx.fill();
                });
                break;
            case 'abe':
                // eyes gently closed: a heavy lid line with little lash flicks and a soft shadow under
                ex.forEach(x => {
                    const side = Math.sign(x);
                    ctx.strokeStyle = INK;
                    ctx.lineWidth = 2.6;
                    ctx.beginPath();
                    ctx.arc(fx + x, ey - 1.2, 4.5, 0.1 * Math.PI, 0.9 * Math.PI);
                    ctx.stroke();
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(fx + x + side * 4.3, ey + 1.2);
                    ctx.lineTo(fx + x + side * 6.6, ey + 2.4);
                    ctx.stroke();
                    ctx.globalAlpha = 0.28;
                    ctx.lineWidth = 1.4;
                    ctx.beginPath();
                    ctx.arc(fx + x, ey - 0.4, 5.6, 0.2 * Math.PI, 0.8 * Math.PI);
                    ctx.stroke();
                    ctx.globalAlpha = 1;
                });
                break;
            case 'wink':
                oval(ex[0], 3.2, 5);
                ctx.strokeStyle = INK;
                ctx.lineWidth = 2.4;
                ctx.beginPath(); ctx.arc(fx + ex[1], ey + 1.5, 3.8, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
                break;
            case 'uwu':
                ex.forEach(x => {
                    oval(x, 3.9, 5.8);
                    ctx.fillStyle = '#FFFFFF';
                    ctx.beginPath(); ctx.arc(fx + x + 1.3, ey + 2.2, 1.1, 0, Math.PI * 2); ctx.fill();
                });
                break;
            case 'bored':
                ex.forEach(x => {
                    ctx.fillStyle = '#FFFFFF';
                    ctx.strokeStyle = INK;
                    ctx.lineWidth = 1.3;
                    ctx.beginPath(); ctx.ellipse(fx + x, ey + 1, 4, 3, 0, 0, Math.PI); ctx.fill(); ctx.stroke();
                    ctx.fillStyle = INK;
                    ctx.beginPath(); ctx.arc(fx + x + f * 1.5, ey + 1.7, 1.6, 0, Math.PI * 2); ctx.fill();
                    ctx.lineWidth = 2.4;
                    ctx.beginPath(); ctx.moveTo(fx + x - 4.8, ey + 1); ctx.lineTo(fx + x + 4.8, ey + 1); ctx.stroke();
                });
                break;
            case 'cry':
                ctx.strokeStyle = INK;
                ctx.lineWidth = 2.2;
                ctx.beginPath();
                ctx.moveTo(fx + ex[0] - 3.2, ey - 3.4); ctx.lineTo(fx + ex[0] + 2.4, ey); ctx.lineTo(fx + ex[0] - 3.2, ey + 3.4);
                ctx.moveTo(fx + ex[1] + 3.2, ey - 3.4); ctx.lineTo(fx + ex[1] - 2.4, ey); ctx.lineTo(fx + ex[1] + 3.2, ey + 3.4);
                ctx.stroke();
                break;
            case 'smirk':
                ex.forEach(x => oval(x, 3.1, 4.6));
                break;
            case 'angry':
                ex.forEach(x => oval(x, 3.2, 4.2));
                break;
            default: // classic: tall oval eyes with a shine, like a certain pink puffball
                ex.forEach(x => oval(x, 3.3, 5.4));
        }
    }

    drawMouth(face, fx) {
        const ctx = this.ctx;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#7A2E48';
        ctx.lineWidth = 1.9;

        switch (face) {
            case 'happy':
                ctx.fillStyle = '#7A2E48';
                ctx.beginPath(); ctx.arc(fx, 4.8, 4.2, 0, Math.PI); ctx.fill();
                ctx.fillStyle = '#FF8FA8';
                ctx.beginPath(); ctx.ellipse(fx, 7.8, 2.2, 1.3, 0, 0, Math.PI * 2); ctx.fill();
                break;
            case 'sleepy':
                ctx.fillStyle = '#7A2E48';
                ctx.beginPath(); ctx.ellipse(fx, 6.5, 1.7, 2.2, 0, 0, Math.PI * 2); ctx.fill();
                break;
            case 'wink':
                ctx.fillStyle = '#7A2E48';
                ctx.beginPath(); ctx.arc(fx, 5, 3.8, 0, Math.PI); ctx.fill();
                ctx.fillStyle = '#FF8FA8';
                ctx.beginPath(); ctx.ellipse(fx, 7.6, 2, 1.1, 0, 0, Math.PI * 2); ctx.fill();
                break;
            case 'uwu':
                ctx.beginPath();
                ctx.arc(fx - 1.9, 5, 1.9, 0.05 * Math.PI, 0.95 * Math.PI);
                ctx.arc(fx + 1.9, 5, 1.9, 0.05 * Math.PI, 0.95 * Math.PI);
                ctx.stroke();
                break;
            case 'bored':
                ctx.beginPath(); ctx.moveTo(fx - 3.6, 7); ctx.lineTo(fx + 3.6, 7); ctx.stroke();
                break;
            case 'cry':
                ctx.fillStyle = '#7A2E48';
                ctx.beginPath(); ctx.ellipse(fx, 8, 3.6, 2.8, 0, 0, Math.PI * 2); ctx.fill();
                break;
            case 'smirk':
                ctx.beginPath();
                ctx.moveTo(fx - 3.5, 5.5);
                ctx.quadraticCurveTo(fx + 1, 7.5, fx + 6, 3.2);
                ctx.stroke();
                break;
            case 'angry':
                ctx.beginPath(); ctx.arc(fx, 9, 3.4, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
                break;
            case 'cat':
                ctx.beginPath();
                ctx.arc(fx - 2.3, 4.6, 2.3, 0.05 * Math.PI, 0.95 * Math.PI);
                ctx.arc(fx + 2.3, 4.6, 2.3, 0.05 * Math.PI, 0.95 * Math.PI);
                ctx.stroke();
                break;
            case 'derp':
                ctx.beginPath(); ctx.arc(fx, 4.5, 3, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
                ctx.fillStyle = '#FF8FA8';
                ctx.beginPath(); ctx.ellipse(fx + 1.8, 8.8, 2.2, 3.2, 0, 0, Math.PI * 2); ctx.fill();
                ctx.stroke();
                break;
            case 'wow':
                ctx.fillStyle = '#7A2E48';
                ctx.beginPath(); ctx.ellipse(fx, 7.2, 2.8, 3.8, 0, 0, Math.PI * 2); ctx.fill();
                break;
            case 'abe': {
                // full, closed lips: lighter upper lip, a little fuller lower lip
                ctx.lineWidth = 1.5;
                ctx.lineJoin = 'round';
                ctx.fillStyle = '#F6C6C8';
                ctx.beginPath();
                ctx.moveTo(fx - 7.5, 10);
                ctx.quadraticCurveTo(fx - 3.6, 7.4, fx, 8.7);
                ctx.quadraticCurveTo(fx + 3.6, 7.4, fx + 7.5, 10);
                ctx.quadraticCurveTo(fx, 10.9, fx - 7.5, 10);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = '#EBA0A8';
                ctx.beginPath();
                ctx.moveTo(fx - 7.5, 10);
                ctx.quadraticCurveTo(fx, 10.9, fx + 7.5, 10);
                ctx.quadraticCurveTo(fx + 4.6, 14.6, fx, 14.6);
                ctx.quadraticCurveTo(fx - 4.6, 14.6, fx - 7.5, 10);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                // a little shine on the lower lip
                ctx.strokeStyle = 'rgba(255,255,255,0.75)';
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.moveTo(fx - 2.2, 12.6);
                ctx.lineTo(fx + 0.8, 12.6);
                ctx.stroke();
                break;
            }
            default:
                ctx.beginPath(); ctx.arc(fx, 4.5, 3, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
        }
    }

    // eyebrows, whiskers, stubble: things drawn over the base face
    drawFaceExtras(face, fx, ey) {
        const ctx = this.ctx;
        ctx.lineCap = 'round';
        ctx.strokeStyle = INK;

        if (face === 'angry') {
            ctx.lineWidth = 2.6;
            [-1, 1].forEach(side => {
                ctx.beginPath();
                ctx.moveTo(fx + side * 10.5, ey - 8.5);
                ctx.lineTo(fx + side * 3, ey - 4.8);
                ctx.stroke();
            });
        } else if (face === 'smirk') {
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(fx - 9.5, ey - 6.8); ctx.lineTo(fx - 3.5, ey - 7.2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(fx + 3.5, ey - 8); ctx.quadraticCurveTo(fx + 7, ey - 11.5, fx + 10, ey - 8.5); ctx.stroke();
        } else if (face === 'cat') {
            ctx.lineWidth = 1;
            ctx.globalAlpha = 0.55;
            [-1, 1].forEach(side => {
                [-1.6, 0, 1.6].forEach(dy => {
                    ctx.beginPath();
                    ctx.moveTo(fx + side * 11, 4 + dy);
                    ctx.lineTo(fx + side * 17.5, 3 + dy * 2.2);
                    ctx.stroke();
                });
            });
            ctx.globalAlpha = 1;
        } else if (face === 'cry') {
            // streams of tears
            ctx.fillStyle = '#7CC8FF';
            [-1, 1].forEach(side => {
                const tx = fx + side * 9.5;
                ctx.beginPath();
                ctx.moveTo(tx - 1.8, ey + 3);
                ctx.quadraticCurveTo(tx - 2.6, ey + 11, tx, ey + 13);
                ctx.quadraticCurveTo(tx + 2.6, ey + 11, tx + 1.8, ey + 3);
                ctx.closePath();
                ctx.fill();
            });
        } else if (face === 'bored') {
            // tired eye bags
            ctx.lineWidth = 1.2;
            ctx.globalAlpha = 0.4;
            [-6.5, 6.5].forEach(x => { ctx.beginPath(); ctx.arc(fx + x, ey + 5.8, 4.2, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); });
            ctx.globalAlpha = 1;
        } else if (face === 'abe') {
            // thick, bushy brows slanting up towards the middle
            ctx.lineWidth = 4.4;
            [-1, 1].forEach(side => {
                ctx.beginPath();
                ctx.moveTo(fx + side * 12.5, ey - 3.2);
                ctx.quadraticCurveTo(fx + side * 7.5, ey - 8.2, fx + side * 2, ey - 9.2);
                ctx.stroke();
                // wiry hairs along the top
                ctx.lineWidth = 1.3;
                [[10, -6.2, 11, -8.2], [7.2, -7.8, 7.6, -10.2], [4.4, -8.8, 4.2, -11.2]].forEach(([x1, y1, x2, y2]) => {
                    ctx.beginPath();
                    ctx.moveTo(fx + side * x1, ey + y1 + 0.4);
                    ctx.lineTo(fx + side * x2, ey + y2 + 0.4);
                    ctx.stroke();
                });
                ctx.lineWidth = 4.4;
            });
            // a long nose: shaded bridge, rounded tip, dark nostrils
            ctx.lineWidth = 1.3;
            ctx.globalAlpha = 0.45;
            ctx.beginPath();
            ctx.moveTo(fx - 1.6, ey - 4);
            ctx.quadraticCurveTo(fx - 2.4, ey + 2, fx - 3.4, ey + 6.6);
            ctx.stroke();
            ctx.globalAlpha = 0.8;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.arc(fx, ey + 5.6, 4.4, 0.12 * Math.PI, 0.88 * Math.PI);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.fillStyle = INK;
            [-1, 1].forEach(side => {
                ctx.beginPath();
                ctx.ellipse(fx + side * 2.3, ey + 7.4, 1.5, 1, side * 0.3, 0, Math.PI * 2);
                ctx.fill();
            });
        }
    }

    // ------------------------------------------------------------- hats
    drawHat(o, R, f) {
        const hat = o.skin && o.skin.hat;
        if (!hat || hat === 'none') return;
        const ctx = this.ctx;
        const line = shade(o.color, -0.28);
        ctx.save();
        ctx.translate(0, -R + 3); // origin = top of the head
        ctx.lineWidth = 1.8;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        switch (hat) {
            case 'crown':
                ctx.fillStyle = '#FFD94A'; ctx.strokeStyle = '#E8A317';
                ctx.beginPath();
                ctx.moveTo(-10, 3); ctx.lineTo(-11, -8); ctx.lineTo(-5, -3); ctx.lineTo(0, -12);
                ctx.lineTo(5, -3); ctx.lineTo(11, -8); ctx.lineTo(10, 3);
                ctx.closePath(); ctx.fill(); ctx.stroke();
                ctx.fillStyle = '#FF6B6B';
                ctx.beginPath(); ctx.arc(0, -1, 2, 0, Math.PI * 2); ctx.fill();
                break;
            case 'cap':
                ctx.fillStyle = '#FF6B6B'; ctx.strokeStyle = '#C94B4B';
                ctx.beginPath(); ctx.arc(0, 3, 11.5, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
                ctx.fillStyle = '#E04F4F';
                ctx.beginPath(); ctx.ellipse(f * 9, 3, 8.5, 2.6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                ctx.fillStyle = '#FFFFFF';
                ctx.beginPath(); ctx.arc(0, -8.2, 1.6, 0, Math.PI * 2); ctx.fill();
                break;
            case 'beanie':
                ctx.fillStyle = '#5B8DEF'; ctx.strokeStyle = '#3F6FD1';
                ctx.beginPath(); ctx.arc(0, 4, 12.5, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
                ctx.fillStyle = '#3F6FD1';
                ctx.beginPath(); ctx.roundRect(-12.5, 2, 25, 5, 2); ctx.fill();
                ctx.fillStyle = '#FFFFFF';
                ctx.beginPath(); ctx.arc(0, -10, 4, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#C8D4EA'; ctx.stroke();
                break;
            case 'party':
                ctx.fillStyle = '#FF7EA8'; ctx.strokeStyle = '#E25C8A';
                ctx.beginPath(); ctx.moveTo(-9, 3); ctx.lineTo(0, -20); ctx.lineTo(9, 3); ctx.closePath(); ctx.fill(); ctx.stroke();
                ctx.fillStyle = '#FFD94A';
                [[-3, -2], [3, -6], [-1, -10]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill(); });
                ctx.beginPath(); ctx.arc(0, -20, 2.8, 0, Math.PI * 2); ctx.fill();
                break;
            case 'catears':
                [-1, 1].forEach(side => {
                    ctx.fillStyle = o.color; ctx.strokeStyle = line;
                    ctx.beginPath(); ctx.moveTo(side * 13, 4); ctx.lineTo(side * 11, -10); ctx.lineTo(side * 3, 1); ctx.closePath(); ctx.fill(); ctx.stroke();
                    ctx.fillStyle = '#FF9BB8';
                    ctx.beginPath(); ctx.moveTo(side * 10.5, 0); ctx.lineTo(side * 10, -6); ctx.lineTo(side * 6, 0); ctx.closePath(); ctx.fill();
                });
                break;
            case 'bunny':
                [-1, 1].forEach(side => {
                    ctx.save();
                    ctx.translate(side * 6, -9);
                    ctx.rotate(side * 0.18);
                    ctx.fillStyle = o.color; ctx.strokeStyle = line;
                    ctx.beginPath(); ctx.ellipse(0, 0, 3.8, 11, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                    ctx.fillStyle = '#FF9BB8';
                    ctx.beginPath(); ctx.ellipse(0, 1, 1.8, 7.5, 0, 0, Math.PI * 2); ctx.fill();
                    ctx.restore();
                });
                break;
            case 'chef':
                ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = '#C8D4EA';
                [[-6.5, -5, 6], [0, -10, 7], [6.5, -5, 6]].forEach(([x, y, r]) => {
                    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                });
                ctx.beginPath(); ctx.roundRect(-10, -3, 20, 8, 2); ctx.fill(); ctx.stroke();
                break;
            case 'halo': {
                const y = -12 + Math.sin(o.t * 3) * 1.6;
                ctx.strokeStyle = '#FFD94A'; ctx.lineWidth = 3.2;
                ctx.beginPath(); ctx.ellipse(0, y, 10, 3.2, 0, 0, Math.PI * 2); ctx.stroke();
                break;
            }
            case 'flower': {
                ctx.save();
                ctx.translate(9, -1);
                ctx.fillStyle = '#FF9BB8';
                for (let i = 0; i < 5; i++) {
                    const a = i * Math.PI * 2 / 5;
                    ctx.beginPath(); ctx.arc(Math.cos(a) * 4.2, Math.sin(a) * 4.2, 3.2, 0, Math.PI * 2); ctx.fill();
                }
                ctx.fillStyle = '#FFD94A';
                ctx.beginPath(); ctx.arc(0, 0, 2.6, 0, Math.PI * 2); ctx.fill();
                ctx.restore();
                break;
            }
            case 'tophat':
                ctx.fillStyle = '#2B2140'; ctx.strokeStyle = '#2B2140';
                ctx.beginPath(); ctx.ellipse(0, 3, 13.5, 3.4, 0, 0, Math.PI * 2); ctx.fill();
                ctx.beginPath(); ctx.roundRect(-8.5, -15, 17, 18, 2); ctx.fill();
                ctx.fillStyle = '#FF6B6B';
                ctx.fillRect(-8.5, -3.5, 17, 3.6);
                break;
            case 'headband':
                ctx.strokeStyle = '#FF6B6B'; ctx.lineWidth = 4.2;
                ctx.beginPath(); ctx.moveTo(-16.5, 9); ctx.quadraticCurveTo(0, 2.5, 16.5, 9); ctx.stroke();
                ctx.fillStyle = '#FF6B6B';
                ctx.beginPath(); ctx.moveTo(15, 8); ctx.lineTo(21, 4); ctx.lineTo(20, 12); ctx.closePath(); ctx.fill();
                ctx.beginPath(); ctx.moveTo(15, 8); ctx.lineTo(22, 10); ctx.lineTo(17, 15); ctx.closePath(); ctx.fill();
                break;
            case 'pirate':
                ctx.fillStyle = INK; ctx.strokeStyle = '#4A3F66';
                ctx.beginPath();
                ctx.moveTo(-17, 5); ctx.quadraticCurveTo(-15, -9, -5, -9); ctx.lineTo(5, -9);
                ctx.quadraticCurveTo(15, -9, 17, 5); ctx.quadraticCurveTo(0, 10, -17, 5);
                ctx.closePath(); ctx.fill(); ctx.stroke();
                ctx.fillStyle = '#FFFFFF';
                ctx.beginPath(); ctx.arc(0, -2.5, 3, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = INK;
                ctx.beginPath(); ctx.arc(-1.2, -3, 0.8, 0, Math.PI * 2); ctx.arc(1.2, -3, 0.8, 0, Math.PI * 2); ctx.fill();
                break;
            case 'wizard':
                ctx.fillStyle = '#6B4FC4'; ctx.strokeStyle = '#4F37A0';
                ctx.beginPath();
                ctx.moveTo(-11, 4); ctx.quadraticCurveTo(-4, -12, 5, -29); ctx.quadraticCurveTo(7, -12, 11, 4);
                ctx.closePath(); ctx.fill(); ctx.stroke();
                ctx.fillStyle = '#5A3FAE';
                ctx.beginPath(); ctx.ellipse(0, 4, 17, 4.2, 0, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#FFD94A';
                ctx.fillRect(-10.5, -1.5, 21, 3.4);
                this.starPath(-1, -11, 3.4, 1.5); ctx.fill();
                this.starPath(3, -19, 2.6, 1.1); ctx.fill();
                break;
            case 'cowboy':
                ctx.fillStyle = '#A9703A'; ctx.strokeStyle = '#7C4E20';
                ctx.beginPath(); ctx.ellipse(0, 4, 20, 4.8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                ctx.fillStyle = '#C98B4B';
                ctx.beginPath(); ctx.roundRect(-9.5, -10, 19, 15, [6, 6, 0, 0]); ctx.fill(); ctx.stroke();
                ctx.fillStyle = '#6B3E1E';
                ctx.fillRect(-9.5, -1, 19, 3.6);
                break;
            case 'sprout':
                ctx.strokeStyle = '#3F9E60'; ctx.lineWidth = 2.6;
                ctx.beginPath(); ctx.moveTo(0, 4); ctx.quadraticCurveTo(1, -4, 0, -9); ctx.stroke();
                ctx.fillStyle = '#6FD98C'; ctx.lineWidth = 1.5;
                [[-5.5, -10, -0.6], [5.5, -12, 0.6]].forEach(([x, y, r]) => {
                    ctx.beginPath(); ctx.ellipse(x, y, 6, 3, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                });
                break;
            case 'helmet':
                ctx.fillStyle = '#FFD94A'; ctx.strokeStyle = '#C98A10';
                ctx.beginPath(); ctx.arc(0, 4, 13, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
                ctx.fillStyle = '#E8A317';
                ctx.beginPath(); ctx.roundRect(-16, 2, 32, 4, 2); ctx.fill();
                ctx.fillRect(-2, -9, 4, 11);
                ctx.fillStyle = '#FFFFFF';
                ctx.beginPath(); ctx.arc(0, -4, 2.2, 0, Math.PI * 2); ctx.fill();
                break;
            case 'headphones':
                ctx.strokeStyle = INK; ctx.lineWidth = 3.6;
                ctx.beginPath(); ctx.arc(0, 11, 16, Math.PI * 1.06, Math.PI * 1.94); ctx.stroke();
                [-1, 1].forEach(side => {
                    ctx.fillStyle = '#5BB8FF'; ctx.strokeStyle = INK; ctx.lineWidth = 1.8;
                    ctx.beginPath(); ctx.ellipse(side * 16, 10, 4.6, 6.4, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                    ctx.fillStyle = '#FFFFFF';
                    ctx.beginPath(); ctx.arc(side * 16, 10, 1.8, 0, Math.PI * 2); ctx.fill();
                });
                break;
            case 'santa':
                ctx.fillStyle = '#E64A4A'; ctx.strokeStyle = '#B93434';
                ctx.beginPath(); ctx.arc(0, 4, 12.5, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(2, -8); ctx.quadraticCurveTo(15, -17, 18, -3); ctx.lineTo(12, -4); ctx.quadraticCurveTo(10, -11, 2, -4);
                ctx.closePath(); ctx.fill(); ctx.stroke();
                ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = '#E2E8F4';
                ctx.beginPath(); ctx.arc(18, -2.5, 3.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                ctx.beginPath(); ctx.roundRect(-14, 1, 28, 5.4, 2.7); ctx.fill(); ctx.stroke();
                break;
            case 'bow':
                ctx.save();
                ctx.translate(10, -1); ctx.rotate(0.3);
                ctx.fillStyle = '#FF7EA8'; ctx.strokeStyle = '#E25C8A'; ctx.lineWidth = 1.6;
                [-1, 1].forEach(side => {
                    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(side * 9, -5.5); ctx.lineTo(side * 9, 5.5); ctx.closePath(); ctx.fill(); ctx.stroke();
                });
                ctx.beginPath(); ctx.arc(0, 0, 2.8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                ctx.restore();
                break;
            case 'mushroom':
                ctx.fillStyle = '#E64A4A'; ctx.strokeStyle = '#B93434';
                ctx.beginPath(); ctx.ellipse(0, 0, 17, 11.5, 0, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
                ctx.fillStyle = '#F6E9D6';
                ctx.beginPath(); ctx.roundRect(-15, -1, 30, 4.4, 2.2); ctx.fill();
                ctx.fillStyle = '#FFFFFF';
                [[-7, -6, 2.8], [5, -8.5, 3.3], [11, -3.5, 2.1], [-12, -2.5, 1.8]].forEach(([x, y, r]) => {
                    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
                });
                break;
            case 'horns':
                [-1, 1].forEach(side => {
                    ctx.fillStyle = '#FF5E7E'; ctx.strokeStyle = '#C94468';
                    ctx.beginPath(); ctx.moveTo(side * 11, 4); ctx.quadraticCurveTo(side * 14, -4, side * 9, -10); ctx.quadraticCurveTo(side * 5, -3, side * 4, 3); ctx.closePath(); ctx.fill(); ctx.stroke();
                });
                break;
        }
        ctx.restore();
    }

    // ------------------------------------------------------- accessories
    drawAccessory(o, R, f) {
        const acc = o.skin && o.skin.acc;
        if (!acc || acc === 'none' || acc === 'cape' || acc === 'overalls' || acc === 'backpack' || acc === 'apron') return;
        const ctx = this.ctx;
        const fx = f * 3;
        const ey = -3;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        switch (acc) {
            case 'glasses':
                ctx.strokeStyle = INK; ctx.lineWidth = 1.8;
                ctx.fillStyle = 'rgba(255,255,255,0.35)';
                [-6.5, 6.5].forEach(x => { ctx.beginPath(); ctx.arc(fx + x, ey, 5.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
                ctx.beginPath(); ctx.moveTo(fx - 0.9, ey); ctx.lineTo(fx + 0.9, ey); ctx.stroke();
                break;
            case 'sunglasses':
                ctx.fillStyle = INK;
                [-6.5, 6.5].forEach(x => { ctx.beginPath(); ctx.roundRect(fx + x - 6, ey - 4.3, 12, 8.6, 3.4); ctx.fill(); });
                ctx.fillRect(fx - 1.5, ey - 2.5, 3, 1.8);
                ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.3;
                [-6.5, 6.5].forEach(x => { ctx.beginPath(); ctx.moveTo(fx + x - 3.5, ey - 2); ctx.lineTo(fx + x - 1.5, ey - 3); ctx.stroke(); });
                break;
            case 'mustache':
                ctx.fillStyle = '#4A3B33';
                [-1, 1].forEach(side => {
                    ctx.beginPath();
                    ctx.moveTo(fx, 2.6);
                    ctx.quadraticCurveTo(fx + side * 5, 0.8, fx + side * 9.5, 4.2);
                    ctx.quadraticCurveTo(fx + side * 5, 4.4, fx, 4.6);
                    ctx.closePath();
                    ctx.fill();
                });
                break;
            case 'bowtie':
                ctx.save();
                ctx.translate(fx * 0.4, R - 3);
                ctx.fillStyle = '#FF6B6B';
                [-1, 1].forEach(side => {
                    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(side * 8, -4.5); ctx.lineTo(side * 8, 4.5); ctx.closePath(); ctx.fill();
                });
                ctx.fillStyle = '#C94B4B';
                ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, Math.PI * 2); ctx.fill();
                ctx.restore();
                break;
            case 'scarf':
                ctx.strokeStyle = '#FF9D5C'; ctx.lineWidth = 5.5;
                ctx.beginPath(); ctx.arc(0, -1, R - 2.5, 0.16 * Math.PI, 0.84 * Math.PI); ctx.stroke();
                ctx.strokeStyle = '#E8823A'; ctx.lineWidth = 1.4;
                [0.3, 0.5, 0.7].forEach(a => {
                    ctx.beginPath();
                    ctx.moveTo(Math.cos(a * Math.PI) * (R - 5.5), -1 + Math.sin(a * Math.PI) * (R - 5.5));
                    ctx.lineTo(Math.cos(a * Math.PI) * (R - 0.5), -1 + Math.sin(a * Math.PI) * (R - 0.5));
                    ctx.stroke();
                });
                ctx.fillStyle = '#FF9D5C';
                ctx.beginPath(); ctx.roundRect(-f * 12 - 3, R - 7, 6, 12, 2); ctx.fill();
                break;
            case 'tie':
                ctx.save();
                ctx.translate(fx * 0.4, R - 7);
                ctx.fillStyle = '#5B8DEF'; ctx.strokeStyle = '#3F6FD1'; ctx.lineWidth = 1.4;
                ctx.beginPath(); ctx.moveTo(-3, 2); ctx.lineTo(3, 2); ctx.lineTo(5, 11); ctx.lineTo(0, 14.5); ctx.lineTo(-5, 11); ctx.closePath(); ctx.fill(); ctx.stroke();
                ctx.fillStyle = '#3F6FD1';
                ctx.beginPath(); ctx.roundRect(-3.4, -2.6, 6.8, 5.2, 1.6); ctx.fill();
                ctx.restore();
                break;
            case 'medal':
                ctx.save();
                ctx.translate(fx * 0.5, R - 9);
                ctx.fillStyle = '#FF6B6B';
                ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(-1.5, 4); ctx.lineTo(2, 4); ctx.lineTo(-2.5, -6); ctx.closePath(); ctx.fill();
                ctx.fillStyle = '#4C9BE8';
                ctx.beginPath(); ctx.moveTo(6, -6); ctx.lineTo(1.5, 4); ctx.lineTo(-2, 4); ctx.lineTo(2.5, -6); ctx.closePath(); ctx.fill();
                ctx.fillStyle = '#FFD94A'; ctx.strokeStyle = '#C98A10'; ctx.lineWidth = 1.4;
                ctx.beginPath(); ctx.arc(0, 7, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                ctx.fillStyle = '#C98A10';
                this.starPath(0, 7, 3, 1.4); ctx.fill();
                ctx.restore();
                break;
            case 'pearls':
                for (let i = 0; i < 7; i++) {
                    const a = Math.PI * (0.2 + i * 0.1);
                    ctx.fillStyle = '#FFFFFF'; ctx.strokeStyle = '#C8D4EA'; ctx.lineWidth = 1;
                    ctx.beginPath(); ctx.arc(Math.cos(a) * (R - 4), 1 + Math.sin(a) * (R - 5), 2.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                }
                break;
            case 'bandaid':
                ctx.save();
                ctx.translate(fx + 9.5, 3);
                ctx.rotate(-0.6);
                ctx.fillStyle = '#F4C9A0'; ctx.strokeStyle = '#D9A06E'; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.roundRect(-6.5, -2.4, 13, 4.8, 2.2); ctx.fill(); ctx.stroke();
                ctx.fillStyle = '#E8B07E';
                ctx.fillRect(-2.2, -2.4, 4.4, 4.8);
                ctx.restore();
                break;
            case 'monocle':
                ctx.strokeStyle = '#E8C26A'; ctx.lineWidth = 2.2;
                ctx.fillStyle = 'rgba(255,255,255,0.28)';
                ctx.beginPath(); ctx.arc(fx + 6.5, ey, 5.8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                ctx.lineWidth = 1.3;
                ctx.beginPath(); ctx.moveTo(fx + 10.6, ey + 4.2); ctx.quadraticCurveTo(fx + 15, ey + 9, fx + 12, R - 3); ctx.stroke();
                break;
            case 'lei': {
                const cols = ['#FF7EA8', '#FFD94A', '#FF9D5C', '#FFFFFF'];
                for (let i = 0; i < 8; i++) {
                    const a = Math.PI * (0.16 + i * 0.096);
                    const x = Math.cos(a) * (R - 3), y = 1 + Math.sin(a) * (R - 4);
                    ctx.fillStyle = cols[i % cols.length]; ctx.strokeStyle = 'rgba(43,33,64,0.35)'; ctx.lineWidth = 1;
                    ctx.beginPath(); ctx.arc(x, y, 3.3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
                    ctx.fillStyle = '#FFD94A';
                    ctx.beginPath(); ctx.arc(x, y, 1.1, 0, Math.PI * 2); ctx.fill();
                }
                break;
            }
            case 'eyepatch':
                ctx.strokeStyle = INK; ctx.lineWidth = 1.4;
                ctx.beginPath(); ctx.moveTo(fx + 1.5, ey - 3.5); ctx.lineTo(-R + 1.5, ey - 9); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(fx + 11.5, ey - 3.5); ctx.lineTo(R - 1.5, ey - 9); ctx.stroke();
                ctx.fillStyle = INK;
                ctx.beginPath(); ctx.ellipse(fx + 6.5, ey, 5.8, 5, -0.2, 0, Math.PI * 2); ctx.fill();
                break;
        }
        ctx.restore();
    }

    // Blue work overalls: drawn over the lower body, clipped to the round shape
    drawOveralls(R) {
        const ctx = this.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(0, 0, R, R - 1, 0, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = '#3E7BD6';
        ctx.fillRect(-R - 2, 7, R * 2 + 4, R);
        ctx.fillStyle = '#2F63B5';
        ctx.fillRect(-R - 2, 7, R * 2 + 4, 2);
        // straps over the shoulders (kept out of the face)
        ctx.fillStyle = '#3E7BD6';
        [-1, 1].forEach(side => ctx.fillRect(side * 12.5 - 2, -6, 4, 14));
        // buttons and pocket
        ctx.fillStyle = '#FFD94A';
        [-1, 1].forEach(side => { ctx.beginPath(); ctx.arc(side * 12.5, 8, 1.6, 0, Math.PI * 2); ctx.fill(); });
        ctx.strokeStyle = '#2F63B5';
        ctx.lineWidth = 1.4;
        ctx.strokeRect(-5, 12, 10, 5);
        ctx.restore();
    }

    // Patterns printed on the body, clipped to its round shape
    drawPattern(pat, color, R) {
        if (!pat || pat === 'none') return;
        const ctx = this.ctx;
        ctx.save();
        if (pat === 'freckles') {
            ctx.fillStyle = 'rgba(160, 90, 60, 0.75)';
            [[-12, 3], [-9, 5.5], [-13.5, 6.5], [-8.5, 2], [12, 3], [9, 5.5], [13.5, 6.5], [8.5, 2]].forEach(([x, y]) => {
                ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI * 2); ctx.fill();
            });
            ctx.restore();
            return;
        }
        ctx.beginPath();
        ctx.ellipse(0, 0, R, R - 1, 0, 0, Math.PI * 2);
        ctx.clip();
        const dark = shade(color, -0.14);
        const heart = (x, y, s) => {
            ctx.beginPath();
            ctx.arc(x - s * 0.5, y, s * 0.55, Math.PI, 0);
            ctx.arc(x + s * 0.5, y, s * 0.55, Math.PI, 0);
            ctx.lineTo(x, y + s * 1.1);
            ctx.closePath();
            ctx.fill();
        };
        const dots = [[-11, -10, 1], [10, -12, 0.8], [14, 3, 1], [-15, 6, 0.8], [2, 13, 1], [-7, 15, 0.7], [12, 12, 0.7], [-3, -16, 0.7], [-16, -3, 0.7]];

        if (pat === 'spots') {
            ctx.fillStyle = dark;
            dots.forEach(([x, y, k]) => { ctx.beginPath(); ctx.arc(x, y, 3.6 * k, 0, Math.PI * 2); ctx.fill(); });
        } else if (pat === 'stripes') {
            ctx.fillStyle = dark;
            [-15, -11, 10, 14].forEach(y => ctx.fillRect(-R, y, R * 2, 2.6));
        } else if (pat === 'hearts') {
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            dots.forEach(([x, y, k]) => heart(x, y, 3.4 * k));
        } else if (pat === 'stars') {
            ctx.fillStyle = 'rgba(255,255,255,0.75)';
            dots.forEach(([x, y, k]) => { this.starPath(x, y, 3.6 * k, 1.6 * k); ctx.fill(); });
        } else if (pat === 'checks') {
            ctx.fillStyle = dark;
            const c = 6.5;
            for (let ix = -4; ix < 4; ix++) for (let iy = -4; iy < 4; iy++) {
                if ((ix + iy) % 2 === 0) ctx.fillRect(ix * c, iy * c, c, c);
            }
        }
        ctx.restore();
    }

    drawBackpack(R, f) {
        const ctx = this.ctx;
        const cx = -f * (R - 1);
        ctx.fillStyle = '#C98B4B';
        ctx.strokeStyle = '#8A5A2B';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(cx - 8, -9, 16, 23, 5); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#E3A867';
        ctx.beginPath(); ctx.roundRect(cx - 5, 2, 10, 7, 2); ctx.fill();
    }

    // A cream apron over the lower body (like the overalls: clipped to the round shape)
    drawApron(R) {
        const ctx = this.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(0, 0, R, R - 1, 0, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = '#FFF4E2';
        ctx.strokeStyle = '#E6CFA8';
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.roundRect(-10, 6, 20, R, 3); ctx.fill(); ctx.stroke();
        ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(-7, 6.5); ctx.lineTo(-12, -4); ctx.moveTo(7, 6.5); ctx.lineTo(12, -4); ctx.stroke();
        ctx.fillStyle = '#FFD0DC';
        ctx.beginPath(); ctx.roundRect(-5, 12, 10, 6, 2); ctx.fill();
        ctx.restore();
    }

    drawCape(o, R, f) {
        const ctx = this.ctx;
        const b = -f; // trails behind
        const flutter = Math.sin(o.t * 9) * 2.5 + (o.grounded ? 0 : -3);
        ctx.fillStyle = '#E64A6E';
        ctx.strokeStyle = '#B93454';
        ctx.lineWidth = 1.8;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(b * 6, -9);
        ctx.quadraticCurveTo(b * 20, -6 + flutter, b * 31, 4 + flutter);
        ctx.lineTo(b * 27, 19 + flutter);
        ctx.quadraticCurveTo(b * 14, 17, b * 7, 12);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }

    // Draw a character's bust into this renderer's own canvas (dress-up preview, lobby list)
    drawPortrait(skin, color, t = 0, mood = 'normal') {
        const ctx = this.ctx;
        const W = this.canvas.width, H = this.canvas.height;
        ctx.clearRect(0, 0, W, H);
        const s = H / 74;
        this.drawCharacter({
            x: W / 2 - (skin && skin.acc === 'cape' ? 5 * s : 0), y: H - 5 * s, color, facing: 1, vx: 0, vy: 0,
            grounded: true, t, mood, scale: s, skin
        });
    }

    drawWings(o, R) {
        const ctx = this.ctx;
        const flap = o.flapping ? Math.sin(o.t * 24) * 0.6 : Math.sin(o.t * 3) * 0.08;
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#C8D4EA';
        ctx.lineWidth = 2;
        [-1, 1].forEach(side => {
            ctx.save();
            ctx.translate(side * (R - 4), -4);
            ctx.rotate(side * (-0.9 + flap));
            ctx.beginPath();
            ctx.ellipse(side * 11, 0, 14, 7, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        });
    }

    drawPowerHat(o, R) {
        const ctx = this.ctx;
        if (!o.power || o.power === 'wings') return;
        const blink = o.powerMs < 2500 && Math.floor(o.t * 8) % 2 === 0; // flicker when running out
        if (blink) return;

        ctx.save();
        ctx.translate(0, -R + 3);
        if (o.power === 'fire') {
            const w = Math.sin(o.t * 14) * 2;
            ctx.fillStyle = '#FF7A2B';
            ctx.beginPath();
            ctx.moveTo(-9, 2);
            ctx.quadraticCurveTo(-11, -12, -2 + w, -22);
            ctx.quadraticCurveTo(0, -10, 4, -14);
            ctx.quadraticCurveTo(12, -8, 9, 2);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = '#FFD84A';
            ctx.beginPath();
            ctx.moveTo(-4, 1);
            ctx.quadraticCurveTo(-5, -7, 0, -11);
            ctx.quadraticCurveTo(5, -6, 4, 1);
            ctx.closePath();
            ctx.fill();
        } else if (o.power === 'ice') {
            ctx.fillStyle = '#9BE3FF';
            ctx.strokeStyle = '#5BBCE8';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(-12, 2);
            ctx.lineTo(-9, -12); ctx.lineTo(-4, -2);
            ctx.lineTo(0, -16); ctx.lineTo(4, -2);
            ctx.lineTo(9, -12); ctx.lineTo(12, 2);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        } else if (o.power === 'spin') {
            // propeller beanie
            ctx.fillStyle = '#FF6B6B';
            ctx.beginPath();
            ctx.arc(0, 3, 11, Math.PI, 0);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = '#5B4B8A';
            ctx.lineWidth = 2.5;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(0, -8);
            ctx.lineTo(0, -13);
            ctx.stroke();
            ctx.save();
            ctx.translate(0, -14);
            ctx.scale(Math.cos(o.t * 30), 1);
            ctx.fillStyle = '#5BB8FF';
            ctx.beginPath();
            ctx.ellipse(0, 0, 13, 3, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        ctx.restore();
    }

    // Row of bouncing characters for the menu screen
    drawMascots(t, colors) {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.virtualWidth, this.virtualHeight);
        const n = colors.length;
        colors.forEach((color, i) => {
            const x = this.virtualWidth * (i + 0.5) / n;
            const phase = t * 3 + i * 1.3;
            const up = Math.max(0, Math.sin(phase)) * 26;
            const airborne = up > 1;
            ctx.fillStyle = 'rgba(43, 33, 64, 0.12)';
            ctx.beginPath();
            ctx.ellipse(x, this.virtualHeight - 14, 20 - up * 0.2, 5, 0, 0, Math.PI * 2);
            ctx.fill();
            this.drawCharacter({
                x, y: this.virtualHeight - 14 - up, color,
                facing: i % 2 ? -1 : 1, vx: 0, vy: airborne ? -400 * Math.cos(phase) : 0,
                grounded: !airborne, t: t + i, mood: 'normal', scale: 1.15,
                power: i === 1 ? 'spin' : (i === 3 ? 'wings' : null), powerMs: 9999, flapping: airborne
            });
        });
    }
}
