// ==UserScript==
// @name         Moodle File Downloader
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Download files from Moodle and create a zip archive
// @author       PianoNic
// @match        https://moodle.bbbaden.ch/course/view.php*
// @grant        GM_download
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js
// @icon         https://cdn.discordapp.com/attachments/1014802078201286807/1192031054807179364/MoodleDownload.png
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

    function createDownloadButton(callback) {
        const section = document.createElement('section');
        section.classList.add('block_html', 'block', 'card', 'mb-3');
        section.setAttribute('role', 'complementary');
        section.setAttribute('data-block', 'html');

        const div = document.createElement('div');
        div.classList.add('card-body', 'p-3');

        const h5 = document.createElement('h5');
        h5.id = 'instance-20663-header';
        h5.classList.add('card-title', 'd-inline');
        h5.textContent = 'Download All Files';

        const cardTextDiv = document.createElement('div');
        cardTextDiv.classList.add('card-text', 'content', 'mt-3');

        const downloadButton = document.createElement('button');
        downloadButton.classList.add('btn', 'btn-outline-secondary', 'btn-sm', 'text-nowrap');
        downloadButton.textContent = 'Download';

        downloadButton.addEventListener('click', callback);

        cardTextDiv.appendChild(downloadButton);
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
            });
    }

    function main() {
        const h1Tag = document.querySelector('div.page-header-headings h1.h2');
        const title = h1Tag.textContent.trim();
        const sanitizedTitle = sanitizeFilename(title);

        const activityDivs = document.querySelectorAll('div.activityname');
        const zip = new JSZip();
        const downloadPromises = [];

        activityDivs.forEach(div => {
            const anchor = div.querySelector('a.aalink.stretched-link');
            if (anchor) {
                const href = anchor.getAttribute('href');
                if (href.includes('mod/resource')) {
                    const downloadPromise = downloadFile(href)
                        .then(({ response, blob }) => {
                            const contentHeader = response.headers.get('content-disposition');
                            const fileName = contentHeader.match(/filename="(.+)"/)[1];
                            zip.file(fileName, blob);
                            console.log('Downloaded and added to zip:', fileName);
                        })
                        .catch(error => console.error(error));
                    downloadPromises.push(downloadPromise);
                }
            }
        });

        Promise.all(downloadPromises)
            .then(() => generateZipAndDownload(zip, sanitizedTitle));
    }

    const asideElement = document.getElementById('block-region-side-pre');
    if (asideElement) {
        asideElement.appendChild(createDownloadButton(main));
    }
})();
