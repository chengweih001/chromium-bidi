/**
 * Copyright 2023 Google LLC.
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import fs from 'fs';
import path from 'path';
import url from 'url';

const __dirname = url.fileURLToPath(new URL('.', import.meta.url));

export function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\//g, '&#47;');
}

export function flattenSingleTest(test) {
  if (test.status !== 'OK' && test.subtests.length === 0) {
    return [
      {
        path: test.test,
        name: null,
        status: test.status,
        message: test.message ?? null,
      },
    ];
  }

  return test.subtests.map((subtest) => ({
    path: `${test.test}/${escapeHtml(subtest.name)}`,
    name: subtest.name,
    status: subtest.status,
    message: subtest.message ?? null,
  }));
}

/**
 *  "Tentative" means a WPT test was written even though consensus was never
 *  reached in the spec whether it will actually take place.
 *
 *  Tentative tests will usually never pass and they are not final.
 *  Since these are not spec finalized, they only add noise to the report.
 *
 *  Once (if ever) consensus is reached upon upstream, the tentative suffix
 *  is removed from the WPT test file, then the tests appear in the report
 *  as usual.
 */
function removeWebDriverBiDiPrefix(name) {
  return name
    .replace('/webdriver/tests/bidi/', '')
    .replace('/webdriver/tests/interop/', '');
}

function excludeTentativeTests(test) {
  return !test.test.includes('_tentative.py');
}

export function flattenTests(report) {
  if (report === undefined) {
    return undefined;
  }
  return report.results
    .filter(excludeTentativeTests)
    .map(flattenSingleTest)
    .flat()
    .sort(
      (a, b) =>
        a.path?.localeCompare(b.path) || a.name?.localeCompare(b.name) || 0,
    );
}

export function groupTests(tests) {
  if (tests === undefined) {
    return undefined;
  }
  const pathMap = {
    group: '',
    children: new Map(),
    stat: {
      all: 0,
      pass: 0,
    },
  };

  for (const test of tests) {
    let currentPathMap = pathMap;
    const parts = test.path.split('/');
    if (parts[0] === '') {
      parts.shift();
    }

    let currentPath = '';
    for (const part of parts) {
      currentPath = `${currentPath}/${part}`;
      if (!currentPathMap.children.has(part)) {
        currentPathMap.children.set(part, {
          group: currentPath,
          children: new Map(),
          stat: {
            total: 0,
            passing: 0,
          },
        });
      }
      currentPathMap = currentPathMap.children.get(part);

      currentPathMap.stat.total++;
      currentPathMap.stat.passing += test.status === 'PASS' ? 1 : 0;
    }
    currentPathMap.test = test;
  }

  return mergeSingleChildren(pathMap);
}

function mergeSingleChildren(map) {
  // If this is a leaf node, return the test.
  if (map.test) {
    return map.test;
  }

  if (map.children?.size === 1) {
    const child = map.children.values().next().value;
    // Don't collapse leaf node into parent.
    if (!child.test) {
      return mergeSingleChildren(child);
    }
  }

  // Recursively flatten children.
  return {
    message: null,
    path: map.group,
    name: null,
    status: null,
    stat: map.stat,
    children: Array.from(map.children.values()).map(mergeSingleChildren),
  };
}

function printDelta(baseline, current) {
  const multiplier = ((current - baseline) / baseline) * 100;
  const sign = multiplier < 0 ? '-' : '+';
  return `${sign}${multiplier.toFixed(2)}%`;
}

function compareToBaseLine(current, baseline) {
  return `
    Since ${baseline.date},
    the total number of subtests went from ${baseline.total} to ${current.total} (${printDelta(baseline.total, current.total)}),
    and the number of passing subtests went from ${baseline.passing} to ${current.passing} (${printDelta(baseline.passing, current.passing)}).
  `;
}

function getHtmlForTest(map, title) {
  if (map === undefined) {
    return `<h2>${title} not available</h2>`;
  }
  return `
      <h2 id="${title.replaceAll(' ', '-').toLowerCase()}">${title} - ${map.stat.passing} / ${map.stat.total} (${
        map.stat.total - map.stat.passing
      } remaining)
      </h2>
      <div>
        ${Array.from(map.children.values())
          .map((t) => generateTestReport(t, map.path))
          .join('')}
      </div>`;
}

function generateHtml(
  map,
  mapInterop,
  commitHash,
  chromeVersion,
  wptHash,
  isFiltered,
  baseline,
) {
  const date = new Date().toISOString().slice(0, 'yyyy-mm-dd'.length);
  const shortCommitHash = commitHash.slice(0, 8);
  const shortCommitWptHash = wptHash.slice(0, 8);

  const header = `
    <div class="headings">
      <h1>
        <span>
          Chromium-BiDi's (<a href="${linkCommit(commitHash)}"><code>${shortCommitHash}</code></a>)
        </span><br>
        <span>
          test results for WPT (<a href="${linkWptCommit(wptHash)}"><code>${shortCommitWptHash}</code></a>)
            ${
              isFiltered
                ? ' matching <a href="https://wpt.fyi/results/webdriver/tests/bidi?q=label%3Achromium-bidi-2023"><code>label:chromium-bidi-2023</code></a>'
                : ''
            }
        </span><br>
        <span>
          running Chrome ${chromeVersion} @ <time>${date}</time>
        </span>
      ${isFiltered ? `<p>${compareToBaseLine(map.stat, baseline)}</p>` : ''}
    </div>`;

  const template = fs.readFileSync(
    path.join(__dirname, './template.html'),
    'utf-8',
  );

  return template
    .replace('<chromium-bidi-header />', header)
    .replace('<chromium-bidi-tests />', getHtmlForTest(map, 'BiDi tests'))
    .replace(
      '<chromium-bidi-tests-interop />',
      getHtmlForTest(mapInterop, 'Interop tests'),
    );
}

function generateTestReport(map, parent) {
  if (!map.children) {
    return generateSubtestReport(map);
  }

  let name = removeWebDriverBiDiPrefix(map.path.replace(parent.path, ''));
  if (name.startsWith('/')) {
    name = name.replace('/', '');
  }

  return `
    <div class="test-card">
      <details>
        <summary class="path ${
          map.stat.total === map.stat.passing
            ? 'pass'
            : map.stat.passing === 0
              ? 'fail'
              : 'part'
        }">
          <span class="short-name">${escapeHtml(name)}</span>
          <span class="long-name hidden">${escapeHtml(map.path)}</span>
          <span class="stat"><b>${map.stat.passing}/${map.stat.total}</b></span>
        </summary>
        ${map.children
          .map((child) => {
            return generateTestReport(child, map);
          })
          .join('')}
      </details>
    </div>
`;
}

function generateSubtestReport(subtest) {
  const name =
    subtest.name ?? removeWebDriverBiDiPrefix(subtest.path).split('/').at(-1);

  return `
      <div class="test-card test-card-subtest ${
        subtest.status === 'PASS' ? 'pass' : 'fail'
      }">
        <div class="test-name">
          <p class="non-collapsible-item path">
          <span class="short-name">${escapeHtml(name).replaceAll('&#47;', '/').replaceAll('&#39;', "'")}</span>
          <span class="long-name hidden">${escapeHtml(subtest.path.replaceAll('&#47;', '/').replaceAll('&#39;', "'")).replaceAll('&#47;', '/').replaceAll('&#39;', "'")}</span>
          ${
            subtest.message
              ? `<br /><small>${escapeHtml(subtest.message)}</small>`
              : ''
          }
        </p>
        </div>
        <div class="result">
          <span>
            <b>${escapeHtml(subtest.status)}</b>
          </span>
        </div>
      </div>`;
}

function linkCommit(commitHash) {
  return `https://github.com/GoogleChromeLabs/chromium-bidi/commit/${commitHash}`;
}

function linkWptCommit(commitHash) {
  return `https://github.com/web-platform-tests/wpt/commit/${commitHash}`;
}

export function generateReport(
  reportData,
  interopReportData,
  commitHash,
  chromeVersion,
  wptHash,
) {
  return generateHtml(
    groupTests(flattenTests(reportData)),
    groupTests(flattenTests(interopReportData)),
    commitHash,
    chromeVersion,
    wptHash,
    reportData.isFiltered,
    reportData.baseline,
  );
}
