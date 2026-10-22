// ==UserScript==
// @name         Download All Files
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  Download all files of a Moodle course as a zip archive, optionally with a folder per section
// @author       PianoNic
// @downloadURL  https://github.com/BBBaden-Moodle-userscripts/Download-All-Files/raw/main/download-all-files.user.js
// @updateURL    https://github.com/BBBaden-Moodle-userscripts/Download-All-Files/raw/main/download-all-files.user.js
// @homepageURL  https://github.com/BBBaden-Moodle-userscripts/Download-All-Files
// @supportURL   https://github.com/BBBaden-Moodle-userscripts/Download-All-Files/issues
// @match        https://moodle.bbbaden.ch/course/view.php*
// @match        https://moodle.bbbaden.ch/userscript/extensions
// @match        https://lms.bbbaden.ch/course/view.php*
// @match        https://lms.bbbaden.ch/userscript/extensions
// @grant        GM_info
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js
// @require      https://github.com/BBBaden-Moodle-userscripts/LoggingLibrary/raw/refs/heads/main/Logging.lib.user.js
// @require      https://github.com/BBBaden-Moodle-userscripts/UserscriptBridgeLib/raw/main/userscriptBridge.lib.js
// @icon         https://github.com/BBBaden-Moodle-userscripts/Download-All-Files/blob/main/ico/icon.png?raw=true
// ==/UserScript==

// Note: keep a @grant (not "none"). In the page context Moodle's RequireJS
// captures JSZip as an AMD module and the JSZip global is never defined.

(function () {
    'use strict';

    if (UserscriptBridge.registerScript() || !UserscriptBridge.runOnce()) return;
    Logger.info('downloadallfiles', 'v2.1 - Initializing');

    const courseId = new URLSearchParams(window.location.search).get('id');
    const sesskey = document.querySelector('a[href*="logout.php?sesskey="]')?.href.match(/sesskey=([^&]+)/)?.[1];

    const sanitize = name => name.replace(/[\\/:"*?<>|]/g, '').replace(/\s+/g, ' ').trim();

    // All files of the course, including sections that are only loaded on demand
    // (e.g. the Tiles format). Uses the same web service as the Moodle 4.0+ course page.
    async function getResourcesFromService() {
        const response = await fetch(`/lib/ajax/service.php?sesskey=${sesskey}&info=core_courseformat_get_state`, {
            method: 'POST',
            body: JSON.stringify([{ index: 0, methodname: 'core_courseformat_get_state', args: { courseid: Number(courseId) } }])
        });
        const [result] = await response.json();
        if (result.error) throw result.exception;

        const state = JSON.parse(result.data);
        const sections = new Map(state.section.map(section => [String(section.id), section]));
        return state.cm
            .filter(cm => cm.module === 'resource' && cm.uservisible)
            .map(cm => {
                const section = sections.get(String(cm.sectionid));
                const number = String(section?.number ?? cm.sectionnumber ?? 0).padStart(2, '0');
                return { id: cm.id, url: cm.url, folder: sanitize(`${number} ${section?.title || ''}`) };
            });
    }

    // Fallback: only the activities rendered on the current page
    function getResourcesFromPage() {
        return [...document.querySelectorAll('a.aalink.stretched-link[href*="mod/resource"]')].map(anchor => {
            const section = anchor.closest('li.section');
            const title = section?.querySelector('.sectionname')?.textContent || '';
            const number = String(section?.dataset.section ?? 0).padStart(2, '0');
            return { id: new URL(anchor.href).searchParams.get('id'), url: anchor.href, folder: sanitize(`${number} ${title}`) };
        });
    }

    async function getResources() {
        if (courseId && sesskey) {
            try {
                return await getResourcesFromService();
            } catch (error) {
                Logger.warn('downloadallfiles', 'Web service failed, falling back to page links', error);
            }
        }
        return getResourcesFromPage();
    }

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

    // Header values are exposed as Latin-1, Moodle sends the file name as raw UTF-8
    const decodeUtf8 = text => new TextDecoder().decode(Uint8Array.from(text, c => c.charCodeAt(0)));

    function getFileName(response) {
        const header = decodeUtf8(response.headers.get('content-disposition') || '');
        const match = header.match(/filename\*=UTF-8''([^;]+)/i) || header.match(/filename="?([^";]+)"?/i);
        let name = match ? match[1] : new URL(response.url).pathname.split('/').pop();
        try {
            name = decodeURIComponent(name);
        } catch (error) {
            // Not percent-encoded, keep as is
        }
        return sanitize(name) || 'file';
    }

    // Two files with the same name would overwrite each other in the archive
    function uniquePath(path, usedPaths) {
        let candidate = path;
        for (let i = 2; usedPaths.has(candidate); i++) {
            candidate = path.replace(/(\.[^./]+)?$/, ` (${i})$1`);
        }
        usedPaths.add(candidate);
        return candidate;
    }

    // badge-* for Bootstrap 4 (moodle.bbbaden.ch), bg-* for Bootstrap 5 (lms.bbbaden.ch)
    function statusBadge(success) {
        const color = success ? 'success' : 'danger';
        const badge = document.createElement('span');
        badge.className = `badge badge-${color} bg-${color} text-white align-self-center text-nowrap ml-2 ms-2`;
        badge.textContent = success ? 'Im Archiv gespeichert' : 'Fehler beim Speichern';
        return badge;
    }

    function setProgress(progressBar, percentage) {
        const rounded = Math.round(percentage);
        progressBar.style.width = rounded + '%';
        progressBar.setAttribute('aria-valuenow', rounded);
        progressBar.textContent = rounded + '%';
    }

    async function downloadAll(progress, report, structured) {
        const progressBar = progress.querySelector('.progress-bar');
        const title = sanitize(document.querySelector('div.page-header-headings h1')?.textContent || 'moodle');

        const resources = await getResources();
        if (!resources.length) {
            progress.hidden = true;
            report.innerHTML = '<div class="alert alert-info mt-3 mb-0">Keine Dateien in diesem Kurs gefunden.</div>';
            return;
        }

        const zip = new JSZip();
        const usedPaths = new Set();
        const failed = [];
        let done = 0;

        for (const resource of resources) {
            // Only present when the activity is rendered on the current page
            const activity = document.querySelector(`#module-${resource.id} .activity-grid`);
            try {
                const { response, blob } = await fetchFile(resource.url);
                const fileName = getFileName(response);
                zip.file(uniquePath(structured ? `${resource.folder}/${fileName}` : fileName, usedPaths), blob);
                activity?.append(statusBadge(true));
            } catch (error) {
                failed.push(resource.url);
                activity?.append(statusBadge(false));
            }
            setProgress(progressBar, (++done / resources.length) * 100);
        }

        const link = document.createElement('a');
        link.href = URL.createObjectURL(await zip.generateAsync({ type: 'blob' }));
        link.download = title.replace(/ /g, '_') + '.zip';
        link.click();
        URL.revokeObjectURL(link.href);
        progressBar.classList.remove('progress-bar-animated', 'progress-bar-striped');
        progressBar.classList.add(failed.length ? 'bg-warning' : 'bg-success');

        const successCount = resources.length - failed.length;
        const alert = document.createElement('div');
        alert.className = `alert ${failed.length ? 'alert-warning' : 'alert-success'} mt-3 mb-0`;
        alert.textContent = `${successCount} von ${resources.length} Dateien heruntergeladen.`;
        if (failed.length) {
            const list = alert.appendChild(document.createElement('ul'));
            list.className = 'mb-0 mt-2';
            for (const href of failed) {
                const a = Object.assign(document.createElement('a'), { href, target: '_blank', textContent: href });
                list.appendChild(document.createElement('li')).appendChild(a);
            }
        }
        report.replaceChildren(alert);

        console.table([{ 'Status': 'Success', 'Count': successCount }, { 'Status': 'Failed', 'Count': failed.length }]);
    }

    // The download controls, shared by the sidebar card and the navigation dropdown
    function createPanel() {
        const panel = document.createElement('div');
        panel.className = 'card-body';
        panel.innerHTML = `
            <h5 class="card-title">Download All Files</h5>
            <p class="card-text text-muted">Alle Dateien dieses Kurses als ZIP herunterladen.</p>
            <div class="form-check mb-3">
                <input type="checkbox" class="form-check-input" id="download-all-structured">
                <label class="form-check-label" for="download-all-structured">
                    Strukturiertes ZIP (ein Ordner pro Abschnitt)
                </label>
            </div>
            <button class="btn btn-primary">
                <i class="fa fa-download" aria-hidden="true"></i> Download
            </button>
            <div class="progress" style="height: 1.25rem;" hidden>
                <div class="progress-bar progress-bar-striped progress-bar-animated" role="progressbar"
                     style="width: 0%" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100">0%</div>
            </div>
            <div class="download-report"></div>`;

        const button = panel.querySelector('button');
        const structured = panel.querySelector('#download-all-structured');
        const progress = panel.querySelector('.progress');
        const report = panel.querySelector('.download-report');

        button.addEventListener('click', () => {
            button.hidden = true;
            structured.disabled = true;
            progress.hidden = false;
            panel.dataset.busy = 'true';
            downloadAll(progress, report, structured.checked).finally(() => delete panel.dataset.busy);
        }, { once: true });

        return panel;
    }

    function createCard() {
        const section = document.createElement('section');
        section.className = 'card mb-3';
        section.appendChild(createPanel());
        return section;
    }

    // "Download" tab next to "Mehr" that opens the panel as a dropdown.
    // The dropdownmoremenu class makes Moodle's more menu (core/moremenu) leave the
    // item in place instead of moving it into "Mehr" when space runs out.
    function createNavItem() {
        const item = document.createElement('li');
        item.className = 'nav-item dropdown dropdownmoremenu position-relative';
        item.setAttribute('role', 'none');
        item.innerHTML = `
            <a class="nav-link" href="#" role="menuitem" aria-haspopup="true" aria-expanded="false">Download</a>
            <div class="dropdown-menu dropdown-menu-start p-0 shadow"
                 style="width: 24rem; max-width: calc(100vw - 16px); left: 0; right: auto; top: 100%;"></div>`;

        const toggle = item.querySelector('a');
        const menu = item.querySelector('.dropdown-menu');
        const panel = menu.appendChild(createPanel());
        panel.classList.add('p-3');

        // Left-aligned with the tab like "Mehr", shifted left only as far as needed to stay on screen
        const setOpen = open => {
            menu.classList.toggle('show', open);
            toggle.setAttribute('aria-expanded', String(open));
            if (!open) return;
            menu.style.left = '0px';
            const overflow = menu.getBoundingClientRect().right - (document.documentElement.clientWidth - 8);
            if (overflow > 0) menu.style.left = `${-overflow}px`;
        };
        toggle.addEventListener('click', event => {
            event.preventDefault();
            setOpen(!menu.classList.contains('show'));
        });
        // Close on outside click or Escape, but stay open while downloading
        document.addEventListener('click', event => {
            if (!item.contains(event.target) && !panel.dataset.busy) setOpen(false);
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !panel.dataset.busy) setOpen(false);
        });

        return item;
    }

    // Sidebar card when the course has a block drawer, otherwise a tab in the course
    // navigation (lms.bbbaden.ch has no block drawer), otherwise on top of the content.
    const blockRegion = document.getElementById('block-region-side-pre');
    const courseNav = document.querySelector('.secondary-navigation ul.more-nav');
    if (blockRegion) {
        blockRegion.appendChild(createCard());
    } else if (courseNav) {
        courseNav.appendChild(createNavItem());
    } else {
        document.getElementById('region-main')?.prepend(createCard());
    }
    Logger.success('downloadallfiles', 'Initialization complete');
})();
