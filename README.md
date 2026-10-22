[![Static Badge](https://img.shields.io/badge/Install-Script-dark_green?style=for-the-badge&color=dark_green)](https://github.com/BBBaden-Moodle-userscripts/Download-All-Files/raw/main/download-all-files.user.js)

# Moodle File Downloader UserScript

This UserScript allows you to download files from a Moodle course and creates a zip archive containing all the downloaded files. It works on course pages of https://moodle.bbbaden.ch and https://lms.bbbaden.ch.

## Features

- Combines all files of the course into one zip archive, including sections that are only loaded on demand (e.g. the Tiles format).
- Optional structured zip with one folder per course section.
- Progress bar and a summary of failed downloads.
- Provides a convenient "Download All Files" button.

## Installation

1. Install a user script manager extension like [Violentmonkey](https://violentmonkey.github.io/#installation).
2. Click [here](https://github.com/BBBaden-Moodle-userscripts/Download-All-Files/raw/main/download-all-files.user.js) to install.

## Usage

1. Navigate to a Moodle course page.
2. Locate the "Download All Files" card in the sidebar, or above the course content if the course has no sidebar.
3. Optionally check "Strukturiertes ZIP" to get one folder per section.
4. Click the "Download" button to initiate the file download.
5. A zip archive containing all the files will be generated and downloaded.

## Screenshots

![Download All Files Button](https://github.com/BBBaden-Moodle-userscripts/Download-All-Files/blob/main/img/Screenshot%202024-01-03%20110529.png)

## Disclaimer

**Note: This script is distributed under the terms of the MIT License.**

This script is provided without any warranty and is subject to the terms and conditions of the MIT License.

Please use this script responsibly and ensure compliance with the MIT License and any other applicable regulations. The author shall not be held responsible for any consequences arising from the use or misuse of this script.

## Author

- **PianoNic** - [GitHub Profile](https://github.com/PianoNic)

## Additional Script

For users who prefer a Python solution, there is also a Python script available on my GitHub repository: [Moodle File Downloader (Python)](https://github.com/Pianonic/Moodle-File-Downloader)
