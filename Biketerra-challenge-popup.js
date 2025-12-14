// ==UserScript==
// @name         BikeTerra Challenge List
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Fetch and display BikeTerra challenges
// @author       You
// @match        https://biketerra.com/*
// @match        https://www.biketerra.com/*
// @grant        GM_xmlhttpRequest
// @connect      api.biketerra.com
// @connect      biketerra.com
// ==/UserScript==

(function() {
    'use strict';

    // Configuration
    const API_URL = 'https://api.biketerra.com/challenge/list';

    // Function to get user token (you'll need to adapt this to how BikeTerra stores tokens)
    function getUserToken() {
        // Check localStorage
        const token = localStorage.getItem('biketerra_token') ||
                     localStorage.getItem('token') ||
                     sessionStorage.getItem('biketerra_token') ||
                     sessionStorage.getItem('token');

        if (token) return token;

        // Check cookies
        const cookies = document.cookie.split(';');
        for (let cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'biketerra_token' || name === 'token') {
                return value;
            }
        }

        return null;
    }

    // Function to fetch challenges
    function fetchChallenges(token, options = {}) {
        const payload = {
            token: token,
            per_page: options.per_page || 8,
            paged: options.paged || 1,
            status: options.status || "",
            keywords: options.keywords || ""
        };

        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: API_URL,
                headers: {
                    'Content-Type': 'application/json'
                },
                data: JSON.stringify(payload),
                onload: function(response) {
                    try {
                        const data = JSON.parse(response.responseText);
                        if (data.ok) {
                            resolve(data.msg);
                        } else {
                            reject(new Error('API returned ok: false'));
                        }
                    } catch (e) {
                        reject(e);
                    }
                },
                onerror: function(error) {
                    reject(error);
                }
            });
        });
    }

    // Function to fetch challenge progress by scraping the challenge page
    function fetchChallengeProgress(challengeId) {
        return new Promise((resolve) => {
            console.log(`[BikeTerra] Fetching progress for challenge ${challengeId}`);
            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://biketerra.com/challenges/${challengeId}`,
                onload: function(response) {
                    try {
                        console.log(`[BikeTerra] Got response for challenge ${challengeId}, status:`, response.status);

                        // Parse the HTML response
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(response.responseText, 'text/html');

                        // Debug: log what we found
                        const progressDiv = doc.querySelector('.challenge-progress');
                        console.log('[BikeTerra] Found .challenge-progress:', progressDiv);

                        if (progressDiv) {
                            const valElement = progressDiv.querySelector('.val');
                            console.log('[BikeTerra] Found .val element:', valElement, valElement?.textContent);

                            const barFill = progressDiv.querySelector('.bar-fill');
                            console.log('[BikeTerra] Found .bar-fill:', barFill, barFill?.style.width);

                            // Try to get percentage from .val element
                            if (valElement) {
                                const percentText = valElement.textContent.trim();
                                const percent = parseFloat(percentText.replace('%', ''));
                                if (!isNaN(percent)) {
                                    console.log('[BikeTerra] Successfully parsed percentage:', percent);
                                    resolve({
                                        percentage: percent,
                                        hasProgress: true
                                    });
                                    return;
                                }
                            }

                            // Fallback: try to get from style
                            if (barFill && barFill.style.width) {
                                const stylePercent = parseFloat(barFill.style.width);
                                if (!isNaN(stylePercent)) {
                                    console.log('[BikeTerra] Using style width percentage:', stylePercent);
                                    resolve({
                                        percentage: stylePercent,
                                        hasProgress: true
                                    });
                                    return;
                                }
                            }
                        }

                        // Try alternate selectors
                        const altProgress = doc.querySelector('.progress .val');
                        if (altProgress) {
                            console.log('[BikeTerra] Found alternate .progress .val:', altProgress.textContent);
                            const percent = parseFloat(altProgress.textContent.replace('%', ''));
                            if (!isNaN(percent)) {
                                resolve({
                                    percentage: percent,
                                    hasProgress: true
                                });
                                return;
                            }
                        }

                        console.log('[BikeTerra] No progress data found');
                        resolve(null);
                    } catch (e) {
                        console.error('[BikeTerra] Error parsing progress:', e);
                        resolve(null);
                    }
                },
                onerror: function(error) {
                    console.error('[BikeTerra] Request error:', error);
                    resolve(null);
                }
            });
        });
    }

    // Function to create a progress bar
    function createProgressBar(percentage, goal) {
        const current = Math.round((percentage / 100) * goal);

        const progressContainer = document.createElement('div');
        progressContainer.style.cssText = `
            margin-top: 10px;
            clear: both;
        `;

        const progressBarBg = document.createElement('div');
        progressBarBg.style.cssText = `
            width: 100%;
            height: 24px;
            background: #e0e0e0;
            border-radius: 12px;
            overflow: hidden;
            position: relative;
        `;

        const progressBarFill = document.createElement('div');
        progressBarFill.style.cssText = `
            width: ${percentage}%;
            height: 100%;
            background: linear-gradient(90deg, #4CAF50, #45a049);
            transition: width 0.3s ease;
        `;

        const progressText = document.createElement('div');
        progressText.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            font-weight: bold;
            color: ${percentage > 50 ? 'white' : '#333'};
            text-shadow: ${percentage > 50 ? '0 1px 2px rgba(0,0,0,0.2)' : 'none'};
        `;
        progressText.textContent = `${current.toLocaleString()}m / ${goal.toLocaleString()}m (${percentage.toFixed(1)}%)`;

        progressBarBg.appendChild(progressBarFill);
        progressBarBg.appendChild(progressText);
        progressContainer.appendChild(progressBarBg);

        return progressContainer;
    }

    // Function to display challenges
    async function displayChallenges(challenges, token) {
        // Create a container for the challenges
        const container = document.createElement('div');
        container.id = 'biketerra-challenges-widget';
        container.style.cssText = `
            position: fixed;
            top: 8px;
            left: 8px;
        background: rgba(0,0,0,0.5);
            border-radius: 8px;
            padding: 15px;
            max-width: 600px;
            max-height: 600px;
            overflow-y: auto;
            z-index: 1;
        font-family: "Overpass", sans-serif;
        `;

        // Auto-close after 15 seconds
        setTimeout(() => {
            if (container.parentNode) {
                container.remove();
            }
        }, 15000);

        // Display challenge results
        if (challenges.results && challenges.results.length > 0) {
            for (const challenge of challenges.results) {
                const challengeDiv = document.createElement('div');
                challengeDiv.style.cssText = `
                    margin-bottom: 15px;
                    padding: 12px;
                    background: rgba(255,255,255,0.5);
                    border-radius: 6px;
                    cursor: pointer;
                    transition: background 0.2s;
                `;

                challengeDiv.onmouseover = () => challengeDiv.style.background = '#ebebeb';
                challengeDiv.onmouseout = () => challengeDiv.style.background = '#f5f5f5';

                challengeDiv.onclick = () => window.open(`https://biketerra.com/challenges/${challenge.id}`, '_blank');

                const rules = JSON.parse(challenge.rules);

                // Add image if available
                let imageHTML = '';
                if (challenge.has_image) {
                    // Use the updated_on timestamp for cache busting
                    const timestamp = challenge.updated_on.replace(/[^0-9]/g, '');
                    imageHTML = `
                        <img src="https://biketerra.nyc3.cdn.digitaloceanspaces.com/challenges/${challenge.id}.webp?${timestamp}"
                             alt="${challenge.title}"
                             style="width: 20%; aspect-ratio: 1/1; object-fit: cover; border-radius: 6px; float: left; margin-right: 12px;"
                             onerror="this.style.display='none'">
                    `;
                }

                challengeDiv.innerHTML = `
                    ${imageHTML}
                    <div style="overflow: hidden;">
                        <h4 style="margin: 0 0 8px 0; color: #333;">${challenge.title}</h4>
                        <p style="margin: 5px 0; color: #666; font-size: 14px;">${challenge.blurb}</p>
                        <p style="margin: 5px 0; font-size: 13px;"><strong>Goal:</strong> ${rules.totalElevation ? rules.totalElevation.toLocaleString() + 'm elevation' : 'See details'}</p>
                        <p style="margin: 5px 0; font-size: 13px;"><strong>Period:</strong> ${challenge.valid_from} to ${challenge.valid_to}</p>
                    </div>
                    <div style="clear: both;"></div>
                `;

                // Try to fetch and display progress
                if (rules.totalElevation) {
                    const progressData = await fetchChallengeProgress(challenge.id);
                    if (progressData && progressData.hasProgress) {
                        const progressBar = createProgressBar(progressData.percentage, rules.totalElevation);
                        // Add progress bar after the clear div
                        const clearDiv = challengeDiv.querySelector('[style*="clear: both"]');
                        if (clearDiv && clearDiv.parentNode) {
                            clearDiv.parentNode.insertBefore(progressBar, clearDiv);
                        }
                    } else {
                        // Add a placeholder for progress
                        const progressNote = document.createElement('p');
                        progressNote.style.cssText = 'margin: 8px 0 0 0; font-size: 12px; color: #888; font-style: italic; clear: both;';
                        progressNote.textContent = 'Click to view progress on website';
                        challengeDiv.appendChild(progressNote);
                    }
                }

                container.appendChild(challengeDiv);
            }
        } else {
            const noResults = document.createElement('p');
            noResults.textContent = 'No challenges found.';
            noResults.style.color = '#666';
            container.appendChild(noResults);
        }

        document.body.appendChild(container);
    }

    // Function to check if we're on a ride/event page
    function isRideOrEventPage() {
        const path = window.location.pathname;
        // Adjust these patterns based on actual BikeTerra URL structure
        return path.includes('/ride') || path.includes('/event') || path.includes('/activity');
    }

    // Function to automatically show challenges on ride/event pages
    async function autoShowChallenges() {
        if (!isRideOrEventPage()) {
            return;
        }

        const token = getUserToken();
        if (!token) {
            console.log('[BikeTerra] No token found, cannot auto-show challenges');
            return;
        }

        try {
            console.log('[BikeTerra] Auto-showing challenges on ride/event page');
            const challenges = await fetchChallenges(token);
            await displayChallenges(challenges, token);
        } catch (error) {
            console.error('[BikeTerra] Error auto-showing challenges:', error);
        }
    }

    // Function to add a button to trigger the challenge fetch
    function addChallengeButton() {
        const button = document.createElement('button');
        button.textContent = '🚴 Challenges';
        button.id = 'biketerra-challenges-btn';
        button.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #4CAF50;
            color: white;
            border: none;
            border-radius: 25px;
            padding: 12px 24px;
            font-size: 16px;
            cursor: pointer;
            box-shadow: 0 4px 6px rgba(0,0,0,0.2);
            z-index: 9999;
            font-weight: bold;
        `;

        button.onmouseover = () => button.style.background = '#45a049';
        button.onmouseout = () => button.style.background = '#4CAF50';

        button.onclick = async () => {
            // Remove existing widget if present
            const existing = document.getElementById('biketerra-challenges-widget');
            if (existing) {
                existing.remove();
                return;
            }

            const token = getUserToken();
            if (!token) {
                alert('Could not find BikeTerra authentication token. Please make sure you are logged in.');
                return;
            }

            try {
                button.textContent = '⏳ Loading...';
                button.disabled = true;

                const challenges = await fetchChallenges(token);
                await displayChallenges(challenges, token);

                button.textContent = '🚴 Challenges';
                button.disabled = false;
            } catch (error) {
                console.error('Error fetching challenges:', error);
                alert('Error fetching challenges: ' + error.message);
                button.textContent = '🚴 Challenges';
                button.disabled = false;
            }
        };

        document.body.appendChild(button);
    }

    // Initialize when page loads
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            addChallengeButton();
            // Wait a bit for the page to fully load before auto-showing
            setTimeout(autoShowChallenges, 1000);
        });
    } else {
        addChallengeButton();
        setTimeout(autoShowChallenges, 1000);
    }

    // Also expose the function globally for manual use
    window.biketerraGetChallenges = async function(options = {}) {
        const token = getUserToken();
        if (!token) {
            console.error('No token found');
            return null;
        }
        return await fetchChallenges(token, options);
    };

})();
