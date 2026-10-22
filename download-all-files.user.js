// ==UserScript==
// @name         Download All Files
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  Download all files, folders, assignment files, pages and links of a Moodle course as a zip archive, optionally with a folder per section
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
    Logger.info('downloadallfiles', 'v2.4 - Initializing');

    const courseId = new URLSearchParams(window.location.search).get('id');
    const sesskey = document.querySelector('a[href*="logout.php?sesskey="]')?.href.match(/sesskey=([^&]+)/)?.[1];

    // Also strips leading/trailing dots, so no "." or ".." path segment can reach the zip
    const sanitize = name => name.replace(/[\\/:"*?<>|]/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '').trim();

    const safeDecode = text => {
        try {
            return decodeURIComponent(text);
        } catch (error) {
            return text; // Not percent-encoded, keep as is
        }
    };

    // Files, folders, assignment files, pages (saved as .html) and links (saved as .html redirecting to the target)
    const DOWNLOADABLE_MODULES = ['resource', 'folder', 'assign', 'page', 'url'];

    // All files and folders of the course, including sections that are only loaded on demand
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

        // Subsections (Moodle 5) are nested inside the folder of their parent section
        const sectionFolder = section => {
            const parent = section.component === 'mod_subsection' && sections.get(String(section.parentsectionid));
            if (parent) return `${sectionFolder(parent)}/${sanitize(section.title) || 'Unterabschnitt'}`;
            return sanitize(`${String(section.number).padStart(2, '0')} ${section.title || ''}`);
        };

        return state.cm
            .filter(cm => DOWNLOADABLE_MODULES.includes(cm.module) && cm.uservisible)
            .map(cm => {
                const section = sections.get(String(cm.sectionid));
                const folder = section ? sectionFolder(section) : String(cm.sectionnumber ?? 0).padStart(2, '0');
                return { id: cm.id, url: cm.url, module: cm.module, name: cm.name, folder };
            });
    }

    // Fallback: only the activities rendered on the current page
    function getResourcesFromPage() {
        const selector = DOWNLOADABLE_MODULES.map(module => `a.aalink.stretched-link[href*="mod/${module}/view.php"]`).join(', ');
        return [...document.querySelectorAll(selector)].map(anchor => {
            const section = anchor.closest('li.section');
            const title = section?.querySelector('.sectionname')?.textContent || '';
            const number = String(section?.dataset.section ?? 0).padStart(2, '0');
            return {
                id: new URL(anchor.href).searchParams.get('id'),
                url: anchor.href,
                module: anchor.href.match(/mod\/(\w+)\/view\.php/)[1],
                name: anchor.querySelector('.instancename')?.firstChild?.textContent || '',
                folder: sanitize(`${number} ${title}`)
            };
        });
    }

    // Activities whose files are linked on their page. Each pattern matches the file URL path
    // (group 1 = path inside the area) and names the subfolder inside the activity folder.
    // Folders: Moodle's own "download folder" zip is unreliable (empty files on lms.bbbaden.ch).
    const LINKED_FILES = {
        folder: {
            fallbackName: 'Ordner',
            scope: '.foldertree', // Only the file tree, not links in the description
            patterns: [[/^\/pluginfile\.php\/\d+\/mod_folder\/content\/\d+\/(.+)$/, '']]
        },
        assign: {
            fallbackName: 'Aufgabe',
            scope: '#region-main',
            patterns: [
                [/^\/pluginfile\.php\/\d+\/mod_assign\/introattachment\/\d+\/(.+)$/, 'Aufgabe'],
                [/^\/pluginfile\.php\/\d+\/assignsubmission_file\/submission_files\/\d+\/(.+)$/, 'Meine Abgabe'],
                [/^\/pluginfile\.php\/\d+\/assignfeedback_file\/feedback_files\/\d+\/(.+)$/, 'Feedback'],
                [/^\/pluginfile\.php\/\d+\/assignfeedback_editpdf\/(?:download|combined)\/\d+\/(.+)$/, 'Feedback']
            ]
        }
    };

    // Only files of this Moodle; every path segment is sanitized
    async function getLinkedFiles(activity) {
        const { fallbackName, scope, patterns } = LINKED_FILES[activity.module];
        const doc = await fetchDocument(activity.url);
        const root = doc.querySelector(scope) || doc.querySelector('#region-main') || doc;
        const activityName = sanitize(activity.name) || fallbackName;

        const files = new Map();
        for (const anchor of root.querySelectorAll('a[href*="/pluginfile.php/"]')) {
            const url = new URL(anchor.getAttribute('href'), window.location.origin);
            if (url.origin !== window.location.origin) continue;
            for (const [pattern, subfolder] of patterns) {
                const match = url.pathname.match(pattern);
                if (!match) continue;
                const parts = match[1].split('/').map(part => sanitize(safeDecode(part)) || 'file');
                const fileUrl = url.origin + url.pathname;
                files.set(fileUrl, {
                    ...activity,
                    url: fileUrl + '?forcedownload=1',
                    path: [activityName, subfolder, ...parts].filter(Boolean).join('/')
                });
            }
        }
        return [...files.values()];
    }

    async function fetchDocument(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Status code: ${response.status}`);
        return new DOMParser().parseFromString(await response.text(), 'text/html');
    }

    const escapeHtml = text => text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

    function htmlFile(title, body, head = '') {
        const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
${head}
</head>
<body>
${body}
</body>
</html>
`;
        return new Blob([html], { type: 'text/html' });
    }

    // forceview shows Moodle's link page instead of redirecting to the (cross-origin) target
    async function linkFile(link) {
        let target = link.url;
        try {
            const doc = await fetchDocument(link.url + '&forceview=1');
            const found = doc.querySelector('.urlworkaround a[href], #region-main iframe[src], #region-main object[data]');
            target = found?.getAttribute('href') || found?.getAttribute('src') || found?.getAttribute('data') || target;
        } catch (error) {
            Logger.warn('downloadallfiles', 'Could not read link target, linking to Moodle instead', link.url);
        }
        const safeTarget = escapeHtml(target);
        return htmlFile(link.name, `<p><a href="${safeTarget}">${safeTarget}</a></p>`,
            `<meta http-equiv="refresh" content="0; url=${safeTarget}">`);
    }

    // Images and links inside the page still point to Moodle and need a login
    async function pageFile(page) {
        const doc = await fetchDocument(page.url);
        const content = doc.querySelector('#region-main .box.generalbox') || doc.querySelector('#region-main [role="main"]');
        if (!content) throw new Error('Page content not found');
        return htmlFile(page.name, `<h1>${escapeHtml(page.name)}</h1>\n${content.innerHTML}`);
    }

    // One entry per file to download. Folder and assignment files know their path,
    // resources get their file name from the download response.
    async function getFiles(resources) {
        const files = [];
        for (const resource of resources) {
            if (!LINKED_FILES[resource.module]) {
                files.push(resource);
                continue;
            }
            try {
                files.push(...await getLinkedFiles(resource));
            } catch (error) {
                Logger.error('downloadallfiles', 'Could not read activity', resource.url);
                files.push({ ...resource, unreadable: true });
            }
        }
        return files;
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
        const name = match ? match[1] : new URL(response.url).pathname.split('/').pop();
        return sanitize(safeDecode(name)) || 'file';
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

        const resources = await getFiles(await getResources());
        if (!resources.length) {
            progress.hidden = true;
            report.innerHTML = '<div class="alert alert-info mt-3 mb-0">Keine Dateien in diesem Kurs gefunden.</div>';
            return;
        }

        const zip = new JSZip();
        const usedPaths = new Set();
        const failed = [];
        const activityResults = new Map(); // activity id -> all its files succeeded
        let done = 0;

        for (const resource of resources) {
            try {
                if (resource.unreadable) throw new Error('Activity could not be read');
                let path = resource.path;
                let blob;
                if (resource.module === 'url' || resource.module === 'page') {
                    blob = await (resource.module === 'url' ? linkFile(resource) : pageFile(resource));
                    path = `${sanitize(resource.name) || resource.module}.html`;
                } else {
                    const download = await fetchFile(resource.url);
                    blob = download.blob;
                    path = path || getFileName(download.response);
                }
                zip.file(uniquePath(structured ? `${resource.folder}/${path}` : path, usedPaths), blob);
                if (!activityResults.has(resource.id)) activityResults.set(resource.id, true);
            } catch (error) {
                failed.push(resource);
                activityResults.set(resource.id, false);
            }
            setProgress(progressBar, (++done / resources.length) * 100);
        }

        // Only present when the activity is rendered on the current page
        activityResults.forEach((success, id) => {
            document.querySelector(`#module-${id} .activity-grid`)?.append(statusBadge(success));
        });

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
            alert.append(document.createElement('br'), 'Nicht verfügbar (fehlen evtl. auf dem Server):');
            const list = alert.appendChild(document.createElement('ul'));
            list.className = 'mb-0 mt-2';
            for (const resource of failed) {
                const a = Object.assign(document.createElement('a'), {
                    href: resource.url,
                    target: '_blank',
                    textContent: resource.path || resource.name || resource.url
                });
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
