// Install Node.js
// download/copy&paste the code into a <choose your name>.js
// open the folder where the file is saved and run npm install puppeteer csv-writer readline-sync dayjs
// still in the same folder run the script with node <choose your name>.js

const puppeteer = require('puppeteer');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const readlineSync = require('readline-sync');
const dayjs = require('dayjs');

(async () => {

    // Helper: parse relative time string to absolute timestamp
    function parseRelativeEventTime(text) {
        const regex = /Starts in\s*(?:(\d+)\s*hr)?\s*(?:(\d+)\s*min)?/i;
        const match = text.match(regex);
        if (!match) return null;

        const hours = parseInt(match[1] || "0");
        const minutes = parseInt(match[2] || "0");

        return dayjs().add(hours, 'hour').add(minutes, 'minute');
    }

    // Ask for the event URL
    const eventURL = readlineSync.question('Enter the Biketerra event URL: ');
    if (!eventURL.startsWith('http')) {
        console.log('Invalid URL. Exiting.');
        process.exit(1);
    }

    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(eventURL, { waitUntil: 'networkidle2' });

    // Scrape event start time
    const eventTimeText = await page.$eval('.event-time', el => el.textContent.trim());
    console.log(`Event time found: ${eventTimeText}`);

    const eventTime = parseRelativeEventTime(eventTimeText);
    if (!eventTime) {
        console.warn('Unable to parse event time, monitoring will not work.');
    } else {
        console.log(`Event absolute time: ${eventTime.format()}`);
        console.log(`Minutes until event: ${eventTime.diff(dayjs(), 'minute')}`);
    }

    // Ask if user wants to monitor
    const monitor = readlineSync.keyInYNStrict('Do you want to monitor this event?');
    let startBeforeMinutes = 0;
    let intervalSeconds = 60;

    if (monitor) {
        startBeforeMinutes = readlineSync.questionInt(
            'How many minutes before the event should monitoring start? '
        );
        intervalSeconds = readlineSync.questionInt(
            'How often should the bot grab data (interval in seconds)? '
        );
    }

    // Store attendees in memory
    let recorded = new Map();

    // Scrape attendees from page and replace the recorded map
    async function scrapeAttendees() {
        const currentAttendees = await page.evaluate(() => {
            const result = [];
            const grid = document.querySelector('.event-grid');
            if (!grid) return result;

            const labels = grid.querySelectorAll('.event-label');
            const values = grid.querySelectorAll('.event-value');

            for (let i = 0; i < labels.length; i++) {
                if (labels[i].textContent.trim().startsWith("Attendees")) {
                    const tagItems = values[i].querySelectorAll('.tag-item');
                    tagItems.forEach(tag => {
                        result.push({
                            name: tag.textContent.trim(),
                            link: tag.href || ''
                        });
                    });
                    break;
                }
            }
            return result;
        });

        // Update recorded map to match current attendees
        recorded.clear();
        currentAttendees.forEach(a => {
            const key = a.link || a.name;
            recorded.set(key, a);
        });

        if (currentAttendees.length > 0) {
            console.groupCollapsed(`Current attendees (${currentAttendees.length})`);
            currentAttendees.forEach(a => console.log(a.name));
            console.groupEnd();
        }

        return currentAttendees;
    }

    async function downloadCSV() {
        if (!recorded.size) return;
        const csvWriter = createCsvWriter({
            path: 'attendees.csv',
            header: [
                { id: 'name', title: 'Name' },
               // { id: 'link', title: 'Link' }
            ]
        });
        await csvWriter.writeRecords(Array.from(recorded.values()));
        console.log(`CSV updated: ${recorded.size} attendees`);
    }

    async function monitorEvent() {
        if (!eventTime) return;

        const now = dayjs();
        const startMonitoringAt = eventTime.subtract(startBeforeMinutes, 'minute');
        const waitMs = startMonitoringAt.diff(now);

        if (waitMs > 0) {
            console.log(`Waiting ${Math.round(waitMs / 1000 / 60)} minutes until monitoring starts...`);
            await new Promise(resolve => setTimeout(resolve, waitMs));
        } else {
            console.log('Event start time is within the start window, starting immediately.');
        }

        console.log('Monitoring started...');

        setInterval(async () => {
            await page.reload({ waitUntil: 'networkidle2' }); // reload to get new attendees
            await scrapeAttendees();
            await downloadCSV();
        }, intervalSeconds * 1000);
    }

    // Initial scrape
    await scrapeAttendees();
    await downloadCSV();

    if (monitor) {
        await monitorEvent();
    } else {
        console.log('Monitoring skipped.');
    }

})();
