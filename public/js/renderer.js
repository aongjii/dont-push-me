class Renderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        
        // Virtual resolution
        this.virtualWidth = 1280;
        this.virtualHeight = 720;

        // Camera offset
        this.camera = { x: 0, y: 0 };
        this.shakeTimer = 0;
        this.shakeIntensity = 0;

        // Visual properties
        this.particles = [];
    }

    triggerShake(duration = 200, intensity = 5) {
        this.shakeTimer = duration;
        this.shakeIntensity = intensity;
    }

    addParticles(x, y, color, count = 8) {
        for (let i = 0; i < count; i++) {
            this.particles.push({
                x,
                y,
                vx: (Math.random() - 0.5) * 200,
                vy: (Math.random() - 0.5) * 200 - 100,
                radius: Math.random() * 4 + 2,
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
            p.alpha = Math.max(0, p.life);

            if (p.life <= 0) {
                this.particles.splice(i, 1);
            }
        }
    }

    draw(gameState, localPlayerId, levelData, dt) {
        // Update particles
        this.updateParticles(dt);

        // Screen Shake calculation
        let shakeX = 0;
        let shakeY = 0;
        if (this.shakeTimer > 0) {
            this.shakeTimer -= dt * 1000;
            shakeX = (Math.random() - 0.5) * this.shakeIntensity;
            shakeY = (Math.random() - 0.5) * this.shakeIntensity;
        }

        const localPlayer = gameState.players.find(p => p.id === localPlayerId);
        const mapWidth = levelData.levelWidth;
        const mapHeight = levelData.levelHeight;

        // Position camera centered on local player
        if (localPlayer) {
            // Horizontal scroll target
            if (mapWidth > this.virtualWidth) {
                this.camera.x = localPlayer.x - this.virtualWidth / 2 + localPlayer.width / 2;
                this.camera.x = Math.max(0, Math.min(this.camera.x, mapWidth - this.virtualWidth));
            } else {
                this.camera.x = (mapWidth - this.virtualWidth) / 2;
            }

            // Vertical scroll target
            if (mapHeight > this.virtualHeight) {
                this.camera.y = localPlayer.y - this.virtualHeight / 2 + localPlayer.height / 2;
                this.camera.y = Math.max(0, Math.min(this.camera.y, mapHeight - this.virtualHeight));
            } else {
                this.camera.y = (mapHeight - this.virtualHeight) / 2;
            }
        }

        // Apply shake
        const camX = this.camera.x + shakeX;
        const camY = this.camera.y + shakeY;

        // Clear Canvas with smooth dark gradient
        const bgGrad = this.ctx.createLinearGradient(0, 0, 0, this.virtualHeight);
        bgGrad.addColorStop(0, '#0c0813');
        bgGrad.addColorStop(1, '#1b122b');
        this.ctx.fillStyle = bgGrad;
        this.ctx.fillRect(0, 0, this.virtualWidth, this.virtualHeight);

        // Draw Parallax Grid
        this.drawParallaxGrid(camX, camY, mapWidth, mapHeight);

        this.ctx.save();
        this.ctx.translate(-camX, -camY);

        // --- DRAW GAME WORLD ---

        // 1. Draw Finish Zone (Point B)
        this.drawFinishZone(levelData.finishZone);

        // 2. Draw Platforms
        gameState.platforms.forEach(plat => {
            this.drawPlatform(plat);
        });

        // 3. Draw Switches
        if (levelData.switches) {
            levelData.switches.forEach((sw, idx) => {
                // Find actual state from incoming level platforms
                const currentSw = levelData.switches[idx];
                this.drawSwitch(sw, currentSw.active);

                // Draw interact tip if local player is nearby
                if (localPlayer && !localPlayer.isDead && !localPlayer.isFinished) {
                    const dx = sw.x + sw.width/2 - (localPlayer.x + localPlayer.width/2);
                    const dy = sw.y + sw.height/2 - (localPlayer.y + localPlayer.height/2);
                    const dist = Math.sqrt(dx*dx + dy*dy);
                    if (dist < 60) {
                        this.drawInteractPrompt(sw.x + sw.width/2, sw.y - 25);
                    }
                }
            });
        }

        // 4. Draw Hazards (Spikes, Moving Spikes)
        gameState.hazards.forEach(haz => {
            this.drawHazard(haz);
        });

        // 5. Draw Particles
        this.particles.forEach(p => {
            this.ctx.save();
            this.ctx.globalAlpha = p.alpha;
            this.ctx.fillStyle = p.color;
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.restore();
        });

        // 6. Draw Players
        gameState.players.forEach(player => {
            this.drawPlayer(player, player.id === localPlayerId);
        });

        // 7. Draw Rising Lava
        if (gameState.lavaY !== null) {
            this.drawLava(gameState.lavaY, mapWidth);
        }

        this.ctx.restore();
    }

    drawParallaxGrid(camX, camY, mapWidth, mapHeight) {
        this.ctx.save();
        this.ctx.strokeStyle = 'rgba(121, 40, 202, 0.05)';
        this.ctx.lineWidth = 1;

        const gridSize = 80;
        const startX = -((camX * 0.3) % gridSize);
        const startY = -((camY * 0.3) % gridSize);

        for (let x = startX; x < this.virtualWidth; x += gridSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.virtualHeight);
            this.ctx.stroke();
        }

        for (let y = startY; y < this.virtualHeight; y += gridSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.virtualWidth, y);
            this.ctx.stroke();
        }
        this.ctx.restore();
    }

    drawPlatform(plat) {
        this.ctx.save();
        if (!plat.active) {
            // Inactive platform outline (translucent)
            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            this.ctx.setLineDash([5, 5]);
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(plat.x + 2, plat.y + 2, plat.width - 4, plat.height - 4);
            
            // Draw a subtle "X" pattern inside
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
            this.ctx.fillRect(plat.x, plat.y, plat.width, plat.height);
        } else {
            // Draw normal solid platform with glass glow
            const grad = this.ctx.createLinearGradient(plat.x, plat.y, plat.x, plat.y + plat.height);
            grad.addColorStop(0, '#2e1c4e');
            grad.addColorStop(1, '#150a26');

            this.ctx.fillStyle = grad;
            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
            this.ctx.lineWidth = 1;

            // Draw rounded rectangle
            const radius = 6;
            this.ctx.beginPath();
            this.ctx.roundRect(plat.x, plat.y, plat.width, plat.height, radius);
            this.ctx.fill();
            this.ctx.stroke();

            // Draw top highlight
            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            this.ctx.beginPath();
            this.ctx.moveTo(plat.x + radius, plat.y);
            this.ctx.lineTo(plat.x + plat.width - radius, plat.y);
            this.ctx.stroke();
        }
        this.ctx.restore();
    }

    drawSwitch(sw, active) {
        this.ctx.save();
        
        // Base plate
        this.ctx.fillStyle = '#4a3768';
        this.ctx.fillRect(sw.x, sw.y + sw.height - 10, sw.width, 10);
        
        // Lever stick
        this.ctx.lineWidth = 4;
        this.ctx.strokeStyle = '#a090b8';
        this.ctx.beginPath();
        this.ctx.moveTo(sw.x + sw.width / 2, sw.y + sw.height - 10);
        
        if (active) {
            // Lever right
            this.ctx.lineTo(sw.x + sw.width - 2, sw.y + 10);
        } else {
            // Lever left
            this.ctx.lineTo(sw.x + 2, sw.y + 10);
        }
        this.ctx.stroke();

        // Handle knob
        this.ctx.fillStyle = active ? '#2ecc71' : '#ff4d4d';
        this.ctx.beginPath();
        const knobX = active ? sw.x + sw.width - 2 : sw.x + 2;
        const knobY = sw.y + 10;
        this.ctx.arc(knobX, knobY, 6, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.shadowBlur = 10;
        this.ctx.shadowColor = this.ctx.fillStyle;
        this.ctx.fill();

        this.ctx.restore();
    }

    drawInteractPrompt(x, y) {
        this.ctx.save();
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        this.ctx.strokeStyle = '#ffcc00';
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        this.ctx.roundRect(x - 12, y - 12, 24, 24, 4);
        this.ctx.fill();
        this.ctx.stroke();

        this.ctx.fillStyle = '#ffcc00';
        this.ctx.font = 'bold 12px Outfit';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText('E', x, y);
        this.ctx.restore();
    }

    drawHazard(haz) {
        this.ctx.save();
        
        if (haz.type === 'spikes' || haz.type === 'moving_spikes') {
            // Draw spikes (row of triangles)
            const spikeWidth = 20;
            const count = Math.ceil(haz.width / spikeWidth);
            
            // Draw backing plate
            this.ctx.fillStyle = '#3a1f47';
            this.ctx.fillRect(haz.x, haz.y + haz.height - 8, haz.width, 8);

            // Draw triangles
            this.ctx.fillStyle = '#a050ff';
            this.ctx.strokeStyle = '#e070ff';
            this.ctx.lineWidth = 1;
            
            for (let i = 0; i < count; i++) {
                const sx = haz.x + i * spikeWidth;
                this.ctx.beginPath();
                this.ctx.moveTo(sx, haz.y + haz.height - 8);
                this.ctx.lineTo(sx + spikeWidth / 2, haz.y);
                this.ctx.lineTo(sx + spikeWidth, haz.y + haz.height - 8);
                this.ctx.closePath();
                this.ctx.fill();
                this.ctx.stroke();
            }
        }
        this.ctx.restore();
    }

    drawFinishZone(finish) {
        this.ctx.save();
        
        // Draw checkered border
        const checkSize = 10;
        this.ctx.fillStyle = 'rgba(255,255,255,0.05)';
        this.ctx.fillRect(finish.x, finish.y, finish.width, finish.height);

        // Columns check design
        this.ctx.fillStyle = '#ffffff';
        for (let y = finish.y; y < finish.y + finish.height; y += checkSize * 2) {
            // Left pillar
            this.ctx.fillRect(finish.x, y, checkSize, checkSize);
            this.ctx.fillRect(finish.x + checkSize, y + checkSize, checkSize, checkSize);
            
            // Right pillar
            this.ctx.fillRect(finish.x + finish.width - checkSize * 2, y, checkSize, checkSize);
            this.ctx.fillRect(finish.x + finish.width - checkSize, y + checkSize, checkSize, checkSize);
        }

        // Draw neon glow header banner
        const glowGrad = this.ctx.createLinearGradient(finish.x, finish.y, finish.x + finish.width, finish.y);
        glowGrad.addColorStop(0, '#00f2fe');
        glowGrad.addColorStop(1, '#4facfe');
        this.ctx.fillStyle = glowGrad;
        this.ctx.fillRect(finish.x, finish.y, finish.width, 12);
        
        this.ctx.shadowBlur = 15;
        this.ctx.shadowColor = '#00f2fe';
        this.ctx.fillRect(finish.x, finish.y, finish.width, 4);

        // Draw "FINISH" text
        this.ctx.fillStyle = '#00f2fe';
        this.ctx.font = 'bold 13px Outfit';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('FINISH', finish.x + finish.width / 2, finish.y + 30);

        this.ctx.restore();
    }

    drawPlayer(player, isLocal) {
        this.ctx.save();

        let px = player.x;
        let py = player.y;

        // Apply slight shiver effect if pulled (frozen)
        if (player.pullDuration > 0) {
            px += (Math.random() - 0.5) * 3;
        }

        // Draw player body (Fall Guy style rounded bean capsule)
        const radius = player.width / 2;
        
        // Shadow underneath
        if (!player.isDead) {
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
            this.ctx.beginPath();
            this.ctx.ellipse(px + radius, py + player.height - 3, radius * 0.8, 4, 0, 0, Math.PI * 2);
            this.ctx.fill();
        }

        this.ctx.fillStyle = player.color;
        this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        this.ctx.lineWidth = 2;

        this.ctx.beginPath();
        this.ctx.roundRect(px, py, player.width, player.height, radius);
        this.ctx.fill();
        this.ctx.stroke();

        // 1. Draw Visor (Facemask)
        const visorW = player.width * 0.7;
        const visorH = player.height * 0.35;
        const visorX = player.facing === 1 ? px + player.width * 0.22 : px + player.width * 0.08;
        const visorY = py + player.height * 0.15;
        
        this.ctx.fillStyle = '#110d21';
        this.ctx.beginPath();
        this.ctx.roundRect(visorX, visorY, visorW, visorH, 8);
        this.ctx.fill();

        // 2. Draw Eyes based on status
        this.ctx.fillStyle = '#ffffff';
        const eyeR = 3;
        const eyeOffset = player.facing === 1 ? 2 : 0;
        const leftEyeX = visorX + visorW * 0.3 + eyeOffset;
        const rightEyeX = visorX + visorW * 0.7 + eyeOffset;
        const eyeY = visorY + visorH * 0.5;

        if (player.isDead) {
            // "X" eyes
            this.ctx.strokeStyle = '#e74c3c';
            this.ctx.lineWidth = 2;
            // Left X
            this.ctx.beginPath();
            this.ctx.moveTo(leftEyeX - 3, eyeY - 3); this.ctx.lineTo(leftEyeX + 3, eyeY + 3);
            this.ctx.moveTo(leftEyeX + 3, eyeY - 3); this.ctx.lineTo(leftEyeX - 3, eyeY + 3);
            // Right X
            this.ctx.moveTo(rightEyeX - 3, eyeY - 3); this.ctx.lineTo(rightEyeX + 3, eyeY + 3);
            this.ctx.moveTo(rightEyeX + 3, eyeY - 3); this.ctx.lineTo(rightEyeX - 3, eyeY + 3);
            this.ctx.stroke();
        } else if (player.isFinished) {
            // Star/Happy eyes (curves ^ ^)
            this.ctx.strokeStyle = '#ffcc00';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.arc(leftEyeX, eyeY + 2, 4, Math.PI, 0);
            this.ctx.arc(rightEyeX, eyeY + 2, 4, Math.PI, 0);
            this.ctx.stroke();
        } else {
            // Normal dot eyes
            this.ctx.beginPath();
            this.ctx.arc(leftEyeX, eyeY, eyeR, 0, Math.PI*2);
            this.ctx.arc(rightEyeX, eyeY, eyeR, 0, Math.PI*2);
            this.ctx.fill();
        }

        // 3. Draw Hands
        this.ctx.fillStyle = player.color;
        this.ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        this.ctx.lineWidth = 1;
        
        if (player.pushDuration > 0) {
            // Render hands extending forward (PUSH action!)
            const handX = player.facing === 1 ? px + player.width + 5 : px - 9;
            const handY = py + player.height * 0.5;
            
            this.ctx.beginPath();
            this.ctx.arc(handX, handY - 4, 5, 0, Math.PI*2);
            this.ctx.arc(handX, handY + 4, 5, 0, Math.PI*2);
            this.ctx.fill();
            this.ctx.stroke();
        } else {
            // Normal hanging hands
            const leftHandX = px - 2;
            const rightHandX = px + player.width - 2;
            const handY = py + player.height * 0.55;
            
            this.ctx.beginPath();
            this.ctx.arc(leftHandX, handY, 4, 0, Math.PI*2);
            this.ctx.arc(rightHandX, handY, 4, 0, Math.PI*2);
            this.ctx.fill();
            this.ctx.stroke();
        }

        // 4. Highlight indicator for LOCAL player
        if (isLocal && !player.isDead) {
            this.ctx.fillStyle = '#ffcc00';
            this.ctx.beginPath();
            this.ctx.moveTo(px + radius - 6, py - 18);
            this.ctx.lineTo(px + radius + 6, py - 18);
            this.ctx.lineTo(px + radius, py - 10);
            this.ctx.closePath();
            this.ctx.fill();
            
            // Subtly bounce it
            const bounce = Math.sin(Date.now() * 0.01) * 3;
            this.ctx.shadowBlur = 10;
            this.ctx.shadowColor = '#ffcc00';
            this.ctx.beginPath();
            this.ctx.moveTo(px + radius - 6, py - 18 + bounce);
            this.ctx.lineTo(px + radius + 6, py - 18 + bounce);
            this.ctx.lineTo(px + radius, py - 10 + bounce);
            this.ctx.closePath();
            this.ctx.fill();
        }

        // 5. Draw Name above head
        this.ctx.fillStyle = isLocal ? '#ffcc00' : 'white';
        this.ctx.font = 'bold 12px Noto Sans Thai, Outfit';
        this.ctx.textAlign = 'center';
        this.ctx.fillText(player.name, px + radius, py - 24);

        // 6. Draw magnet indicator for PULLED (frozen) status
        if (player.pullDuration > 0) {
            this.ctx.font = '16px Outfit';
            this.ctx.fillText('🧲', px + radius, py - 40);
        }

        this.ctx.restore();
    }

    drawLava(lavaY, mapWidth) {
        this.ctx.save();

        // Create bubbling red-orange lava gradient
        const lavaGrad = this.ctx.createLinearGradient(0, lavaY, 0, lavaY + 400);
        lavaGrad.addColorStop(0, '#ff3700');
        lavaGrad.addColorStop(0.3, '#ff7700');
        lavaGrad.addColorStop(1, '#830800');

        this.ctx.fillStyle = lavaGrad;
        this.ctx.shadowBlur = 30;
        this.ctx.shadowColor = '#ff3700';

        // Draw wavy lava top surface
        const waveHeight = 8;
        const waveLength = 40;
        const offset = (Date.now() * 0.005) % (waveLength * 2);

        this.ctx.beginPath();
        this.ctx.moveTo(0, lavaY);
        
        for (let x = 0; x <= mapWidth; x += 10) {
            const y = lavaY + Math.sin((x + offset) / waveLength) * waveHeight;
            this.ctx.lineTo(x, y);
        }
        
        this.ctx.lineTo(mapWidth, lavaY + 800);
        this.ctx.lineTo(0, lavaY + 800);
        this.ctx.closePath();
        this.ctx.fill();

        // Bubbles rise details
        this.ctx.fillStyle = 'rgba(255, 204, 0, 0.4)';
        this.ctx.shadowBlur = 0;
        for (let i = 0; i < mapWidth; i += 120) {
            const bx = i + ((Date.now() * 0.05 + i) % 80);
            const by = lavaY + 20 + ((Date.now() * 0.08 + i) % 150);
            this.ctx.beginPath();
            this.ctx.arc(bx, by, 4, 0, Math.PI*2);
            this.ctx.fill();
        }

        this.ctx.restore();
    }
}

window.Renderer = Renderer;
