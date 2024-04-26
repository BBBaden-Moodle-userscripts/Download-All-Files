// ==UserScript==
// @name         Moodle File Downloader
// @namespace    http://tampermonkey.net/
// @version      1.6
// @description  Download files from Moodle and create a zip archive with progress bar
// @author       PianoNic
// @downloadURL https://github.com/BBBaden-Moodle-userscripts/Download-All-Files/raw/main/download-all-files.user.js
// @updateURL   https://github.com/BBBaden-Moodle-userscripts/Download-All-Files/raw/main/download-all-files.user.js
// @homepageURL https://github.com/BBBaden-Moodle-userscripts/Download-All-Files
// @supportURL  https://github.com/BBBaden-Moodle-userscripts/Download-All-Files/issues
// @match        https://moodle.bbbaden.ch/course/view.php*
// @grant        GM_download
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.slim.min.js
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
        return $('<progress>', {
            id: 'download-progress',
            value: 0,
            max: 100
        });
    }

    function updateProgressBar(percentage) {
        $('#download-progress').val(percentage);
    }

    function createDownloadButton(callback) {
        var section = $('<section>').addClass('card');
        var div = $('<div>').addClass('p-3');
        var h5 = $('<h5>').text('Download All Files');
        var cardTextDiv = $('<div>').addClass('mt-3');
        var downloadButton = $('<button>').addClass('btn btn-outline-secondary btn-sm').text('Download');
        var progressBar = createProgressBar();
        var reportDiv = $('<div>').attr('id', 'report');

        downloadButton.on('click', async () => {

            downloadButton.hide();
            cardTextDiv.append(progressBar);
            await callback();

            await new Promise(resolve => {
                const interval = setInterval(() => {
                    if (progressBar.val() === 100) {
                        clearInterval(interval);
                        resolve();
                    }
                }, 100);
            });
        });

        cardTextDiv.append(downloadButton, reportDiv);
        div.append(h5, cardTextDiv);
        section.append(div);

        return section;
    }

    async function generateZipAndDownload(zip, sanitizedTitle) {
        const blob = await zip.generateAsync({ type: 'blob' });
        const link = $('<a>', {
            href: URL.createObjectURL(blob),
            download: sanitizedTitle + '.zip'
        }).appendTo('body');

        link[0].click();
        link.remove();
        $('.btn.btn-outline-secondary.btn-sm, #download-progress').hide();
    }

    async function main() {
        const title = $('div.page-header-headings h1.h2').text().trim();
        const sanitizedTitle = title.replace(/[\\/:"*?<>|]/g, '').replace(/ /g, '_');

        const activityDivs = $('div.activity-grid ');
        const zip = new JSZip();
        const totalFiles = activityDivs.length;
        let filesDownloaded = 0;

        let successCount = 0;
        let failureCount = 0;
        const failedLinks = [];
        const successfulDownloads = [];
        const failedDownloads = [];

        async function downloadWithRetry(href) {
            try {
                const { response, blob } = await fetchFile(href);
                const contentHeader = response.headers.get('content-disposition');
                const fileName = contentHeader.match(/filename="(.+)"/)[1];
                zip.file(fileName, blob);
                successCount += 1;
                successfulDownloads.push({ fileName, href });
                return $('<span>').addClass('btn btn-success btn-sm text-nowrap').css('background-color', 'green').text('Erfolgreiches Speichern im Archiv!');
            } catch (error) {
                failureCount += 1;
                failedLinks.push(href);
                failedDownloads.push(href);
                return $('<span>').addClass('btn btn-danger btn-sm text-nowrap').css('background-color', 'red').text('Fehler beim Speichern im Archiv!');
            } finally {
                filesDownloaded += 1;
                updateProgressBar((filesDownloaded / totalFiles) * 100);
            }
        }


         for (const div of activityDivs) {
            const anchor = $(div).find('a.aalink.stretched-link');
            if (anchor.length && anchor.attr('href').includes('mod/resource')) {
                const status = await downloadWithRetry(anchor.attr('href'));
                $(div).append(status);
            }
        }


        await generateZipAndDownload(zip, sanitizedTitle);

        const reportSection = $('#report');
        reportSection.append(`<p>Success Count: ${successCount}</p>`, `<p>Failure Count: ${failureCount}</p>`);
        const failedLinksList = $('<ul>').html(failedLinks.map(link => `<li><a href="${link}" target="_blank">${link}</a></li>`).join(''));
        reportSection.append(failedLinksList);

        console.table([{ 'Status': 'Success', 'Count': successCount }, { 'Status': 'Failed', 'Count': failureCount }]);
    }

    $('#block-region-side-pre').append(createDownloadButton(main));
    console.log("Loaded Moodle Files Downloader!");
})();
