/**
 * preview renderer.
 * minimize external dependencies by handling only the subset of markdown used by the recap skeleton.
 * if richer rendering is needed, replace with markdown-it.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** allow only safe URL schemes; otherwise neutralize (defense-in-depth for forks). */
function safeUrl(url: string): string {
  return /^(https?:|mailto:|#|\/)/i.test(url) ? url : "#";
}

/** inline: code → bold → italic → link (input is first escaped) */
export function renderInline(text: string): string {
  let t = escapeHtml(text);
  t = t.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) => `<a href="${safeUrl(url)}">${label}</a>`);
  return t;
}

function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|[\s:|-]+\|\s*$/.test(line) && line.includes("-");
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length > 0) {
      out.push(`<p>${para.map(renderInline).join("<br>")}</p>`);
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().length === 0) {
      flushPara();
      i++;
      continue;
    }

    // horizontal rule
    if (/^\s*---+\s*$/.test(line)) {
      flushPara();
      out.push("<hr>");
      i++;
      continue;
    }

    // heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      const level = h[1].length;
      out.push(`<h${level}>${renderInline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // quote
    if (/^\s*>\s?/.test(line)) {
      flushPara();
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${quote.map(renderInline).join("<br>")}</blockquote>`);
      continue;
    }

    // table
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushPara();
      const header = splitRow(line);
      i += 2; // header + separator
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i]) && !isTableSeparator(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const thead = `<thead><tr>${header.map((c) => `<th>${renderInline(c)}</th>`).join("")}</tr></thead>`;
      const tbody = `<tbody>${rows
        .map((r) => `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody>`;
      out.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    // list
    if (/^\s*[-*]\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      out.push(`<ul>${items.map((it) => `<li>${renderInline(it)}</li>`).join("")}</ul>`);
      continue;
    }

    // accumulate paragraph
    para.push(line);
    i++;
  }
  flushPara();
  return out.join("\n");
}

export interface WebviewHtmlOptions {
  nonce: string;
  cspSource: string;
  title?: string;
}

/** full webview HTML (CSP applied). bodyHtml is the result of renderMarkdown. pure function (testable). */
export function getWebviewHtml(bodyHtml: string, opts: WebviewHtmlOptions): string {
  const title = opts.title ?? "DailyRecap";
  const csp = `default-src 'none'; style-src ${opts.cspSource} 'nonce-${opts.nonce}'; img-src ${opts.cspSource} https: data:;`;
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style nonce="${opts.nonce}">
  body { font-family: var(--vscode-font-family, sans-serif); line-height: 1.6; padding: 1.5rem; max-width: 820px; margin: 0 auto; color: var(--vscode-foreground); }
  h1 { font-size: 1.6rem; border-bottom: 1px solid var(--vscode-panel-border, #8884); padding-bottom: .3rem; }
  h2 { font-size: 1.25rem; margin-top: 1.6rem; }
  blockquote { border-left: 3px solid var(--vscode-textLink-foreground, #4af); margin: .8rem 0; padding: .2rem .9rem; opacity: .9; }
  table { border-collapse: collapse; width: 100%; margin: .8rem 0; }
  th, td { border: 1px solid var(--vscode-panel-border, #8884); padding: .4rem .6rem; text-align: left; }
  code { background: var(--vscode-textCodeBlock-background, #8882); padding: .1rem .3rem; border-radius: 3px; }
  hr { border: none; border-top: 1px solid var(--vscode-panel-border, #8884); margin: 1.5rem 0; }
  a { color: var(--vscode-textLink-foreground, #4af); }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}
