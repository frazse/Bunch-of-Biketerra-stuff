// ==UserScript==
// @name         BikeTerra Challenge List
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  Fetch data from dashboard in background for Ride page support with original styling
// @author       You
// @match        https://biketerra.com/*
// @match        https://www.biketerra.com/*
// @exclude      https://biketerra.com/spectate*
// @icon          https://www.google.com/s2/favicons?sz=64&domain=biketerra.com
// @grant        GM_xmlhttpRequest
// @connect      api.biketerra.com
// @connect      biketerra.com
// ==/UserScript==

(function() {
    'use strict';

    const API_URL = 'https://api.biketerra.com/challenge/list';

    // 1. DATA EXTRACTION (Handles text from scripts or background fetch)
    function parseBikeTerraText(text) {
        let data = { token: null, challenges: {} };
        if (text.includes('data:{user:{')) {
            const tokenMatch = text.match(/token\s*:\s*"([^"]+)"/);
            if (tokenMatch) data.token = tokenMatch[1];

            const challengeRegex = /"(\d+)"\s*:\s*\{[^{}]*?pct\s*:\s*(\d+)/g;
            let match;
            while ((match = challengeRegex.exec(text)) !== null) {
                data.challenges[match[1]] = parseInt(match[2], 10);
            }
        }
        return data;
    }

    // 2. BACKGROUND DASHBOARD FETCH (Used when data is missing on current page)
    async function getBikeTerraData() {
        // First try the current page
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
            const parsed = parseBikeTerraText(script.textContent);
            if (parsed.token) return parsed;
        }

        // If not found (like on /ride), fetch from dashboard in background
        return new Promise((resolve) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: 'https://biketerra.com/dashboard',
                onload: (res) => {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(res.responseText, 'text/html');
                    const bgScripts = doc.querySelectorAll('script');
                    let finalData = { token: null, challenges: {} };
                    for (const script of bgScripts) {
                        const parsed = parseBikeTerraText(script.textContent);
                        if (parsed.token) { finalData = parsed; break; }
                    }
                    resolve(finalData);
                },
                onerror: () => resolve({ token: null, challenges: {} })
            });
        });
    }

    // 3. VISIBILITY & API LOGIC
    function isChallengeVisible(challenge) {
        const now = new Date();
        const from = new Date(challenge.valid_from + 'T00:00:00');
        const to = new Date(challenge.valid_to + 'T23:59:59');
        if (to.getFullYear() >= 3000) return false;
        if (now < from) return false;
        return (now >= from && now <= to) || challenge.status === "completed";
    }

    async function fetchAllChallenges(token) {
        const statuses = ["", "completed"];
        const merged = [];
        const seen = new Set();
        for (const status of statuses) {
            const res = await new Promise((resolve) => {
                GM_xmlhttpRequest({
                    method: 'POST',
                    url: API_URL,
                    headers: { 'Content-Type': 'application/json' },
                    data: JSON.stringify({ token, per_page: 12, paged: 1, status }),
                    onload: r => resolve(JSON.parse(r.responseText))
                });
            });
            if (res.ok && res.msg.results) {
                res.msg.results.forEach(ch => {
                    if (!seen.has(ch.id)) { seen.add(ch.id); merged.push(ch); }
                });
            }
        }
        return { results: merged };
    }

    // 4. ORIGINAL STYLE UI ELEMENTS
    function createProgressBar(percentage, goal, isDistance) {
        const currentRaw = (percentage / 100) * goal;
        const unit = isDistance ? 'km' : 'm';
        const displayCurrent = isDistance ? (currentRaw / 1000).toFixed(1) : Math.round(currentRaw).toLocaleString();
        const displayGoal = isDistance ? (goal / 1000).toLocaleString() : goal.toLocaleString();

        const container = document.createElement('div');
        container.style.cssText = `margin-top: 10px; clear: both;`;
        container.innerHTML = `
            <div style="width: 100%; height: 24px; background: #e0e0e0; border-radius: 12px; overflow: hidden; position: relative;">
                <div style="width: ${Math.min(percentage, 100)}%; height: 100%; background: linear-gradient(90deg, #4CAF50, #45a049); transition: width 0.3s ease;"></div>
                <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; color: ${percentage > 50 ? 'white' : '#333'};">
                    ${displayCurrent}${unit} / ${displayGoal}${unit} (${percentage.toFixed(1)}%)
                </div>
            </div>
        `;
        return container;
    }

    async function displayChallenges(challenges, pageData) {
        const container = document.createElement('div');
        container.id = 'biketerra-challenges-widget';
        container.style.cssText = `
            position: fixed; top: 8px; left: 8px;
            background: rgba(0,0,0,0.5); border-radius: 8px;
            padding: 15px; max-width: 600px; max-height: 600px;
            overflow-y: auto; z-index: 99999; font-family: "Overpass", sans-serif;
            transition: opacity 1s ease;
        `;

        const visibleChallenges = challenges.results.filter(isChallengeVisible);

        for (const challenge of visibleChallenges) {
            const rules = JSON.parse(challenge.rules);
            const isDistance = !!rules.totalDistance;
            const goal = rules.totalElevation || rules.totalDistance || 0;
            const percentage = pageData.challenges[challenge.id] || 0;

            const challengeDiv = document.createElement('div');
            challengeDiv.style.cssText = `
                margin-bottom: 15px; padding: 12px;
                background: rgba(255,255,255,0.7); border-radius: 6px;
                cursor: pointer; transition: background 0.2s;
            `;
            challengeDiv.onmouseover = () => challengeDiv.style.background = '#ebebeb';
            challengeDiv.onmouseout = () => challengeDiv.style.background = 'rgba(255,255,255,0.7)';
            challengeDiv.onclick = () => window.open(`https://biketerra.com/challenges/${challenge.id}`, '_blank');

            const timestamp = challenge.updated_on.replace(/[^0-9]/g, '');
            const imageHTML = challenge.has_image ? `
                <img src="https://biketerra.nyc3.cdn.digitaloceanspaces.com/challenges/${challenge.id}.webp?${timestamp}"
                     style="width: 20%; aspect-ratio: 1/1; object-fit: cover; border-radius: 6px; float: left; margin-right: 12px;">
            ` : '';

            const goalText = isDistance ? `${(goal/1000).toLocaleString()}km distance` : `${goal.toLocaleString()}m elevation`;

            challengeDiv.innerHTML = `
                ${imageHTML}
                <div style="overflow: hidden;">
                    <h4 style="margin: 0 0 8px 0; color: #333;">${challenge.title}</h4>
                    <p style="margin: 5px 0; color: #666; font-size: 14px;">${challenge.blurb}</p>
                    <p style="margin: 5px 0; font-size: 13px;"><strong>Goal:</strong> ${goalText}</p>
                    <p style="margin: 5px 0; font-size: 13px;"><strong>Period:</strong> ${challenge.valid_from} to ${challenge.valid_to}</p>
                </div>
                <div style="clear: both"></div>
            `;

            if (goal > 0) {
                challengeDiv.insertBefore(createProgressBar(percentage, goal, isDistance), challengeDiv.querySelector('[style*="clear: both"]'));
            }
            container.appendChild(challengeDiv);
        }
        document.body.appendChild(container);

        // Auto-hide after 15 seconds
        setTimeout(() => {
            const el = document.getElementById('biketerra-challenges-widget');
            if (el) {
                el.style.opacity = "0";
                setTimeout(() => el.remove(), 1000);
            }
        }, 15000);
    }

    // 5. MAIN EXECUTION
    async function runChallengeFlow() {
        const existing = document.getElementById('biketerra-challenges-widget');
        if (existing) { existing.remove(); return; }

        const pageData = await getBikeTerraData();
        if (!pageData.token) {
            console.log('[BikeTerra] Token not found even on dashboard.');
            return;
        }

        const challenges = await fetchAllChallenges(pageData.token);
        await displayChallenges(challenges, pageData);
    }

    function addChallengeButton() {
        if (document.getElementById('biketerra-challenges-btn')) return;
        const button = document.createElement('button');
        button.id = 'biketerra-challenges-btn';
        button.textContent = '🚴 Challenges';
        button.style.cssText = `position: fixed; bottom: 20px; right: 20px; background: #4CAF50; color: white; border: none; border-radius: 25px; padding: 12px 24px; font-size: 16px; cursor: pointer; box-shadow: 0 4px 6px rgba(0,0,0,0.2); z-index: 9999; font-weight: bold;`;

        button.onclick = async () => {
            button.disabled = true;
            await runChallengeFlow();
            button.disabled = false;
        };
        document.body.appendChild(button);
    }

    // Init
    setTimeout(() => {
        addChallengeButton();
        if (window.location.pathname.includes('/ride')) {
             runChallengeFlow();
        }
    }, 1500);

})();
