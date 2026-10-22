// ==UserScript==
// @name         Download All Files
// @namespace    http://tampermonkey.net/
// @version      1.7
// @description  Download files from Moodle and create a zip archive with progress bar
// @author       PianoNic
// @downloadURL  https://github.com/BBBaden-Moodle-userscripts/Download-All-Files/raw/main/download-all-files.user.js
// @updateURL    https://github.com/BBBaden-Moodle-userscripts/Download-All-Files/raw/main/download-all-files.user.js
// @homepageURL  https://github.com/BBBaden-Moodle-userscripts/Download-All-Files
// @supportURL   https://github.com/BBBaden-Moodle-userscripts/Download-All-Files/issues
// @match        https://moodle.bbbaden.ch/course/view.php*
// @match        https://moodle.bbbaden.ch/userscript/extensions
// @match        https://lms.bbbaden.ch/course/view.php*
// @match        https://lms.bbbaden.ch/userscript/extensions
// @grant        none
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js
// @require      https://github.com/BBBaden-Moodle-userscripts/LoggingLibrary/raw/refs/heads/main/Logging.lib.user.js
// @require      https://github.com/BBBaden-Moodle-userscripts/UserscriptBridgeLib/raw/main/userscriptBridge.lib.js
// @icon         https://github.com/BBBaden-Moodle-userscripts/Download-All-Files/blob/main/ico/icon.png?raw=true
// ==/UserScript==

(function () {
    'use strict';

    if (UserscriptBridge.registerScript() || !UserscriptBridge.runOnce()) return;
    Logger.info('downloadallfiles', 'v1.7 - Initializing');

    async function fetchFile(url, attempts = 3) {
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`Status code: ${response.status}`);
                return { response, blob: await response.blob() };
            } catch (error) {
                console.error(error, `Attempt ${attempt}/${attempts} failed at`, url);
            }
        }
        throw new Error("Failed to download file.");
    }

    function getFileName(response) {
        const header = response.headers.get('content-disposition') || '';
        const match = header.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
        if (match) return decodeURIComponent(match[1]);
        return decodeURIComponent(new URL(response.url).pathname.split('/').pop()) || 'file';
    }

    function statusBadge(success) {
        const badge = document.createElement('span');
        badge.className = `btn btn-sm text-nowrap ${success ? 'btn-success' : 'btn-danger'}`;
        badge.textContent = success ? 'Erfolgreiches Speichern im Archiv!' : 'Fehler beim Speichern im Archiv!';
        return badge;
    }

    async function downloadAll(progressBar, report) {
        const title = document.querySelector('div.page-header-headings h1')?.textContent.trim() || 'moodle';
        const sanitizedTitle = title.replace(/[\\/:"*?<>|]/g, '').replace(/ /g, '_');

        const resources = [...document.querySelectorAll('div.activity-grid')]
            .map(div => ({ div, anchor: div.querySelector('a.aalink.stretched-link[href*="mod/resource"]') }))
            .filter(r => r.anchor);

        const zip = new JSZip();
        const failedLinks = [];
        let done = 0;

        for (const { div, anchor } of resources) {
            try {
                const { response, blob } = await fetchFile(anchor.href);
                zip.file(getFileName(response), blob);
                div.append(statusBadge(true));
            } catch (error) {
                failedLinks.push(anchor.href);
                div.append(statusBadge(false));
            }
            progressBar.value = (++done / resources.length) * 100;
        }

        const link = document.createElement('a');
        link.href = URL.createObjectURL(await zip.generateAsync({ type: 'blob' }));
        link.download = sanitizedTitle + '.zip';
        link.click();
        URL.revokeObjectURL(link.href);
        progressBar.hidden = true;

        const successCount = resources.length - failedLinks.length;
        report.innerHTML = `<p>Success Count: ${successCount}</p><p>Failure Count: ${failedLinks.length}</p>`;
        const list = document.createElement('ul');
        for (const href of failedLinks) {
            const a = Object.assign(document.createElement('a'), { href, target: '_blank', textContent: href });
            list.appendChild(document.createElement('li')).appendChild(a);
        }
        report.appendChild(list);

        console.table([{ 'Status': 'Success', 'Count': successCount }, { 'Status': 'Failed', 'Count': failedLinks.length }]);
    }

    function createCard() {
        const section = document.createElement('section');
        section.className = 'card mb-3';
        section.innerHTML = `
            <div class="p-3">
                <h5>Download All Files</h5>
                <div class="mt-3">
                    <button class="btn btn-outline-secondary btn-sm">Download</button>
                    <progress value="0" max="100" hidden></progress>
                    <div></div>
                </div>
            </div>`;

        const button = section.querySelector('button');
        const progressBar = section.querySelector('progress');
        const report = section.querySelector('.mt-3 > div');

        button.addEventListener('click', () => {
            button.hidden = true;
            progressBar.hidden = false;
            downloadAll(progressBar, report);
        }, { once: true });

        return section;
    }

    // The block drawer only exists when the course has blocks (never on lms.bbbaden.ch),
    // otherwise put the card on top of the course content.
    const blockRegion = document.getElementById('block-region-side-pre');
    if (blockRegion) {
        blockRegion.appendChild(createCard());
    } else {
        document.getElementById('region-main')?.prepend(createCard());
    }
    Logger.success('downloadallfiles', 'Initialization complete');
})();
