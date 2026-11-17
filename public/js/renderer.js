// Flat, bright rendering: pastel themes per level, round "blob" characters.
// No glows or gradients on purpose.

const INK = '#2B2140';

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
        this.canvas = document.getElementById(canvasId);
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
                if (Math.hypot(dx, dy) < 60) this.drawKeyPrompt(sw.x + sw.width / 2, sw.y - 26, 'E');
            }
        });
        gameState.hazards.forEach(h => this.drawHazard(h));
        (gameState.items || []).forEach(it => { if (it.alive) this.drawItem(it, localPlayer); });

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
            // A removed plank: just a faint dashed outline so you can see where it was
            ctx.strokeStyle = 'rgba(43,33,64,0.25)';
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
    drawItem(it, localPlayer) {
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
        if (localPlayer && !localPlayer.isDead && !localPlayer.isFinished && !localPlayer.mouth && !localPlayer.inhaling) {
            const d = Math.hypot(it.x - (localPlayer.x + localPlayer.width / 2), it.y - (localPlayer.y + localPlayer.height / 2));
            if (d < 190) this.drawKeyPrompt(it.x, it.y - 34, 'C', 'ค้างเพื่ออม');
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
            mouthColor,
            pushing: player.pushDuration > 0,
            power: player.power,
            powerMs: player.powerMs,
            frozen,
            rot: rolling ? t * 20 * (player.facing || 1) : (tumbling ? t * 9 * Math.sign(player.vx) : 0),
            flapping: player.power === 'wings' && !player.isGrounded
        });

        // Suction streaks in front of the mouth
        if (player.inhaling) this.drawInhale(player);

        this.drawNameTag(player, isLocal);

        if (frozen) {
            ctx.font = '18px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(frozen === 'ice' ? '❄️' : '🧲', cx, player.y - 36);
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
                ctx.font = `${Math.round(30 * (0.6 + 0.4 * pop))}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.fillText(emote.emoji, cx, player.y - 54 - age * 14);
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
        if (o.mouthColor) { sx *= 1.14; sy *= 1.06; }
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

        // wings sit behind the body
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

        // power hat
        this.drawPowerHat(o, R);

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

    drawFace(o, f) {
        const ctx = this.ctx;
        const ex = [-6.5, 6.5];
        const ey = -3;
        const fx = f * 3; // face looks toward travel direction

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
            // tall oval eyes with a shine, like a certain pink puffball
            ex.forEach(x => {
                ctx.fillStyle = INK;
                ctx.beginPath();
                ctx.ellipse(fx + x, ey, 3.3, 5.4, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#FFFFFF';
                ctx.beginPath();
                ctx.arc(fx + x - 0.6, ey - 2.4, 1.5, 0, Math.PI * 2);
                ctx.fill();
            });
        }

        // blush
        ctx.fillStyle = 'rgba(255, 92, 138, 0.5)';
        [-1, 1].forEach(side => {
            ctx.beginPath();
            ctx.ellipse(fx + side * 12.5, 4.5, 4, 2.4, 0, 0, Math.PI * 2);
            ctx.fill();
        });

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
            ctx.strokeStyle = '#7A2E48';
            ctx.lineWidth = 1.9;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.arc(fx, 4.5, 3, 0.15 * Math.PI, 0.85 * Math.PI);
            ctx.stroke();
        }
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
