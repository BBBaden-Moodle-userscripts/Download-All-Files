// ==UserScript==
// @name         Moodle File Downloader 2
// @namespace    http://tampermonkey.net/
// @version      2
// @description  Download files from Moodle and create a zip archive with progress bar
// @author       PianoNic
// @downloadURL  https://github.com/BBBaden-Moodle-userscripts/Download-All-Files/raw/main/download-all-files.user.js
// @updateURL    https://github.com/BBBaden-Moodle-userscripts/Download-All-Files/raw/main/download-all-files.user.js
// @homepageURL  https://github.com/BBBaden-Moodle-userscripts/Download-All-Files
// @supportURL   https://github.com/BBBaden-Moodle-userscripts/Download-All-Files/issues
// @match        https://moodle.bbbaden.ch/course/view.php*
// @grant        GM_download
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js
// @icon         https://github.com/BBBaden-Moodle-userscripts/Download-All-Files/blob/main/ico/icon.png?raw=true
// ==/UserScript==

(async function () {
    'use strict';

    // Get initial Values
    const title = document.querySelector('div.page-header-headings h1.h2').textContent.trim();
    const sanitizedTitle = title.replace(/[\\/:"*?<>|]/g, '');

    const resourceDivs = document.querySelectorAll('li.activity.activity-wrapper.resource.modtype_resource');
    const urls = [];

    resourceDivs.forEach(div => {
        const links = div.querySelectorAll("a[href]");
        links.forEach(link => {
            urls.push(link.href);
        });
    });
    let totalFiles = urls.length;
    let hundertPercent = 100 / totalFiles;

    const zip = new JSZip();
    let successCount = 0;

    // Setup Element
    //// Card
    const card = document.createElement('section');
    card.className = 'card';

    const padding = document.createElement('div');
    padding.className = 'p-3';

    //// Title
    const cardTitle = document.createElement('h5');
    cardTitle.textContent = 'Download All Files';

    //// Spacing
    const spacing = document.createElement('div');
    spacing.className = 'mt-3';

    //// Download Button
    const downloadButton = document.createElement('button');
    downloadButton.className = 'btn btn-outline-secondary btn-sm';
    downloadButton.id = "download_button";
    downloadButton.textContent = 'Download';
    downloadButton.addEventListener('click', async () => await downloadAndUpdateProgressBar());

    //// Progress Bar
    const progress = document.createElement('div');
    progress.className = 'progress';
    progress.id = "progressbar";
    progress.style.display = "none";

    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar progress-bar-striped progress-bar-animated';
    progressBar.role = 'progressbar';
    progressBar.style.width = '0%';
    progressBar.setAttribute('aria-valuenow', 0);
    progressBar.setAttribute('aria-valuemin', 0);
    progressBar.setAttribute('aria-valuemax', 100);

    progress.appendChild(progressBar);

    padding.appendChild(cardTitle);
    padding.appendChild(spacing);
    padding.appendChild(downloadButton);
    padding.appendChild(progress);

    card.appendChild(padding);

    document.getElementById('block-region-side-pre').appendChild(card);

    async function downloadAndUpdateProgressBar() {
        document.getElementById('download_button').style.display = 'none';
        document.getElementById('progressbar').style.display = '';
        for (const href of urls) {
            try {
                const { response, blob } = await fetchFile(href);
                const contentHeader = response.headers.get('content-disposition');
                const fileName = contentHeader.match(/filename="(.+)"/)[1];
                zip.file(fileName, blob);
            } catch (error) {
                try {
                    const { response, blob } = await fetchFile(href);
                    const contentHeader = response.headers.get('content-disposition');
                    const fileName = contentHeader.match(/filename="(.+)"/)[1];
                    zip.file(fileName, blob);
                } catch (error) {
                    try {
                        const { response, blob } = await fetchFile(href);
                        const contentHeader = response.headers.get('content-disposition');
                        const fileName = contentHeader.match(/filename="(.+)"/)[1];
                        zip.file(fileName, blob);
                    } catch (error) {
                        console.error("Giving up after 3 tries");
                        totalFiles -= 1;
                        hundertPercent = 100 / totalFiles;
                    }
                }
            } finally {
                if (totalFiles > 0) {
                    successCount += 1;
                    progressBar.style.width = (hundertPercent * successCount) + '%';
                    progressBar.setAttribute('aria-valuenow', hundertPercent * successCount);
                    progressBar.textContent = Math.round(hundertPercent * successCount) + '%'
                    console.log((hundertPercent * successCount)+"%");
                }
            }
        }
        // After all downloads are finished, generate the zip file
        const content = await zip.generateAsync({ type: 'blob' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(content);
        a.download = `${sanitizedTitle}.zip`;
        a.click();
    }

    async function fetchFile(href) {
        const response = await fetch(href);
        const blob = await response.blob();
        return { response, blob };
    }

})();
