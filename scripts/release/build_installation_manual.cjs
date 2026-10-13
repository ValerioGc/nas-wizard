// Builds the installation manual of the NAS in PDF, one chapter per numbered Markdown file, with
// the version of the wizard. The user manual is the launcher's: the wizard copies it from the
// package of the launcher when it installs it.

const {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { join } = require('node:path');
const highlight = require('highlight.js');
const { mdToPdf } = require('md-to-pdf');
const { version } = require('../../package.json');

const projectRoot = join(__dirname, '..', '..');
const outputDirectory = join(projectRoot, 'release-assets');
const markdownStylesheet = require.resolve('md-to-pdf/markdown.css');
const chapterPattern = /^\d+\..+\.md$/;

const systemBrowsers = [
  '/usr/bin/brave-browser',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
];
const executablePath =
  process.env.PUPPETEER_EXECUTABLE_PATH || systemBrowsers.find((path) => existsSync(path));

const launchOptions = {
  ...(executablePath && { executablePath }),
  ...(process.env.CI && { args: ['--no-sandbox', '--disable-setuid-sandbox'], dumpio: true }),
};

const manualStylesheet = join(projectRoot, 'system', 'installation_manual', 'styles', 'style.css');
const manual = {
  directory: join(projectRoot, 'system', 'installation_manual'),
  title: 'Manuale di installazione nas-os',
  outputName: `nas_os_installation_manual_${version}.pdf`,
};

function highlightCodeBlocks(content) {
  return content.replaceAll(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, (_match, code) => {
    const highlightedCode = highlight.highlight(code, { language: 'bash' }).value;
    return `<pre><code class="hljs language-bash">${highlightedCode}</code></pre>`;
  });
}

async function buildManual({ directory, title, outputName }) {
  const sourcePath = join(directory, `.${outputName}.md`);
  const outputPath = join(outputDirectory, outputName);
  const chapters = readdirSync(directory)
    .filter((fileName) => chapterPattern.test(fileName))
    .sort((first, second) => first.localeCompare(second, undefined, { numeric: true }));

  if (chapters.length === 0) {
    throw new Error(`No manual chapters found in ${directory}.`);
  }

  const content = highlightCodeBlocks(
    chapters.map((chapter) => readFileSync(join(directory, chapter), 'utf8').trim()).join('\n\n'),
  );

  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(sourcePath, `${content}\n`);

  try {
    await mdToPdf(
      { path: sourcePath },
      {
        dest: outputPath,
        basedir: directory,
        document_title: title,
        stylesheet: [markdownStylesheet, manualStylesheet],
        highlight_style: 'github-dark',
        launch_options: launchOptions,
        pdf_options: {
          format: 'A4',
          printBackground: true,
          displayHeaderFooter: true,
          headerTemplate: '<div></div>',
          footerTemplate: `<div style="width: 100%; padding: 0 20mm; font-size: 8px; color: #555; display: flex; justify-content: space-between;"><span>Manuale v${version}</span><span>Pagina <span class="pageNumber"></span> di <span class="totalPages"></span></span></div>`,
        },
      },
    );

    console.log(`${title} generated at ${outputPath}.`);
  } finally {
    rmSync(sourcePath, { force: true });
  }
}

buildManual(manual).catch((error) => {
  console.error(error);
  process.exit(1);
});
