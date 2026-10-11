import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Browser, chromium } from 'playwright-core';

/**
 * HTML → A4 PDF through headless Chromium, which shapes Khmer correctly (pdfkit-style
 * libraries do not). One browser per process, launched on first use. In the production
 * image CHROMIUM_PATH points at Alpine's chromium; locally Playwright's own build is used.
 */
@Injectable()
export class PdfService implements OnModuleDestroy {
  private browser?: Promise<Browser>;

  private launch(): Promise<Browser> {
    this.browser ??= chromium
      .launch({
        executablePath: process.env.CHROMIUM_PATH || undefined,
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      })
      .then((browser) => {
        browser.on('disconnected', () => (this.browser = undefined));
        return browser;
      })
      .catch((error) => {
        this.browser = undefined;
        throw error;
      });
    return this.browser;
  }

  async fromHtml(html: string): Promise<Buffer> {
    const browser = await this.launch();
    // The document is static; no script needs to run while it prints.
    const page = await browser.newPage({ javaScriptEnabled: false });
    try {
      await page.setContent(html, { waitUntil: 'load' });
      return await page.pdf({ preferCSSPageSize: true, printBackground: true });
    } finally {
      await page.close();
    }
  }

  async onModuleDestroy(): Promise<void> {
    const browser = this.browser;
    this.browser = undefined;
    if (browser) await (await browser).close();
  }
}
