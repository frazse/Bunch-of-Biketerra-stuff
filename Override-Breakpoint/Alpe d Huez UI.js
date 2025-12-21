// ==UserScript==
// @name         Biketerra – Alpe d'Huez Turn UI (bad zwift clone)
// @namespace    https://biketerra.com/
// @version      13.0
// @description  copy from zwifts ui for AdZ made for https://biketerra.com/routes/2250
// @author       Josef
// @match        https://biketerra.com/ride?route=2250
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const RAW_TURNS = [
        { n:21, d: 808 }, { n:20, d: 1505 }, { n:19, d: 1966 }, { n:18, d: 2314 },
        { n:17, d: 3180 }, { n:16, d: 3548 }, { n:15, d: 4291 }, { n:14, d: 4755 },
        { n:13, d: 5250 }, { n:12, d: 5850 }, { n:11, d: 6380 }, { n:10, d: 6985 },
        { n: 9, d: 8637 }, { n: 8, d: 9150 }, { n: 7, d: 9585 }, { n: 6, d:10432 },
        { n: 5, d:10875 }, { n: 4, d:11410 }, { n: 3, d:12279 }, { n: 2, d:12692 },
        { n: 1, d:13835 }
    ];

    const TURNS = RAW_TURNS.map((t, i) => {
        const prevDist = i === 0 ? 0 : RAW_TURNS[i-1].d;
        return { ...t, length: t.d - prevDist };
    });

    const container = document.createElement('div');
    container.style.cssText = `
        position: fixed; top: 10px; left: 10px; width: 280px;
        font-family: 'Segoe UI', sans-serif; color: white; z-index: 1;
        display: flex; flex-direction: column; gap: 2px;
    `;
    document.body.appendChild(container);

    let activeTurn = null;
    let turnStartTime = 0;
    let wattSum = 0;
    let hrSum = 0;
    let samples = 0;
    const turnHistory = {};

    function formatTime(sec) {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    }

    function getHeartRateFromDOM() {
        const hrIcon = document.querySelector('.ico-hr');
        if (hrIcon) {
            const rowSplit = hrIcon.closest('.stat-row-split');
            if (rowSplit) {
                const valueEl = rowSplit.querySelector('.stat-value');
                if (valueEl) {
                    const val = parseInt(valueEl.textContent.trim());
                    return isNaN(val) ? 0 : val;
                }
            }
        }
        return 0;
    }

    function update() {
        const ego = window.gameManager?.ego;
        if (!ego) return;

        // --- PAUSE LOGIC ---
        // If currentPath.id is 1, we are descending. Stop updating.
        if (ego.currentPath?.id === 1) return;

        const dist = ego.currentPathDistance || 0;
        const watts = ego.power || 0;
        const currentHR = getHeartRateFromDOM();
        const now = performance.now() / 1000;

        const currentIdx = TURNS.findIndex(t => dist < t.d);

        // If we finished turn 1 and the index is not found, keep the last state
        if (currentIdx === -1) return;

        const currentTurn = TURNS[currentIdx];

        if (currentTurn.n !== activeTurn) {
            if (activeTurn !== null && samples > 0) {
                turnHistory[activeTurn] = {
                    time: formatTime(now - turnStartTime),
                    watts: Math.round(wattSum / samples),
                    hr: hrSum > 0 ? Math.round(hrSum / samples) : '--'
                };
            }
            activeTurn = currentTurn.n;
            turnStartTime = now;
            wattSum = 0;
            hrSum = 0;
            samples = 0;
        }

        wattSum += watts;
        if (currentHR > 0) hrSum += currentHR;
        samples++;

        const avgW = Math.round(wattSum / samples);
        const avgHR = hrSum > 0 ? Math.round(hrSum / samples) : 0;
        const elapsed = now - turnStartTime;

        container.innerHTML = `<div style="background:#efefef; color:#333; font-weight:900; font-size:11px; text-align:center; padding:4px; border-radius:4px 4px 0 0; text-transform:uppercase; letter-spacing:1px;">Alpe d'Huez Sectors</div>`;

        TURNS.forEach((t, idx) => {
            const row = document.createElement('div');
            const isActive = t.n === activeTurn;
            const historyData = turnHistory[t.n];

            if (isActive) {
                const distInSector = dist - (idx === 0 ? 0 : TURNS[idx-1].d);
                const remaining = Math.max(0, Math.round(t.length - distInSector));
                const progress = (distInSector / t.length) * 100;

                row.style.cssText = `background: rgba(30, 80, 120, 0.95); padding: 10px; border-left: 6px solid #ff8c00;`;
                row.innerHTML = `
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <span style="font-size:28px; font-weight:900; line-height:1;">${t.n}</span>
                        <div style="text-align:right">
                            <div style="font-size:18px; font-weight:900; color:#ff8c00;">${remaining}m</div>
                            <div style="font-size:11px; opacity:0.9; font-weight:bold; margin-top:2px;">
                                ${avgW}W | ${avgHR > 0 ? avgHR + ' BPM' : '-- BPM'} | ${formatTime(elapsed)}
                            </div>
                        </div>
                    </div>
                    <div style="width:100%; height:5px; background:rgba(0,0,0,0.4); margin-top:8px; border-radius:2px; overflow:hidden;">
                        <div style="width:${progress}%; height:100%; background:white;"></div>
                    </div>
                `;
            } else if (historyData) {
                row.style.cssText = `background: rgba(0,0,0,0.6); padding: 5px 12px; display:flex; justify-content:space-between; font-size:12px; font-weight:bold; color: white;`;
                row.innerHTML = `
                    <span style="width: 80px;">Turn ${t.n}</span>
                    <span style="flex-grow:1; text-align:right; font-weight:bold;">
                        ${historyData.time} | ${historyData.watts}W | ${historyData.hr} BPM
                    </span>
                `;
            } else {
                row.style.cssText = `background: rgba(20,20,20,0.7); padding: 5px 12px; display:flex; justify-content:space-between; font-size:12px; font-weight:bold; opacity:0.35;`;
                row.innerHTML = `<span>Turn ${t.n}</span><span>${Math.round(t.length)}m</span>`;
            }
            container.appendChild(row);
        });
    }

    setInterval(update, 250);
})();
