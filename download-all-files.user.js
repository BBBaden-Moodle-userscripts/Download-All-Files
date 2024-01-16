// ==UserScript==
// @name         Moodle File Downloader with Progress Bar
// @namespace    http://tampermonkey.net/
// @version      0.3
//
// @description  Download files from Moodle and create a zip archive with progress bar
// @author       PianoNic
//
// @downloadURL https://github.com/BBBaden-Moodle-userscripts/Download-All-Files/raw/main/download-all-files.user.js
// @updateURL   https://github.com/BBBaden-Moodle-userscripts/Download-All-Files/raw/main/download-all-files.user.js
// @homepageURL https://github.com/BBBaden-Moodle-userscripts/Download-All-Files
// @supportURL  https://github.com/BBBaden-Moodle-userscripts/Download-All-Files/issues
//
// @match        https://moodle.bbbaden.ch/course/view.php*
// @grant        GM_download
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js
// @icon         https://github.com/BBBaden-Moodle-userscripts/Download-All-Files/blob/main/ico/icon.png?raw=true
// ==/UserScript==

(function () {
    'use strict';

    function sanitizeFilename(filename) {
        const illegalCharsRegex = /[\\/:"*?<>|]/g;
        const sanitizedFilename = filename.replace(illegalCharsRegex, '');
        return sanitizedFilename.replace(/ /g, '_');
    }

    function downloadFile(url) {
        return fetch(url)
            .then(response => {
                if (response.ok) {
                    return { response, blob: response.blob() };
                } else {
                    throw new Error(`Failed to download file. Status code: ${response.status}`);
                }
            });
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

        downloadButton.addEventListener('click', () => {
            callback();
            // Hide the button after clicking to prevent multiple clicks
            downloadButton.style.display = 'none';
            cardTextDiv.appendChild(progressBar);
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

    function generateZipAndDownload(zip, sanitizedTitle) {
        zip.generateAsync({ type: 'blob' })
            .then(blob => {
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
            });
    }


    function main() {
        const h1Tag = document.querySelector('div.page-header-headings h1.h2');
        const title = h1Tag.textContent.trim();
        const sanitizedTitle = sanitizeFilename(title);

        const activityDivs = document.querySelectorAll('div.activityname');
        const zip = new JSZip();
        const downloadPromises = [];
        const totalFiles = activityDivs.length;
        let filesDownloaded = 0;

        let successCount = 0;
        let failureCount = 0;
        const failedLinks = [];

        activityDivs.forEach((div, index) => {
            const anchor = div.querySelector('a.aalink.stretched-link');
            const statusSpan = document.createElement('span'); // Create a span for status

            if (anchor) {
                const href = anchor.getAttribute('href');
                if (href.includes('mod/resource')) {
                    const downloadPromise = downloadFile(href)
                        .then(({ response, blob }) => {
                            const contentHeader = response.headers.get('content-disposition');
                            const fileName = contentHeader.match(/filename="(.+)"/)[1];
                            zip.file(fileName, blob);
                            statusSpan.textContent = ' "✅ Successfully added to Archive"'; // Success indicator
                            console.log('Downloaded and added to zip:', fileName, "Filename:", href);
                            successCount += 1;
                        })
                        .catch(error => {
                            statusSpan.textContent = ' "❌ Failed adding to Archive"'; // Error indicator
                            console.error(error, "At Downloadlink:", href);
                            failureCount += 1;
                            failedLinks.push(href);
                        })
                        .finally(() => {
                            filesDownloaded += 1;
                            updateProgressBar((filesDownloaded / totalFiles) * 100);
                        });

                    downloadPromises.push(downloadPromise);
                    anchor.appendChild(statusSpan); // Append the status indicator to the anchor element
                }
            }
        });

        Promise.all(downloadPromises)
            .then(() => {
                generateZipAndDownload(zip, sanitizedTitle);
                const reportSection = document.getElementById('report');

                // Create elements to display the values
                const successCountElement = document.createElement('p');
                successCountElement.textContent = `Success Count: ${successCount}`;

                const failureCountElement = document.createElement('p');
                failureCountElement.textContent = `Failure Count: ${failureCount}`;

                const failedLinksElement = document.createElement('ul');
                failedLinksElement.innerHTML = failedLinks.map(link => `<li><a href="${link}" target="_blank">${link}</a></li>`).join('');

                // Append elements to the section
                reportSection.appendChild(successCountElement);
                reportSection.appendChild(failureCountElement);
                reportSection.appendChild(failedLinksElement);
            });
    }

    const asideElement = document.getElementById('block-region-side-pre');
    if (asideElement) {
        asideElement.appendChild(createDownloadButton(main));
    }
})();
