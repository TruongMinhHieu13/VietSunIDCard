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
  <title>In Thẻ Nhân Viên - VIETSUN ĐỒNG NAI (Ctrl + P)</title>
  ${headStyles}
  <style>
    @page {
      size: ${pageSizeCss};
      margin: 0mm;
    }
    html, body {
      margin: 0;
      padding: 0;
      background: #525659;
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .print-Preview-Header {
      position: sticky;
      top: 0;
      z-index: 50;
      background: #323639;
      color: #ffffff;
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #474b4f;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    .print-Preview-Canvas {
      padding: 28px 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 24px;
    }
    #printable-cards-root {
      display: flex !important;
      flex-direction: column;
      align-items: center;
      gap: 24px;
    }
    .print-sheet {
      background: #ffffff !important;
      box-shadow: 0 8px 28px rgba(0,0,0,0.45) !important;
      margin: 0 auto !important;
      page-break-after: always;
      break-after: page;
    }
    .print-sheet:last-child {
      page-break-after: auto;
      break-after: auto;
    }
    .btn-print-now {
      background: #2563eb;
      color: #ffffff;
      border: none;
      padding: 8px 18px;
      border-radius: 6px;
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
    }
    .btn-print-now:hover {
      background: #1d4ed8;
    }
    .btn-close-win {
      background: #4b5563;
      color: #ffffff;
      border: none;
      padding: 8px 14px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      margin-left: 8px;
    }
    .btn-close-win:hover {
      background: #374151;
    }
    @media print {
      html, body {
        background: #ffffff !important;
      }
      .print-Preview-Header {
        display: none !important;
      }
      .print-Preview-Canvas {
        padding: 0 !important;
        display: block !important;
      }
      #printable-cards-root {
        display: block !important;
      }
      .print-sheet {
        box-shadow: none !important;
        margin: 0 !important;
      }
    }
  </style>
</head>
<body>
  <div class="print-Preview-Header">
    <div>
      <strong style="font-size:14px;">🖨️ Hộp Thoại In Thẻ Nhân Viên - VIETSUN ĐỒNG NAI</strong>
      <span style="font-size:12px;color:#d1d5db;margin-left:12px;">Hộp thoại Ctrl + P của trình duyệt sẽ tự động bật lên</span>
    </div>
    <div>
      <button type="button" class="btn-print-now" onclick="window.focus(); window.print();">
        🖨️ Mở Hộp Thoại In (Ctrl + P)
      </button>
      <button type="button" class="btn-close-win" onclick="window.close();">
        Đóng cửa sổ
      </button>
    </div>
  </div>
  <div class="print-Preview-Canvas">
    <div id="printable-cards-root">
      ${printRoot.innerHTML}
    </div>
  </div>
  <script>
    (function() {
      var printed = false;
      function doPrint() {
        if (printed) return;
        printed = true;
        window.focus();
        window.print();
      }
      var imgs = Array.prototype.slice.call(document.images);
      if (imgs.length === 0) {
        setTimeout(doPrint, 150);
      } else {
        var loaded = 0;
        function check() {
          loaded++;
          if (loaded >= imgs.length) {
            setTimeout(doPrint, 120);
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
        setTimeout(doPrint, 600);
      }
    })();
  </script>
</body>
</html>`;

  printWin.document.open();
  printWin.document.write(htmlContent);
  printWin.document.close();
}
