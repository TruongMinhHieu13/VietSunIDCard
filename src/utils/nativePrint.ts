/**
 * Opens the browser's native Ctrl+P print dialog reliably,
 * both in standalone tabs and inside sandboxed preview iframes (where window.print() is blocked by allow-modals).
 */
export function triggerBrowserCtrlP(pageSizeCss = '210mm 297mm'): void {
  const styleId = 'dynamic-print-page-rule';
  let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }
  styleEl.innerHTML = `@media print { @page { size: ${pageSizeCss}; margin: 0mm; } }`;

  const isInIframe = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();

  // If running in a normal top-level browser tab, native window.print() works directly
  if (!isInIframe) {
    window.focus();
    window.print();
    return;
  }

  // Inside a sandboxed iframe (like AI Studio preview), window.print() is blocked by missing 'allow-modals'.
  // Opening a popup window escapes the sandbox via 'allow-popups-to-escape-sandbox' and allows native Ctrl+P!
  const printRoot = document.getElementById('printable-cards-root');
  if (!printRoot) {
    window.focus();
    window.print();
    return;
  }

  const headStyles = Array.from(
    document.querySelectorAll('style, link[rel="stylesheet"]')
  )
    .map((el) => el.outerHTML)
    .join('\n');

  const printWin = window.open(
    '',
    'vietsun_ctrl_p_window',
    'width=1140,height=840,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes'
  );

  if (!printWin) {
    // Fallback if popup blocker intercepted window.open
    window.focus();
    window.print();
    return;
  }

  const htmlContent = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <base href="${window.location.origin}/" />
  <title>In Thẻ Nhân Viên - VIETSUN ĐỒNG NAI</title>
  ${headStyles}
  <style>
    @page {
      size: ${pageSizeCss};
      margin: 0mm;
    }
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      background: #ffffff !important;
      background-color: #ffffff !important;
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    @media screen {
      #printable-cards-root {
        display: none !important;
      }
    }
    @media print {
      html, body, #printable-cards-root {
        display: block !important;
        width: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        background: #ffffff !important;
        background-color: #ffffff !important;
        border: none !important;
        outline: none !important;
        box-shadow: none !important;
      }
      .print-sheet {
        background: #ffffff !important;
        background-color: #ffffff !important;
        box-shadow: none !important;
        border: none !important;
        outline: none !important;
        margin: 0 !important;
        page-break-after: always;
        break-after: page;
      }
      .print-sheet:last-child {
        page-break-after: auto;
        break-after: auto;
      }
    }
  </style>
</head>
<body>
  <div id="printable-cards-root">
    ${printRoot.innerHTML}
  </div>
  <script>
    (function() {
      var printed = false;
      function closeWin() {
        try {
          window.close();
        } catch (e) {}
      }
      window.addEventListener('afterprint', closeWin);

      function doPrint() {
        if (printed) return;
        printed = true;
        window.focus();
        window.print();
        setTimeout(closeWin, 120);
      }

      var imgs = Array.prototype.slice.call(document.images);
      var allComplete = imgs.every(function(img) { return img.complete; });
      if (imgs.length === 0 || allComplete) {
        setTimeout(doPrint, 20);
      } else {
        var loaded = 0;
        function check() {
          loaded++;
          if (loaded >= imgs.length) {
            setTimeout(doPrint, 20);
          }
        }
        imgs.forEach(function(img) {
          if (img.complete) {
            check();
          } else {
            img.addEventListener('load', check);
            img.addEventListener('error', check);
          }
        });
        setTimeout(doPrint, 350);
      }
    })();
  </script>
</body>
</html>`;

  printWin.document.open();
  printWin.document.write(htmlContent);
  printWin.document.close();
}
