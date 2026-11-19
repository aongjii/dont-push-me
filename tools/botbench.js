// How far do the computer players get? Runs bots-only rounds on every race level and prints
// the share that reaches the finish and how far along the others got.
//   node tools/botbench.js [trials=3] [bots=4]
const GameRoom = require('../game/GameRoom');
const fs = require('fs'), path = require('path');

const trials = parseInt(process.argv[2] || '3', 10);
const nBots = parseInt(process.argv[3] || '4', 10);
const io = { to: () => ({ emit() {} }) };
const dir = path.join(__dirname, '..', 'game', 'levels');
const levels = fs.readdirSync(dir).map(f => /^level(\d+)\.json$/.exec(f)).filter(Boolean).map(m => +m[1]).sort((a, b) => a - b);

let totalFin = 0, total = 0;
for (const lv of levels) {
    let fin = 0, n = 0, prog = 0;
    for (let t = 0; t < trials; t++) {
        const room = new GameRoom('bench', io, { shuffle: false, rounds: 1, lives: 3 });
        room.buildLevelOrder = () => [lv];
        room.addPlayer('human', 'Dummy');             // an idle human so the round does not end instantly
        for (let i = 0; i < nBots; i++) room.addBot();
        room.startGame();
        clearInterval(room.countdownInterval);
        room.status = 'playing';
        const limit = room.level.timeLimit * 1000;
        room.roundTimeLeft = limit;
        room.players.human.invulnMs = 1e12;            // idle ghost: keeps the round going without getting in anyone's way
        const l = room.gameLoop;
        let best = {};
        for (let ms = 0; ms < limit && room.status === 'playing'; ms += l.step) {
            l.update(l.step);
            for (const p of Object.values(room.players)) if (p.isBot) best[p.id] = Math.max(best[p.id] || 0, room.level.height > room.level.width ? room.level.height - p.y : p.x);
        }
        const span = room.level.height > room.level.width ? room.level.height : room.level.width;
        for (const p of Object.values(room.players)) {
            if (!p.isBot) continue;
            n++; if (p.isFinished) fin++;
            prog += p.isFinished ? 1 : Math.min(1, (best[p.id] || 0) / span);
        }
    }
    totalFin += fin; total += n;
    console.log(`level ${lv}: ${Math.round(100 * fin / n)}% finished, average progress ${Math.round(100 * prog / n)}%`);
}
console.log(`overall: ${Math.round(100 * totalFin / total)}% of bots reached the finish`);
