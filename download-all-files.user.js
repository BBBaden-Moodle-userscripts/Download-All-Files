// ==UserScript==
// @name         Moodle File Downloader
// @namespace    http://tampermonkey.net/
// @version      0.5
// @description  Download files from Moodle and create a zip archive with progress bar
// @author       PianoNic
// @downloadURL https://github.com/BBBaden-Moodle-userscripts/Download-All-Files/raw/main/download-all-files.user.js
// @updateURL   https://github.com/BBBaden-Moodle-userscripts/Download-All-Files/raw/main/download-all-files.user.js
// @homepageURL https://github.com/BBBaden-Moodle-userscripts/Download-All-Files
// @supportURL  https://github.com/BBBaden-Moodle-userscripts/Download-All-Files/issues
// @match        https://moodle.bbbaden.ch/course/view.php*
// @grant        GM_download
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js
// @icon         https://github.com/BBBaden-Moodle-userscripts/Download-All-Files/blob/main/ico/icon.png?raw=true
// ==/UserScript==

(async function () {
    'use strict';

    async function fetchFile(url, retries = 2) {
        while (retries > 0) {
            try {
                const response = await fetch(url);
                if (response.ok) {
                    const blob = await response.blob();
                    return { response, blob };
                } else {
                    throw new Error(`Failed to download file. Status code: ${response.status}`);
                }
            } catch (error) {
                console.error(error, `Retrying... (Retries left: ${retries})`, "At Downloadlink:", url);
                retries -= 1;
            }
        }

        console.error("No more retries. Skipping...", "At Downloadlink:", url);
        throw new Error("Failed to download file.");
    }

    function createProgressBar() {
        const progressBar = document.createElement('progress');
        progressBar.id = 'download-progress';
        progressBar.value = 0;
        progressBar.max = 100;
        return progressBar;
    }

    function updateProgressBar(percentage) {
        const progressBar = document.getElementById('download-progress');
        if (progressBar) {
            progressBar.value = percentage;
        }
    }

    function createDownloadButton(callback) {
        const section = document.createElement('section');
        section.classList.add('card');

        const div = document.createElement('div');
        div.classList.add('p-3');

        const h5 = document.createElement('h5');
        h5.textContent = 'Download All Files';

        const cardTextDiv = document.createElement('div');
        cardTextDiv.classList.add('mt-3');

        const downloadButton = document.createElement('button');
        downloadButton.classList.add('btn', 'btn-outline-secondary', 'btn-sm');
        downloadButton.textContent = 'Download';

        const progressBar = createProgressBar();

        downloadButton.addEventListener('click', async () => {
            callback();
            // Hide the button after clicking to prevent multiple clicks
            downloadButton.style.display = 'none';
            cardTextDiv.appendChild(progressBar);

            await new Promise(resolve => {
                const interval = setInterval(() => {
                    if (progressBar.value === 100) {
                        clearInterval(interval);
                        resolve();
                    }
                }, 100);
            });
        });

        const reportDiv = document.createElement('div');
        reportDiv.id = "report";

        cardTextDiv.appendChild(downloadButton);
        cardTextDiv.appendChild(reportDiv);
        div.appendChild(h5);
        div.appendChild(cardTextDiv);
        section.appendChild(div);

        return section;
    }

    async function generateZipAndDownload(zip, sanitizedTitle) {
        const blob = await zip.generateAsync({ type: 'blob' });

        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = sanitizedTitle + '.zip';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Hide the download button and progress bar
        const downloadButton = document.querySelector('.btn.btn-outline-secondary.btn-sm');
        const progressBar = document.getElementById('download-progress');
        if (downloadButton) {
            downloadButton.style.display = 'none';
        }
        if (progressBar) {
            progressBar.style.display = 'none';
        }
    }

    async function main() {
        const h1Tag = document.querySelector('div.page-header-headings h1.h2');
        const title = h1Tag.textContent.trim();
        const sanitizedTitle = title.replace(/[\\/:"*?<>|]/g, '').replace(/ /g, '_');

        const activityDivs = document.querySelectorAll('div.modtype_resource');
        const zip = new JSZip();
        const totalFiles = activityDivs.length;
        let filesDownloaded = 0;

        let successCount = 0;
        let failureCount = 0;
        const failedLinks = [];
        const successfulDownloads = [];
        const failedDownloads = [];

        // Function to create a badge element asynchronously
        async function createBadgeAsync(color, message) {
            var badge = document.createElement("span");

            badge.className = "badge badge-pill";
            badge.style.backgroundColor = color;

            var strong = document.createElement("strong");

            strong.textContent = message;

            badge.appendChild(strong);

            return badge;
        }

        async function downloadWithRetry(href) {
            var badgeDiv;

            try {
                const { response, blob } = await fetchFile(href);
                const contentHeader = response.headers.get('content-disposition');
                const fileName = contentHeader.match(/filename="(.+)"/)[1];
                zip.file(fileName, blob);
                badgeDiv = await createBadgeAsync("green", "Erfolgreiches Speichern im Archiv!");
                successCount += 1;
                successfulDownloads.push({ fileName, href });
            } catch (error) {
                badgeDiv = await createBadgeAsync("red", "Fehler beim Speichern im Archiv!");
                failureCount += 1;
                failedLinks.push(href);
                failedDownloads.push(href);
            } finally {
                filesDownloaded += 1;
                updateProgressBar((filesDownloaded / totalFiles) * 100);
            }

            return badgeDiv;
        }

        for (const div of activityDivs) {
            const anchor = div.querySelector('a.aalink.stretched-link');
            if (anchor) {
                const href = anchor.getAttribute('href');
                if (href.includes('mod/resource')) {
                    const status = await downloadWithRetry(href);
                    div.appendChild(status);
                }
            }
        }

        generateZipAndDownload(zip, sanitizedTitle);

        const reportSection = document.getElementById('report');

        const successCountElement = document.createElement('p');
        successCountElement.textContent = `Success Count: ${successCount}`;

        const failureCountElement = document.createElement('p');
        failureCountElement.textContent = `Failure Count: ${failureCount}`;

        const failedLinksElement = document.createElement('ul');
        failedLinksElement.innerHTML = failedLinks.map(link => `<li><a href="${link}" target="_blank">${link}</a></li>`).join('');

        reportSection.appendChild(successCountElement);
        reportSection.appendChild(failureCountElement);
        reportSection.appendChild(failedLinksElement);

        // Display table in the console for successful and failed downloads
        console.table([
            { 'Status': 'Success', 'Count': successCount },
            { 'Status': 'Failed', 'Count': failureCount }
        ]);
    }

    const asideElement = document.getElementById('block-region-side-pre');
    if (asideElement) {
        asideElement.appendChild(createDownloadButton(main));
    }
  console.log("Loaded Moodle Files Downloader!")
})();
