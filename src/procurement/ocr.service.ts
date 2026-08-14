import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AllConfigType } from '../config/config.type';

export type ReceiptFields = {
  amount: string | null;
  currency: string | null;
  reference: string | null;
  trxId: string | null;
  sender: string | null;
  transferTo: string | null;
  remark: string | null;
  bankAccount: string | null;
  paidAt: string | null;
};

const EMPTY: ReceiptFields = {
  amount: null,
  currency: null,
  reference: null,
  trxId: null,
  sender: null,
  transferTo: null,
  remark: null,
  bankAccount: null,
  paidAt: null,
};

/**
 * OCR.space engine 2 in table mode returns tab-separated `label<TAB>value` rows. We build a
 * lowercased label→value map and pick fields out of it. Every field may be absent — this
 * returns nulls and never throws, because a failed OCR must still leave a usable form.
 */
@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  constructor(private readonly configService: ConfigService<AllConfigType>) {}

  async parseReceipt(imageUrl: string): Promise<ReceiptFields> {
    const apiKey = this.configService.get('ocr.apiKey', { infer: true });

    if (!apiKey) {
      this.logger.warn('OCR_SPACE_API_KEY is not set; skipping receipt OCR');
      return { ...EMPTY };
    }

    try {
      const params = new URLSearchParams({
        apikey: apiKey,
        url: imageUrl,
        OCREngine: '2',
        isTable: 'true',
        scale: 'true',
      });

      const response = await fetch('https://api.ocr.space/parse/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });

      const payload = (await response.json()) as {
        ParsedResults?: { ParsedText?: string }[];
      };

      const text = payload.ParsedResults?.[0]?.ParsedText ?? '';
      this.logger.log(`Raw OCR text:\n${text}`);
      return this.extract(text);
    } catch (error) {
      this.logger.error(`Receipt OCR failed: ${error}`);
      return { ...EMPTY };
    }
  }

  /** Exposed for testing: turn the raw tab-separated text into fields. */
  extract(text: string): ReceiptFields {
    if (!text.trim()) return { ...EMPTY };

    // Labels vary in punctuation across receipt formats ("Trx. ID:", "Reference #:",
    // "Ref No"), which a plain substring match misses — e.g. "trx. id" does not
    // contain "trx id". Stripping everything but letters/digits/spaces before
    // matching makes those equivalent.
    const normalize = (value: string) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // Every other field is a short single-line value that OCR always pairs with its
    // own label on one row — but a long remark wraps across multiple visual lines,
    // and OCR only tags whichever wrapped line happens to share the label's
    // Y-position (not necessarily the first one) with "Remark:"; the rest come back
    // as bare, unlabeled lines on either side of it. So: build the simple one-line
    // map first, then specifically stitch the remark's wrapped neighbors back in.
    const lines = text.split(/\r?\n/).map((line) => {
      const [label, ...rest] = line.split('\t');
      const value = rest.join(' ').trim();
      return value
        ? { label: normalize(label), value }
        : { label: null, value: null };
    });

    const map = new Map<string, string>();
    for (const entry of lines) {
      if (entry.label !== null && entry.value !== null)
        map.set(entry.label, entry.value);
    }

    const remarkLabels = ['remark', 'note', 'description'];
    const remarkIndex = lines.findIndex(
      (entry) =>
        entry.label !== null &&
        remarkLabels.some((l) => entry.label!.includes(l)),
    );
    if (remarkIndex !== -1) {
      const parts = [lines[remarkIndex].value as string];
      for (let j = remarkIndex - 1; j >= 0 && lines[j].label === null; j--) {
        const bare = text.split(/\r?\n/)[j].trim();
        if (bare) parts.unshift(bare);
      }
      for (
        let j = remarkIndex + 1;
        j < lines.length && lines[j].label === null;
        j++
      ) {
        const bare = text.split(/\r?\n/)[j].trim();
        if (bare) parts.push(bare);
      }
      map.set(lines[remarkIndex].label as string, parts.join(' ').trim());
    }

    const pick = (...labels: string[]): string | null => {
      for (const label of labels) {
        const needle = normalize(label);
        for (const [key, value] of map) {
          if (key.includes(needle)) return value;
        }
      }
      return null;
    };

    const amountRaw = pick('original amount', 'amount');
    const amountMatch = amountRaw?.match(/([0-9,]+\.?\d*)\s*(USD|KHR|CNY)?/i);

    // The recipient's name ("Transfer to NAME") sits in the receipt header, separate
    // from the "To account:" row that carries just the account number — combine both
    // when present rather than letting one silently win over the other.
    const headerTransferTo = text
      .match(/Transfer to\s+([^\n\t]+)/i)?.[1]
      ?.trim();
    const toAccount = pick('to account', 'receiver', 'transfer to');
    const transferTo =
      headerTransferTo && toAccount
        ? `${headerTransferTo} (${toAccount})`
        : (headerTransferTo ?? toAccount ?? null);

    return {
      amount: amountMatch?.[1] ? amountMatch[1].replace(/,/g, '') : null,
      currency: amountMatch?.[2]?.toUpperCase() ?? null,
      reference: pick('reference', 'ref no', 'ref.'),
      trxId: pick('trx id', 'transaction id', 'txn id'),
      sender: pick('sender'),
      transferTo,
      remark: pick('remark', 'note', 'description'),
      // "from account" first: specific and what we actually want. Bare "bank" is
      // too broad on its own — it also matches footer/logo text like "NATIONAL
      // BANK OF CANADA GROUP", so it's kept only as a last-resort fallback.
      bankAccount: pick('from account', 'account no', 'account number', 'bank'),
      paidAt: this.normalizeDate(pick('transaction date', 'date', 'paid at')),
    };
  }

  private normalizeDate(value: string | null): string | null {
    if (!value) return null;

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;

    return parsed.toISOString().slice(0, 16);
  }
}
